import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  anförandenLinks,
  baseUrl,
  halCollection,
  halResource,
  politikerLinks,
  politikerListLinks,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { capLimit } from '../lib/helpers.js'

export const politikerRouter = new OpenAPIHono()

// --- Schemas ---
const PolitikerSummary = z
  .object({
    id: z.string().uuid(),
    namn: z.string(),
    parti: z.string(),
    email: z.string().nullable(),
    antalUppdrag: z.number(),
  })
  .openapi('PolitikerSummary')
const PolitikerList = z
  .object({ kommun: z.string(), antal: z.number(), politiker: z.array(PolitikerSummary) })
  .openapi('PolitikerList')

const politikerRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker',
  tags: ['Politiker'],
  summary: 'Lista alla politiker',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ parti: z.string().optional(), limit: z.string().optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: PolitikerList } }, description: 'OK' },
  },
})
politikerRouter.openapi(politikerRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti, limit } = c.req.valid('query')
  const lim = capLimit(limit, 2000)
  const schema = requireSchema(kommun)
  const rows = parti
    ? await sql`SELECT * FROM ${sql(schema)}.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn LIMIT ${lim}`
    : await sql`SELECT * FROM ${sql(schema)}.politiker ORDER BY efternamn LIMIT ${lim}`
  const items = rows.map((p) => ({
    id: p.id,
    namn: `${p.fornamn} ${p.efternamn}`,
    parti: p.parti,
    email: p.email,
    uppdrag: p.uppdrag,
    antalUppdrag: (p.uppdrag as any[]).length,
    aktivSedan:
      (p.sociala as any)?.mandatperioder?.[0]?.period?.split('-')[0] ||
      ((p.uppdrag as any[]) || []).reduce((earliest: string | null, u: any) => {
        if (!u.från) return earliest
        const y = u.från.slice(0, 4)
        return !earliest || y < earliest ? y : earliest
      }, null),
    _links: politikerLinks(kommun, p.id),
  }))
  return c.json(halCollection(items, politikerListLinks(kommun)), 200)
})

const politikerDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}',
  tags: ['Politiker'],
  summary: 'Enskild politiker med alla uppdrag',
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('PolitikerDetail') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
politikerRouter.openapi(politikerDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const [person] = await sql`SELECT * FROM ${sql(schema)}.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Möten where this politiker spoke (from talade_i edges)
  const rows = await sql`
    SELECT DISTINCT e.data->>'datum' as datum, n.label as mote
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
    WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i'
    ORDER BY datum DESC`

  const möten = rows.map((r) => ({
    datum: r.datum,
    möte: r.mote,
    _links: {
      anforanden: { href: `/api/v1/${kommun}/politiker/${id}/anforanden?datum=${r.datum}` },
      möte: { href: `/api/v1/${kommun}/möten/${r.datum}` },
    },
  }))

  const item = {
    id: person.id,
    namn: `${person.fornamn} ${person.efternamn}`,
    parti: person.parti,
    email: person.email,
    foto: person.foto,
    sociala: person.sociala,
    uppdrag: person.uppdrag,
  }

  return c.json(halResource(item, politikerLinks(kommun, id), { möten }), 200)
})

// --- Arvode ---
// Beräknar och returnerar ersättning för en enskild politiker.
// Datakällor:
//   1. Fast arvode (presidieuppdrag): arvoderas_enligt-edge i grafen,
//      beräknat vid seed-tid från Göteborgs Stads arvodesregler Bilaga 2.
//   2. Förrättningsarvode (mötesdeltagande): 1 640 kr per KF-möte (heldag),
//      baserat på registrerade röster (= närvaro vid votering).
//   3. Total ersättning = fast arvode/mån + ackumulerat förrättningsarvode.
// Källa: Göteborgs Stads regler för arvoden och ersättningar (KS 2025-12-10 §946)
const arvodesRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}/arvode',
  tags: ['Politiker'],
  summary: 'Ersättning för förtroendevald — fast arvode + förrättningsarvode',
  description: `Beräknar total ersättning baserat på:
- Fast arvode: procent av grundarvodet (80 475 kr/mån 2026) beroende på ordförandeuppdrag
- Förrättningsarvode: 1 640 kr per KF-sammanträde (heldag) baserat på registrerad närvaro
- Källa: Göteborgs Stads regler för arvoden (KS 2025-12-10 §946, Bilaga 2)`,
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({}).passthrough().openapi('Arvode') } },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
politikerRouter.openapi(arvodesRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)

  // Hämta politikerns grunddata
  const [person] = await sql`SELECT * FROM ${sql(schema)}.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Hämta arvodesedge: politiker-{uuid} → arvode-regler-2026
  // Denna edge innehåller all beräknad arvodesdata (skapas vid seed)
  const arvodesEdge = await sql`
    SELECT data FROM ${sql(schema)}.graf_edges
    WHERE from_id = ${`politiker-${id}`} AND typ = 'arvoderas_enligt'
    LIMIT 1`

  // Grunddata som alltid returneras oavsett om fast arvode finns
  const grundarvode = 80475 // 2026 (från PDF)
  const förrättningPerMöte = 1640 // heldag KF

  const arvodesLinks = {
    self: { href: `${baseUrl(kommun)}/politiker/${id}/arvode` },
    politiker: { href: `${baseUrl(kommun)}/politiker/${id}` },
  }

  if (arvodesEdge.length === 0) {
    // Politiker utan registrerad arvodesdata (ersättare som ej deltagit i votering)
    const item = {
      politiker: { id, namn: `${person.fornamn} ${person.efternamn}`, parti: person.parti },
      grundarvode_kr: grundarvode,
      fast_arvode_kr: 0,
      förrättningsarvode_kr: 0,
      antal_möten_deltog: 0,
      total_ersättning_kr: 0,
      källa: 'Göteborgs Stads regler för arvoden (KS 2025-12-10 §946)',
      notering: 'Ingen registrerad närvaro vid voteringar under perioden',
    }
    return c.json(halResource(item, arvodesLinks), 200)
  }

  const data = arvodesEdge[0].data as any
  const item = {
    politiker: { id, namn: `${person.fornamn} ${person.efternamn}`, parti: person.parti },
    grundarvode_kr: grundarvode,
    fast_arvode_kr: data.fast_arvode_kr || 0,
    förrättningsarvode_kr: data.förrättningsarvode_kr || 0,
    antal_möten_deltog: data.antal_möten_deltog || 0,
    total_ersättning_kr: data.total_ersättning_kr || data.fast_arvode_kr || 0,
    källa: 'Göteborgs Stads regler för arvoden (KS 2025-12-10 §946)',
  }
  return c.json(halResource(item, arvodesLinks, { detaljer: data.detaljer || [] }), 200)
})

// Anföranden per politiker (from talade_i edges)
politikerRouter.get('/api/v1/:kommun/politiker/:id/anforanden', async (c) => {
  const kommun = c.req.param('kommun')
  const schema = requireSchema(kommun)
  const id = c.req.param('id')
  const datum = c.req.query('datum')
  const rows = datum
    ? await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i' AND e.data->>'datum' = ${datum}
        ORDER BY (e.data->>'ordning')::int`
    : await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i'
        ORDER BY (e.data->>'datum') DESC, (e.data->>'ordning')::int`
  const items = rows.map((r) => {
    const d = (r.data as any) || {}
    return {
      datum: r.datum,
      möte: r.mote,
      ärende: d.ärende,
      ärendeTitel: d.ärendeTitel,
      text: d.text,
      ordning: d.ordning,
      _links: { möte: { href: `${baseUrl(kommun)}/möten/${r.datum}` } },
    }
  })
  return c.json(halCollection(items, anförandenLinks(kommun, 'politiker', id, datum || undefined)))
})
