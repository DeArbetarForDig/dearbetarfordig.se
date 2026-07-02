import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import postgres from 'postgres'
import {
  politikerLinks,
  politikerListLinks,
  möteLinks,
  mötenListLinks,
  beslutLinks,
  beslutListLinks,
  förvaltningLinks,
  förvaltningarListLinks,
  anförandenLinks,
  budgetLinks,
  baseUrl,
  halCollection,
  halResource,
} from './hal.js'

// --- Config ---
const DATABASE_URL =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'postgresql://daf:daf_local@localhost:5432/daf')
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required in production')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 20, idle_timeout: 30, connect_timeout: 10 })
const app = new OpenAPIHono()

// --- Multi-tenancy allowlist ---
const ALLOWED_KOMMUNER = ['goteborg'] // expand as we add more
function getSchema(kommun: string): string | null {
  if (!ALLOWED_KOMMUNER.includes(kommun)) return null
  return kommun
}

// --- Middleware ---
app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))

// Kommun validation
app.use('/api/v1/:kommun/*', async (c, next) => {
  const kommun = c.req.param('kommun')
  if (!ALLOWED_KOMMUNER.includes(kommun)) {
    return c.json(
      { error: `Kommun '${kommun}' finns inte. Tillgängliga: ${ALLOWED_KOMMUNER.join(', ')}` },
      404,
    )
  }
  await next()
})

// Rate limiting (simple in-memory, per IP)
const rateMap = new Map<string, { count: number; reset: number }>()
app.use('/*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown'
  const now = Date.now()
  const entry = rateMap.get(ip)
  const limit = process.env.NODE_ENV === 'production' ? 200 : 5000
  if (entry && entry.reset > now) {
    if (entry.count >= limit) return c.json({ error: 'Rate limit exceeded (200/min)' }, 429)
    entry.count++
  } else {
    rateMap.set(ip, { count: 1, reset: now + 60_000 })
  }
  await next()
})

// --- Helpers ---
function capLimit(val: string | undefined, max = 200): number {
  return Math.min(Math.max(Number.parseInt(val || '50') || 50, 1), max)
}

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
const GraphNode = z
  .object({ id: z.string(), typ: z.string(), label: z.string(), data: z.record(z.unknown()) })
  .openapi('GraphNode')
const GraphEdge = z
  .object({
    id: z.string().optional(),
    from_id: z.string(),
    to_id: z.string(),
    typ: z.string(),
    label: z.string().nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
  })
  .openapi('GraphEdge')

// --- Health ---
app.get('/healthz', async (c) => {
  try {
    await sql`SELECT 1`
    return c.json({ status: 'ok', db: 'connected' })
  } catch {
    return c.json({ status: 'error', db: 'disconnected' }, 503)
  }
})

// --- Routes ---
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
app.openapi(politikerRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti, limit } = c.req.valid('query')
  const lim = capLimit(limit)
  const schema = getSchema(kommun)
  const rows = parti
    ? await sql`SELECT * FROM goteborg.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn LIMIT ${lim}`
    : await sql`SELECT * FROM goteborg.politiker ORDER BY efternamn LIMIT ${lim}`
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
app.openapi(politikerDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const [person] = await sql`SELECT * FROM goteborg.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Möten where this politiker spoke (from talade_i edges)
  const rows = await sql`
    SELECT DISTINCT e.data->>'datum' as datum, n.label as mote
    FROM goteborg.graf_edges e
    JOIN goteborg.graf_nodes n ON n.id = e.to_id
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
app.openapi(arvodesRoute, async (c) => {
  const { id } = c.req.valid('param')

  // Hämta politikerns grunddata
  const [person] = await sql`SELECT * FROM goteborg.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Hämta arvodesedge: politiker-{uuid} → arvode-regler-2026
  // Denna edge innehåller all beräknad arvodesdata (skapas vid seed)
  const arvodesEdge = await sql`
    SELECT data FROM goteborg.graf_edges 
    WHERE from_id = ${`politiker-${id}`} AND typ = 'arvoderas_enligt'
    LIMIT 1`

  // Grunddata som alltid returneras oavsett om fast arvode finns
  const grundarvode = 80475 // 2026 (från PDF)
  const förrättningPerMöte = 1640 // heldag KF

  const { kommun } = c.req.valid('param')
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

// --- Möten (fixed N+1) ---
const mötenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/möten',
  tags: ['Möten'],
  summary: 'Lista alla sammanträden',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ år: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ kommun: z.string(), möten: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(mötenRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { år } = c.req.valid('query')

  // Single query — no N+1
  const meetings =
    await sql`SELECT id, data->>'datum' as datum, data->>'videoUrl' as video_url, label FROM goteborg.graf_nodes WHERE typ = 'möte' ORDER BY data->>'datum' DESC`
  const counts =
    await sql`SELECT data->>'datum' as datum, COUNT(*)::int as antal FROM goteborg.graf_nodes WHERE typ = 'paragraf' GROUP BY data->>'datum'`
  const countMap = Object.fromEntries(counts.map((c) => [c.datum, c.antal]))
  const närvaroRows = await sql`SELECT e.to_id, e.from_id, e.label, p.fornamn, p.efternamn, p.parti
      FROM goteborg.graf_edges e
      LEFT JOIN goteborg.politiker p ON p.id = replace(e.from_id, 'politiker-', '')::uuid
      WHERE e.typ = 'närvarade'`
  const närvaroMap = new Map<string, Array<{ namn: string; parti: string; tid: string }>>()
  for (const r of närvaroRows) {
    if (!r.fornamn) continue
    if (!närvaroMap.has(r.to_id)) närvaroMap.set(r.to_id, [])
    const namn = `${r.fornamn} ${r.efternamn}`
    const tid = r.label || ''
    // Skip duplicates (same name, same meeting, no time or already have time)
    const existing = närvaroMap.get(r.to_id)!
    const hasSameName = existing.find((e) => e.namn === namn)
    if (hasSameName) {
      // Merge: keep the one with time, or combine intervals
      if (tid && !hasSameName.tid) hasSameName.tid = tid
      else if (tid && hasSameName.tid && !hasSameName.tid.includes(tid))
        hasSameName.tid += `, ${tid}`
    } else {
      existing.push({ namn, parti: r.parti, tid })
    }
  }

  let items = meetings.map((m) => ({
    datum: m.datum,
    label: m.label,
    antalBeslut: countMap[m.datum] || 0,
    närvarande: (närvaroMap.get(m.id) || []).length,
    ...(m.video_url ? { videoUrl: m.video_url } : {}),
    _links: möteLinks(kommun, m.datum),
  }))
  if (år) items = items.filter((m) => m.datum?.startsWith(år))

  return c.json(halCollection(items, mötenListLinks(kommun)), 200)
})

// --- Möte (enskilt) ---
const moteRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/möten/{datum}',
  tags: ['Möten'],
  summary: 'Enskilt sammanträde — beslut, närvaro och anföranden',
  request: { params: z.object({ kommun: z.string(), datum: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({}).passthrough().openapi('Mote') } },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(moteRoute, async (c) => {
  const { kommun, datum } = c.req.valid('param')

  const [mote] =
    await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'möte' AND data->>'datum' = ${datum}`
  if (!mote) return c.json({ error: 'Sammanträde ej hittat' }, 404)

  const beslutRows =
    await sql`SELECT id, label, data FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ORDER BY (data->>'paragrafNr')::int`

  const nearvaroRows = await sql`
    SELECT e.label, p.fornamn, p.efternamn, p.parti, p.id as politiker_id
    FROM goteborg.graf_edges e
    LEFT JOIN goteborg.politiker p ON p.id = replace(e.from_id, 'politiker-', '')::uuid
    WHERE e.to_id = ${mote.id} AND e.typ = 'närvarade' AND p.id IS NOT NULL`

  // Anföranden from yttrandeprotokoll (talade_i)
  const anförandenRows = await sql`
    SELECT e.data, gp.label as talare, gp.data->>'parti' as parti, gp.id as pol_id
    FROM goteborg.graf_edges e
    JOIN goteborg.graf_nodes gp ON gp.id = e.from_id
    WHERE e.to_id = ${mote.id} AND e.typ = 'talade_i' AND gp.typ = 'politiker'
    ORDER BY (e.data->>'ordning')::int`

  const item = {
    datum,
    label: mote.label,
    antalBeslut: beslutRows.length,
    ...((mote.data as any)?.videoUrl ? { videoUrl: (mote.data as any).videoUrl } : {}),
  }

  const related = {
    beslut: beslutRows.map((b) => ({
      id: b.id,
      paragraf: (b.data as any).paragrafNr,
      rubrik: (b.data as any).rubrik,
      beslut: (b.data as any).beslut,
      _links: beslutLinks(kommun, b.id, datum),
    })),
    närvarande: nearvaroRows
      .filter((r) => r.fornamn)
      .map((r) => ({
        namn: `${r.fornamn} ${r.efternamn}`,
        parti: r.parti,
        tid: r.label || '',
        _links: r.politiker_id ? { politiker: { href: `${baseUrl(kommun)}/politiker/${r.politiker_id}` } } : undefined,
      })),
    anföranden: anförandenRows.map((r) => {
      const polId = (r.pol_id as string).replace('pol-', '')
      return {
        talare: (r.data as any).talare,
        parti: r.parti,
        politikerId: polId,
        ärende: (r.data as any).ärende,
        ärendeTitel: (r.data as any).ärendeTitel,
        text: (r.data as any).text,
        ordning: (r.data as any).ordning,
        _links: { politiker: { href: `${baseUrl(kommun)}/politiker/${polId}` } },
      }
    }),
  }

  return c.json(halResource(item, möteLinks(kommun, datum), related), 200)
})

// --- Beslut ---
const beslutRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut',
  tags: ['Beslut'],
  summary: 'Lista/sök beslut',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({
      datum: z.string().optional(),
      år: z.string().optional(),
      sök: z.string().optional(),
      organ: z.enum(['kf', 'ks', 'all']).optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ kommun: z.string(), beslut: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(beslutRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { datum, år, sök, organ, limit } = c.req.valid('query')
  const lim = capLimit(limit, 2000)
  let rows
  if (datum) {
    rows =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY (data->>'paragrafNr')::int LIMIT ${lim}`
  } else if (år) {
    rows =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' LIKE ${`${år}-%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC, (data->>'paragrafNr')::int LIMIT ${lim}`
  } else if (sök) {
    rows =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND label ILIKE ${`%${sök}%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC LIMIT ${lim}`
  } else {
    rows =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC, (data->>'paragrafNr')::int DESC LIMIT ${lim}`
  }

  // Check which beslut have namnupprop (röstade-edges)
  const ids = rows.map((r) => r.id)
  const namnuppropIds =
    ids.length > 0
      ? await sql`SELECT DISTINCT to_id FROM goteborg.graf_edges WHERE to_id = ANY(${ids}) AND typ LIKE 'röstade_%'`
      : []
  const namnuppropSet = new Set(namnuppropIds.map((r) => r.to_id))

  const items = rows.map((r) => ({
    id: r.id,
    organ: (r.id as string).startsWith('ks-') ? 'KS' : 'KF',
    paragraf: (r.data as any).paragrafNr ? `§ ${(r.data as any).paragrafNr}` : null,
    rubrik: r.label,
    datum: (r.data as any).datum,
    beslut: (r.data as any).beslut,
    votering: (r.data as any).votering,
    namnupprop: namnuppropSet.has(r.id),
    ärendeNr: (r.data as any).ärendeNr,
    _links: beslutLinks(kommun, r.id, (r.data as any).datum),
  }))
  return c.json(halCollection(items, beslutListLinks(kommun)), 200)
})

const beslutDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut/{id}',
  tags: ['Beslut'],
  summary: 'Enskilt beslut med kopplingar',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ beslut: z.unknown(), kopplingar: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(beslutDetailRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Beslut inte hittat' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => (e.from_id === id ? e.to_id : e.from_id)))]
  const related =
    relatedIds.length > 0
      ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})`
      : []

  // Build röster from edges if not in node data
  let röster = (node.data as any).röster
  if (!röster) {
    const voteEdges = edges.filter((e) => e.typ.startsWith('röstade_') && e.to_id === id)
    if (voteEdges.length > 0) {
      const voterIds = voteEdges.map((e) => e.from_id)
      const voters =
        await sql`SELECT id, label, data->>'parti' as parti FROM goteborg.graf_nodes WHERE id = ANY(${voterIds})`
      const voterMap = new Map(voters.map((v) => [v.id, v]))
      röster = voteEdges.map((e) => {
        const voter = voterMap.get(e.from_id)
        const namn = voter?.label?.replace(/\s*\([^)]+\)$/, '') || ''
        return {
          namn,
          parti: voter?.parti || '',
          röst: e.typ.replace('röstade_', ''),
          politikerId: e.from_id.replace('politiker-', ''),
          _links: { politiker: { href: `${baseUrl(kommun)}/politiker/${e.from_id.replace('politiker-', '')}` } },
        }
      })
    }
  }

  const datum = (node.data as any).datum

  const item = { id: node.id, ...node.data, label: node.label, röster }
  const kopplingar = edges.map((e) => {
    const target = related.find((r) => r.id === (e.from_id === id ? e.to_id : e.from_id))
    return {
      typ: e.typ,
      riktning: e.from_id === id ? 'ut' : 'in',
      nod: target ? { id: target.id, typ: target.typ, label: target.label } : null,
    }
  })

  return c.json(halResource(item, beslutLinks(kommun, id, datum), { kopplingar }), 200)
})

// --- Anföranden per beslut ---
const anförandenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut/{id}/anforanden',
  tags: ['Beslut'],
  summary: 'Anföranden (debattinlägg) kopplade till ett beslut',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({}).passthrough().openapi('Anföranden') } },
      description: 'OK',
    },
  },
})
app.openapi(anförandenRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)

  // Get anförande nodes linked via 'diskuterade' edge
  const anföranden = await sql`
    SELECT a.id, a.label, a.data, e2.from_id as politiker_id
    FROM goteborg.graf_edges e
    JOIN goteborg.graf_nodes a ON a.id = e.from_id
    LEFT JOIN goteborg.graf_edges e2 ON e2.to_id = a.id AND e2.typ = 'talade_i'
    WHERE e.to_id = ${id} AND e.typ = 'diskuterade'
    ORDER BY a.id`

  if (anföranden.length === 0) {
    return c.json(halCollection([], anförandenLinks(kommun, 'beslut', id)), 200)
  }

  // Load full text from yttrandeprotokoll (new format) or speakers (legacy fallback)
  const datum = (anföranden[0].data as any)?.datum
  let speakersData: any[] = []
  if (datum) {
    try {
      const { readFileSync, existsSync } = await import('node:fs')
      const { join } = await import('node:path')
      // New format: kf-{datum}.json (from parse-yttrandeprotokoll)
      const newPath = join(import.meta.dirname, `../../../data/debatter/kf-${datum}.json`)
      const legacyPath = join(import.meta.dirname, `../../../data/debatter/speakers-${datum}.json`)
      const path = existsSync(newPath) ? newPath : legacyPath
      if (existsSync(path)) {
        const file = JSON.parse(readFileSync(path, 'utf-8'))
        speakersData = file.anföranden || []
      }
    } catch {}
  }

  // Match anförande nodes to speakers text by index
  const results = anföranden.map((a, idx) => {
    const label = a.label as string
    const indexMatch = (a.id as string).match(/anforande-[\d-]+-(\d+)$/)
    const speakerIdx = indexMatch ? Number.parseInt(indexMatch[1]) : -1
    const speaker = speakerIdx >= 0 ? speakersData[speakerIdx] : null
    const polId = a.politiker_id?.replace('politiker-', '') || null

    return {
      id: a.id,
      talare: speaker?.talare || label.split(' — ')[0] || '',
      parti: speaker?.parti || '',
      politikerId: polId,
      text: speaker?.text || null,
      _links: polId ? { politiker: { href: `${baseUrl(kommun)}/politiker/${polId}` } } : undefined,
    }
  })

  return c.json(halCollection(results, anförandenLinks(kommun, 'beslut', id)), 200)
})

// --- Budget ---
const budgetRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/budget',
  tags: ['Budget'],
  summary: 'Kommunbudget per nämnd (filtrera på år med ?år=2024)',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ år: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ kommun: z.string(), nämnder: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(budgetRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const år = c.req.valid('query').år
  if (år) {
    const budgetNode =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${`budget-${år}`} AND typ = 'budget'`
    if (budgetNode.length === 0) {
      const item = { år: Number(år), totalMnkr: 0, styre: null }
      return c.json(halResource(item, budgetLinks(kommun, år), { nämnder: [] }), 200)
    }
    const meta = budgetNode[0].data as any
    const rows =
      await sql`SELECT n.* FROM goteborg.graf_nodes n JOIN goteborg.graf_edges e ON e.to_id = n.id WHERE e.from_id = ${`budget-${år}`} AND e.typ = 'finansierar' ORDER BY (n.data->>'kommunbidragMnkr')::float DESC NULLS LAST`
    const item = { år: Number(år), totalMnkr: meta.totalMnkr, styre: meta.styre }
    const nämnder = rows.map((r) => ({ id: r.id, namn: r.label, ...(r.data as object) }))
    return c.json(halResource(item, budgetLinks(kommun, år), { nämnder }), 200)
  }
  // Utan år: returnera alla tillgängliga budgetår med summary
  const years =
    await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'budget' AND id LIKE 'budget-20%' AND data ? 'totalMnkr' ORDER BY (data->>'år')::int`
  const items = years.map((y) => ({
    år: (y.data as any).år,
    totalMnkr: (y.data as any).totalMnkr,
    styre: (y.data as any).styre,
    _links: budgetLinks(kommun, String((y.data as any).år)),
  }))
  return c.json(halCollection(items, budgetLinks(kommun)), 200)
})

// --- Möte anföranden (yttrandeprotokoll) ---
const moteAnforandenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/möten/{datum}/anföranden',
  tags: ['Möten'],
  summary: 'Alla anföranden från ett sammanträde (?talare=, ?ärende=, ?q=)',
  request: {
    params: z.object({ kommun: z.string(), datum: z.string() }),
    query: z.object({ talare: z.string().optional(), ärende: z.string().optional(), q: z.string().optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({}).passthrough().openapi('MoteAnforanden') } }, description: 'OK' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' },
  },
})
app.openapi(moteAnforandenRoute, async (c) => {
  const { kommun, datum } = c.req.valid('param')
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const path = join(import.meta.dirname, `../../../data/debatter/kf-${datum}.json`)
  if (!existsSync(path)) return c.json({ error: 'Inget yttrandeprotokoll för detta datum' }, 404)
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  const { talare, ärende, q } = c.req.valid('query')
  let anföranden = data.anföranden
  if (talare)
    anföranden = anföranden.filter((a: any) =>
      a.talare.toLowerCase().includes(talare.toLowerCase()),
    )
  if (ärende) anföranden = anföranden.filter((a: any) => String(a.ärende) === ärende)
  if (q) anföranden = anföranden.filter((a: any) => a.text?.toLowerCase().includes(q.toLowerCase()))

  // Add _links to each anförande if politikerId exists
  const items = anföranden.map((a: any) => ({
    ...a,
    _links: a.politikerId ? { politiker: { href: `${baseUrl(kommun)}/politiker/${a.politikerId}` } } : undefined,
  }))

  return c.json(
    halCollection(items, {
      self: { href: `${baseUrl(kommun)}/möten/${datum}/anföranden` },
      möte: { href: `${baseUrl(kommun)}/möten/${datum}` },
    }),
    200,
  )
})

// --- Uppdrag per nämnd ---
app.get('/api/v1/:kommun/graf/uppdrag-per-nämnd', async (c) => {
  const rows =
    await sql`SELECT n.label as namn, COUNT(*)::int as count FROM goteborg.graf_edges e JOIN goteborg.graf_nodes n ON n.id = e.to_id WHERE e.typ = 'uppdrag_till' GROUP BY n.label ORDER BY count DESC`
  return c.json({ rows })
})

// Anföranden per politiker (from talade_i edges)
app.get('/api/v1/:kommun/politiker/:id/anforanden', async (c) => {
  const kommun = c.req.param('kommun')
  const id = c.req.param('id')
  const datum = c.req.query('datum')
  const rows = datum
    ? await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM goteborg.graf_edges e
        JOIN goteborg.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i' AND e.data->>'datum' = ${datum}
        ORDER BY (e.data->>'ordning')::int`
    : await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM goteborg.graf_edges e
        JOIN goteborg.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i'
        ORDER BY (e.data->>'datum') DESC, (e.data->>'ordning')::int`
  const items = rows.map((r) => ({
    datum: r.datum,
    möte: r.mote,
    ärende: (r.data as any).ärende,
    ärendeTitel: (r.data as any).ärendeTitel,
    text: (r.data as any).text,
    ordning: (r.data as any).ordning,
    _links: { möte: { href: `${baseUrl(kommun)}/möten/${r.datum}` } },
  }))
  return c.json(halCollection(items, anförandenLinks(kommun, 'politiker', id, datum || undefined)))
})

// Politiker per nämnd via graf — returnerar politiker med API-länk
app.get('/api/v1/:kommun/graf/politiker-per-nämnd', async (c) => {
  const rows =
    await sql`SELECT e.to_id as namnd_id, n.label as namnd, gp.id as pol_id, gp.label as namn, gp.data->>'parti' as parti, e.data->>'roll' as roll
      FROM goteborg.graf_edges e
      JOIN goteborg.graf_nodes n ON n.id = e.to_id
      JOIN goteborg.graf_nodes gp ON gp.id = e.from_id
      WHERE e.typ = 'ledamot_i' AND gp.typ = 'politiker' AND e.data->>'roll' NOT LIKE 'Ersättare%'
      ORDER BY n.label, gp.label`

  // Group by nämnd, then sort each nämnd's politicians by party size (desc)
  const byNämnd = new Map<string, any[]>()
  for (const r of rows) {
    if (!byNämnd.has(r.namnd)) byNämnd.set(r.namnd, [])
    const uuid = (r.pol_id as string).replace(/^pol-/, '')
    byNämnd.get(r.namnd)!.push({
      id: uuid,
      namn: r.namn,
      parti: r.parti,
      roll: r.roll,
      url: `/api/v1/${c.req.param('kommun')}/politiker/${uuid}`,
    })
  }

  // Sort each nämnd: by official 2022 KF mandate count (Valmyndigheten 2022-09-11)
  const officialSeats: Record<string, number> = {
    S: 21,
    M: 14,
    V: 13,
    SD: 9,
    MP: 5,
    L: 5,
    D: 5,
    KD: 4,
    C: 5,
  }
  const partiRank = new Map(
    Object.entries(officialSeats)
      .sort((a, b) => b[1] - a[1])
      .map(([p], i) => [p, i]),
  )
  for (const [, pols] of byNämnd) {
    pols.sort(
      (a, b) =>
        (partiRank.get(a.parti) ?? 99) - (partiRank.get(b.parti) ?? 99) ||
        a.namn.localeCompare(b.namn, 'sv'),
    )
  }

  return c.json(Object.fromEntries(byNämnd))
})

// --- Graf ---
const grafRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/graf',
  tags: ['Knowledge Graph'],
  summary: 'Graf översikt eller filtrering',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ datum: z.string().optional(), typ: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ nodes: z.unknown(), edges: z.unknown() }) },
      },
      description: 'OK',
    },
  },
})
app.openapi(grafRoute, async (c) => {
  const { datum, typ } = c.req.valid('query')
  if (datum) {
    const nodes =
      await sql`SELECT * FROM goteborg.graf_nodes WHERE data->>'datum' = ${datum} OR id = ${`möte-kf-${datum}`}`
    const allIds = nodes.map((n) => n.id)
    const edges =
      allIds.length > 0
        ? await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ANY(${allIds}) OR to_id = ANY(${allIds})`
        : []
    const relatedIds = [
      ...new Set(edges.flatMap((e) => [e.from_id, e.to_id]).filter((id) => !allIds.includes(id))),
    ]
    const relatedNodes =
      relatedIds.length > 0
        ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})`
        : []
    return c.json({ nodes: [...nodes, ...relatedNodes], edges }, 200)
  }
  if (typ) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = ${typ}`
    return c.json({ antal: nodes.length, nodes }, 200)
  }
  const counts =
    await sql`SELECT typ, COUNT(*)::int as antal FROM goteborg.graf_nodes GROUP BY typ ORDER BY antal DESC`
  const edgeCount = await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges`
  return c.json({ nodes: counts, edges: edgeCount[0].total }, 200)
})

const grafNodeRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/graf/node/{id}',
  tags: ['Knowledge Graph'],
  summary: 'Traversera graf — enskild nod med alla kopplingar',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            node: GraphNode,
            edges: z.array(GraphEdge),
            related: z.array(GraphNode),
          }),
        },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(grafNodeRoute, async (c) => {
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => (e.from_id === id ? e.to_id : e.from_id)))]
  const related =
    relatedIds.length > 0
      ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})`
      : []
  return c.json({ node, edges, related } as any, 200)
})

// --- Sök ---
const sökRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/sök',
  tags: ['Sök'],
  summary: 'Fritextsökning',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ q: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ query: z.string(), resultat: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(sökRoute, async (c) => {
  const q = c.req.valid('query').q
  const politiker =
    await sql`SELECT id, fornamn || ' ' || efternamn as namn, parti, 'politiker' as typ FROM goteborg.politiker WHERE fornamn ILIKE ${`%${q}%`} OR efternamn ILIKE ${`%${q}%`} LIMIT 10`
  const nodes =
    await sql`SELECT id, label, typ FROM goteborg.graf_nodes WHERE label ILIKE ${`%${q}%`} LIMIT 20`
  return c.json({ query: q, resultat: [...politiker, ...nodes] }, 200)
})

// --- Stats ---
const statsRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/stats',
  tags: ['Statistik'],
  summary: 'Övergripande statistik',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              kommun: z.string(),
              politiker: z.number(),
              partier: z.record(z.number()),
              graf: z.object({ nodes: z.number(), edges: z.number() }),
            })
            .openapi('Stats'),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(statsRoute, async (c) => {
  const [pol, parties, nodeCount, edgeCount] = await Promise.all([
    sql`SELECT COUNT(*)::int as total FROM goteborg.politiker`,
    // Official KF mandatfördelning 2022 election (81 seats total)
    // Source: Valmyndigheten resultat 2022-09-11, Göteborgs kommunfullmäktige
    sql`SELECT parti, COUNT(DISTINCT id)::int as antal FROM goteborg.politiker
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(uppdrag) u
          WHERE u->>'organisation' ILIKE '%Kommunfullmäktige%'
            AND u->>'roll' NOT ILIKE 'Ersättare%'
        )
        GROUP BY parti ORDER BY antal DESC`,
    sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes`,
    sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges`,
  ])
  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      politiker: pol[0].total,
      // Official 2022 election results — Göteborgs kommunfullmäktige (Valmyndigheten 2022-09-11)
      partier: { S: 21, M: 14, V: 13, SD: 9, MP: 5, L: 5, D: 5, KD: 4, C: 5 },
      graf: { nodes: nodeCount[0].total, edges: edgeCount[0].total },
    },
    200,
  )
})

// --- Metrics ---
const metricsRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/metrics',
  tags: ['Statistik'],
  summary: 'Demokratiska nyckeltal',
  description:
    'Automatiskt beräknade KPI:er för kommunfullmäktige: beslutskraft, konsensus, partilojalitet, aktivitet.',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({}).passthrough().openapi('Metrics') } },
      description: 'OK',
    },
  },
})
app.openapi(metricsRoute, async (c) => {
  // All metrics computed from edges — no JSONB scanning

  // Beslutskraft
  const beslutTyper =
    await sql`SELECT data->>'beslut' as typ, COUNT(*)::int as antal FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'beslut' IS NOT NULL GROUP BY data->>'beslut'`
  const totalBeslut = beslutTyper.reduce((s, r) => s + r.antal, 0)
  const bifall = beslutTyper.find((r) => r.typ === 'bifall')?.antal || 0
  const bordlagd = beslutTyper.find((r) => r.typ === 'bordläggning')?.antal || 0

  // Bordläggningsorsaker
  const bordOrsaker =
    await sql`SELECT data->>'bordläggningsorsak' as orsak, COUNT(*)::int as antal FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'beslut' = 'bordläggning' AND data->>'bordläggningsorsak' IS NOT NULL GROUP BY data->>'bordläggningsorsak'`

  // Konsensus (paragraf nodes without any röstade edges = decided without vote)
  const [{ total: totalParagrafer }] =
    await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes WHERE typ = 'paragraf'`
  const [{ antal: medVotering }] =
    await sql`SELECT COUNT(DISTINCT to_id)::int as antal FROM goteborg.graf_edges WHERE typ LIKE 'röstade_%'`
  const utanVotering = totalParagrafer - medVotering

  // Parti-statistik from edges (SQL aggregation)
  const partiStats = await sql`
    SELECT 
      n.data->>'parti' as parti,
      e.typ,
      COUNT(*)::int as antal
    FROM goteborg.graf_edges e
    JOIN goteborg.graf_nodes n ON n.id = e.from_id AND n.typ = 'politiker'
    WHERE e.typ LIKE 'röstade_%'
    GROUP BY n.data->>'parti', e.typ
    ORDER BY parti`

  // Aggregate per party
  const partier: Record<string, { ja: number; nej: number; avstår: number; total: number }> = {}
  for (const row of partiStats) {
    if (!partier[row.parti]) partier[row.parti] = { ja: 0, nej: 0, avstår: 0, total: 0 }
    partier[row.parti].total += row.antal
    if (row.typ === 'röstade_ja') partier[row.parti].ja += row.antal
    else if (row.typ === 'röstade_nej') partier[row.parti].nej += row.antal
    else if (row.typ === 'röstade_avstår') partier[row.parti].avstår += row.antal
  }

  // Jäv och reservationer
  const [{ antal: jävAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM goteborg.graf_edges WHERE typ = 'jävsanmälan'`
  const [{ antal: resAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM goteborg.graf_edges WHERE typ = 'reserverade_sig'`
  const [{ antal: yrkAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM goteborg.graf_edges WHERE typ = 'yrkat'`

  // --- Rice Index per parti (avg across all voteringar) ---
  // For each votering, Rice = abs(ja - nej) / (ja + nej) per party
  const riceData = await sql`
    SELECT
      n.data->>'parti' as parti,
      e.to_id as paragraf_id,
      SUM(CASE WHEN e.typ = 'röstade_ja' THEN 1 ELSE 0 END)::int as ja,
      SUM(CASE WHEN e.typ = 'röstade_nej' THEN 1 ELSE 0 END)::int as nej
    FROM goteborg.graf_edges e
    JOIN goteborg.graf_nodes n ON n.id = e.from_id AND n.typ = 'politiker'
    WHERE e.typ LIKE 'röstade_%' AND e.typ != 'röstade_avstår'
    GROUP BY n.data->>'parti', e.to_id
    HAVING SUM(CASE WHEN e.typ IN ('röstade_ja','röstade_nej') THEN 1 ELSE 0 END) > 0`

  const ricePerParti: Record<string, { sum: number; count: number }> = {}
  for (const row of riceData) {
    const rice = row.ja + row.nej > 0 ? Math.abs(row.ja - row.nej) / (row.ja + row.nej) : 1
    if (!ricePerParti[row.parti]) ricePerParti[row.parti] = { sum: 0, count: 0 }
    ricePerParti[row.parti].sum += rice
    ricePerParti[row.parti].count++
  }
  const riceIndex = Object.fromEntries(
    Object.entries(ricePerParti).map(([p, d]) => [p, Math.round((d.sum / d.count) * 100) / 100]),
  )

  // --- Attendance Rate (närvarade edges: politiker → möte) ---
  const [{ total: totalNärvaro }] =
    await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges WHERE typ = 'närvarade'`
  const [{ total: totalMöten }] =
    await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes WHERE typ = 'möte'`
  const snittNärvarande = totalMöten > 0 ? Math.round(totalNärvaro / totalMöten) : 0

  // --- Debate Participation Gini (from anförande nodes, grouped by politician name) ---
  const speechCounts = await sql`
    SELECT label, COUNT(*)::int as speeches
    FROM goteborg.graf_nodes
    WHERE typ = 'anförande'
    GROUP BY label
    ORDER BY speeches DESC`

  // Extract politician name from label "Name (Party) — ..."
  const speakerCounts: Record<string, number> = {}
  for (const row of speechCounts) {
    const match = (row.label as string).match(/^(.+?)\s*\(/)
    const name = match ? match[1].trim() : row.label
    speakerCounts[name] = (speakerCounts[name] || 0) + row.speeches
  }

  let debateGini = 0
  const speakerValues = Object.values(speakerCounts).sort((a, b) => a - b)
  if (speakerValues.length > 1) {
    const n = speakerValues.length
    const mean = speakerValues.reduce((s, v) => s + v, 0) / n
    let sumDiff = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiff += Math.abs(speakerValues[i] - speakerValues[j])
      }
    }
    debateGini = Math.round((sumDiff / (2 * n * n * mean)) * 100) / 100
  }

  // --- Debate Depth (anföranden per ärende med votering) ---
  const [{ total: totalAnföranden }] =
    await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes WHERE typ = 'anförande'`
  const debateDepth = medVotering > 0 ? Math.round((totalAnföranden / medVotering) * 10) / 10 : 0

  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      period: '2022-2026',
      beslutskraft: {
        totalt: totalBeslut,
        bifall,
        bordläggning: bordlagd,
        beslutskraftProcent: totalBeslut > 0 ? Math.round((bifall / totalBeslut) * 100) : 0,
        bordläggningsorsaker: Object.fromEntries(bordOrsaker.map((r) => [r.orsak, r.antal])),
      },
      konsensus: {
        totaltÄrenden: totalParagrafer,
        utanVotering,
        medVotering,
        konsensusgradProcent:
          totalParagrafer > 0 ? Math.round((utanVotering / totalParagrafer) * 100) : 0,
      },
      aktivitet: { jävsanmälningar: jävAntal, reservationer: resAntal, yrkanden: yrkAntal },
      riceIndex,
      närvaro: { registreringar: totalNärvaro, möten: totalMöten, snittPerMöte: snittNärvarande },
      debatt: {
        giniKoefficient: debateGini,
        anföranden: totalAnföranden,
        djupPerÄrende: debateDepth,
      },
      partilojalitet: Object.fromEntries(
        Object.entries(partier).map(([parti, d]) => [
          parti,
          { ...d, jaProcent: d.total > 0 ? Math.round((d.ja / d.total) * 100) : 0 },
        ]),
      ),
    },
    200,
  )
})

// --- Dokument (full-text parsed documents for AI/research) ---
const dokumentListRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/dokument',
  tags: ['Dokument'],
  summary: 'Lista alla dokument med metadata',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ typ: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            antal: z.number(),
            dokument: z.array(
              z.object({
                id: z.string(),
                titel: z.string(),
                typ: z.string(),
                nämnd: z.string(),
                datum: z.string(),
                källa: z.string(),
                graf_nod: z.string().nullable(),
                chars: z.number(),
              }),
            ),
          }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(dokumentListRoute, async (c) => {
  const { typ } = c.req.valid('query')
  const docs = typ
    ? await sql`SELECT id, titel, typ, namnd, datum, kalla, graf_nod, LENGTH(innehall)::int as chars FROM goteborg.dokument WHERE typ = ${typ} ORDER BY datum DESC`
    : await sql`SELECT id, titel, typ, namnd, datum, kalla, graf_nod, LENGTH(innehall)::int as chars FROM goteborg.dokument ORDER BY datum DESC`
  return c.json(
    {
      antal: docs.length,
      dokument: docs.map((d) => ({
        id: d.id,
        titel: d.titel,
        typ: d.typ,
        nämnd: d.namnd,
        datum: d.datum,
        källa: d.kalla,
        graf_nod: d.graf_nod,
        chars: d.chars,
      })),
    },
    200,
  )
})

const dokumentDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/dokument/{id}',
  tags: ['Dokument'],
  summary: 'Hämta dokument med full text',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            titel: z.string(),
            typ: z.string(),
            nämnd: z.string(),
            datum: z.string(),
            källa: z.string(),
            graf_nod: z.string().nullable(),
            innehåll: z.string(),
          }),
        },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(dokumentDetailRoute, async (c) => {
  const id = c.req.valid('param').id
  const [doc] = await sql`SELECT * FROM goteborg.dokument WHERE id = ${id}`
  if (!doc) return c.json({ error: 'Dokument ej hittat' }, 404)
  return c.json(
    {
      id: doc.id,
      titel: doc.titel,
      typ: doc.typ,
      nämnd: doc.namnd,
      datum: doc.datum,
      källa: doc.kalla,
      graf_nod: doc.graf_nod,
      innehåll: doc.innehall,
    } as any,
    200,
  )
})

const dokumentSökRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/dokument/sök',
  tags: ['Dokument'],
  summary: 'Sök i dokumentinnehåll (fulltext)',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ q: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ query: z.string(), resultat: z.array(z.unknown()) }),
        },
      },
      description: 'OK',
    },
  },
})
app.openapi(dokumentSökRoute, async (c) => {
  const q = c.req.valid('query').q
  const results =
    await sql`SELECT id, titel, typ, datum, ts_headline('swedish', innehall, plainto_tsquery('swedish', ${q}), 'MaxWords=60,MinWords=20') as utdrag FROM goteborg.dokument WHERE to_tsvector('swedish', innehall) @@ plainto_tsquery('swedish', ${q})`
  return c.json({ query: q, resultat: results }, 200)
})

// --- Förvaltningsdirektörer (löner) ---
const direktörerRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/lon/direktorer',
  tags: ['Löner'],
  summary: 'Löner för förvaltningsdirektörer',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ sort: z.enum(['namn', 'lön', 'anställd']).optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({}).passthrough().openapi('Direktörer') } },
      description: 'OK',
    },
  },
})
app.openapi(direktörerRoute, async (c) => {
  const { sort } = c.req.valid('query')
  const rows = await sql`
    SELECT id, label, data FROM goteborg.graf_nodes
    WHERE typ = 'förvaltningsdirektör'
    ORDER BY CASE
      WHEN ${sort || 'namn'} = 'lön' THEN lpad((data->>'lön')::text, 10, '0')
      WHEN ${sort || 'namn'} = 'anställd' THEN data->>'anställd'
      ELSE data->>'namn'
    END`
  if (rows.length === 0) {
    // Fallback: read from file if not yet seeded
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const filePath = join(import.meta.dirname, '../../../data/lon/forvaltningsdirektorer-2026.json')
    if (!existsSync(filePath)) return c.json({ antal: 0, direktörer: [] }, 200)
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return c.json(
      {
        kommun: c.req.valid('param').kommun,
        datum: data.datum,
        antal: data.direktörer.length,
        direktörer: data.direktörer,
      },
      200,
    )
  }
  const direktörer = rows.map((r) => ({ id: r.id, ...r.data }))
  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      datum: '2026-04-01',
      antal: direktörer.length,
      direktörer,
    },
    200,
  )
})

const förvaltningarRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar',
  tags: ['Förvaltningar'],
  summary: 'Lista alla förvaltningar med direktör, budget och utfall',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('Förvaltningar') },
      },
      description: 'OK',
    },
  },
})
app.openapi(förvaltningarRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const direktörer =
    await sql`SELECT id, label, data FROM goteborg.graf_nodes WHERE typ = 'förvaltningsdirektör' ORDER BY data->>'namn'`
  const results = []
  for (const d of direktörer) {
    const [lederEdge] =
      await sql`SELECT to_id FROM goteborg.graf_edges WHERE from_id = ${d.id} AND typ = 'leder' LIMIT 1`
    const nämndId = lederEdge?.to_id || null
    const [nämnd] = nämndId
      ? await sql`SELECT id, label, data FROM goteborg.graf_nodes WHERE id = ${nämndId}`
      : [null]
    const [utfall] = nämndId
      ? await sql`SELECT data FROM goteborg.graf_nodes WHERE typ = 'utfall' AND id LIKE ${'utfall-nämnd-%'} AND data->>'nämnd' = ${(nämnd?.label || '').replace(/^Göteborgs Stads /, '')}`
      : [null]
    const [revision] = nämndId
      ? await sql`SELECT n.data FROM goteborg.graf_edges e JOIN goteborg.graf_nodes n ON n.id = e.from_id WHERE e.to_id = ${nämndId} AND e.typ = 'riktas_mot' LIMIT 1`
      : [null]
    results.push({
      id: d.id,
      nämndId,
      direktör: d.data,
      nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
      utfall: utfall?.data || null,
      revision: revision?.data || null,
      _links: förvaltningLinks(kommun, d.id),
    })
  }
  return c.json(halCollection(results, förvaltningarListLinks(kommun)), 200)
})

const förvaltningDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar/{id}',
  tags: ['Förvaltningar'],
  summary: 'Enskild förvaltning — direktör, nämnd, budget, utfall, revision, ledamöter',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('FörvaltningDetail') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(förvaltningDetailRoute, async (c) => {
  const { kommun, id } = c.req.valid('param')
  const direktörId = id.startsWith('direktör-') ? id : `direktör-${id}`

  const [direktör] =
    await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${direktörId} AND typ = 'förvaltningsdirektör'`
  if (!direktör) return c.json({ error: 'Förvaltning inte hittad' }, 404)

  const edges =
    await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${direktörId} OR to_id = ${direktörId}`

  // Nämnd
  const lederEdge = edges.find((e) => e.from_id === direktörId && e.typ === 'leder')
  const [nämnd] = lederEdge
    ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${lederEdge.to_id}`
    : [null]

  // Ledamöter (politiker → nämnd via organisationsstruktur edges)
  const ledamöter = nämnd
    ? await sql`SELECT n.id, n.label, n.data FROM goteborg.graf_edges e JOIN goteborg.graf_nodes n ON n.id = e.from_id WHERE e.to_id = ${nämnd.id} AND n.typ = 'politiker' LIMIT 50`
    : []

  // Utfall
  const utfallNodes =
    await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'utfall' AND id LIKE ${'utfall-nämnd-%'}`
  const utfall = utfallNodes.filter((n) =>
    edges.some((e) => e.from_id === n.id && e.to_id === direktörId),
  )

  // Revision
  const revisionIds = edges
    .filter((e) => e.to_id === direktörId && e.from_id.startsWith('revision-'))
    .map((e) => e.from_id)
  const revision =
    revisionIds.length > 0
      ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${revisionIds})`
      : []

  // Linked KF decisions per revision node
  const revisionLinks =
    revisionIds.length > 0
      ? await sql`SELECT e.from_id, e.typ, e.label, n.id as nod_id, n.label as nod_label, n.data->>'datum' as datum FROM goteborg.graf_edges e JOIN goteborg.graf_nodes n ON n.id = e.to_id WHERE e.from_id = ANY(${revisionIds}) AND e.typ IN ('hänvisar_till','behandlad_i')`
      : []

  // Budget (nämnd data has kommunbidragMnkr)
  const budget = nämnd?.data || {}

  const item = {
    direktör: { id: direktör.id, ...direktör.data },
    nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
    budget,
  }

  const related = {
    utfall: utfall.map((n) => ({ id: n.id, label: n.label, ...n.data })),
    revision: revision.map((n) => {
      const links = revisionLinks
        .filter((l) => l.from_id === n.id)
        .map((l) => ({
          typ: l.typ,
          label: l.label,
          beslutId: l.nod_id,
          beslutLabel: l.nod_label,
          datum: l.datum,
          _links: { beslut: { href: `${baseUrl(kommun)}/beslut/${encodeURIComponent(l.nod_id)}` } },
        }))
      return { id: n.id, label: n.label, ...n.data, kopplingar: links }
    }),
    ledamöter: ledamöter.map((l) => {
      const polId = (l.id as string).replace('pol-', '')
      return {
        id: l.id,
        label: l.label,
        parti: l.data?.parti,
        _links: { politiker: { href: `${baseUrl(kommun)}/politiker/${polId}` } },
      }
    }),
  }

  return c.json(halResource(item, förvaltningLinks(kommun, direktörId), related), 200)
})

const direktörResultatRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/lon/direktorer/{id}/resultat',
  tags: ['Löner'],
  summary: 'Förvaltningsdirektörs resultat — budget, utfall, revision',
  description: 'Sammanställer ekonomiskt utfall, revisionskritik och kopplingar för en direktör.',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('DirektörResultat') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
app.openapi(direktörResultatRoute, async (c) => {
  const id = c.req.valid('param').id
  const direktörId = id.startsWith('direktör-') ? id : `direktör-${id}`

  const [direktör] =
    await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${direktörId} AND typ = 'förvaltningsdirektör'`
  if (!direktör) return c.json({ error: 'Direktör inte hittad' }, 404)

  const edges =
    await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${direktörId} OR to_id = ${direktörId}`

  // Utfall nodes (ansvarig edges pointing TO this director)
  const utfallIds = edges
    .filter((e) => e.typ === 'ansvarig' && e.to_id === direktörId)
    .map((e) => e.from_id)
  const utfallNodes =
    utfallIds.length > 0
      ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${utfallIds})`
      : []

  // Revision nodes
  const revisionIds = edges
    .filter((e) => e.to_id === direktörId && e.from_id.startsWith('revision-'))
    .map((e) => e.from_id)
  const revisionNodes =
    revisionIds.length > 0
      ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${revisionIds})`
      : []

  // Nämnd
  const lederEdge = edges.find((e) => e.from_id === direktörId && e.typ === 'leder')
  const [nämnd] = lederEdge
    ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${lederEdge.to_id}`
    : [null]

  return c.json(
    {
      direktör: { id: direktör.id, ...direktör.data },
      nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
      utfall: utfallNodes.map((n) => ({ id: n.id, label: n.label, ...n.data })),
      revision: revisionNodes.map((n) => ({ id: n.id, label: n.label, ...n.data })),
    },
    200,
  )
})

// --- OpenAPI + Swagger ---
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'De Arbetar För Dig — API',
    version: '0.4.0',
    description: `Öppen demokrati-API för Göteborgs Stad.

**HAL Format (Hypertext Application Language):**

Alla svar följer HAL-standarden för hypermedia API:er.

*Listor (collections):*
\`\`\`json
{
  "_embedded": { "items": [...] },
  "_links": { "self": { "href": "/api/v1/goteborg/politiker" } },
  "total": 125
}
\`\`\`

*Resurser (single item):*
\`\`\`json
{
  "_embedded": {
    "item": { "id": "...", "namn": "..." },
    "related": { "möten": [...] }
  },
  "_links": {
    "self": { "href": "/api/v1/goteborg/politiker/{id}" },
    "collection": { "href": "/api/v1/goteborg/politiker" }
  }
}
\`\`\`

**Endpoints:**
- \`/möten?år=\` — Lista sammanträden (KF+KS) med url per möte
- \`/möten/{datum}\` — Enskilt möte: beslut, närvaro, anföranden
- \`/politiker\` — 125 KF-ledamöter med uppdrag och möten
- \`/politiker/{id}\` — Detaljprofil inkl. lista över möten där politikern talade
- \`/politiker/{id}/anforanden?datum=\` — Anföranden (tal) per möte
- \`/beslut\` — KF/KS-beslut med voteringar och ärendenummer
- \`/möten/{datum}/anföranden\` — Alla anföranden från ett sammanträde (?talare=, ?ärende=, ?q=)
- \`/budget?år=\` — Kommunbudget per nämnd (2022–2026)
- \`/graf\` — Knowledge graph (noder + kanter)
- \`/graf/node/{id}\` — Graf-nod med relaterade noder och kanter
- \`/stats\` — Demokratisk hälsa (Rice-index, Gini, konsensusgrad)
- \`/metrics\` — Beslutskraft och partilojalitet
- \`/sök?q=\` — Fulltextsökning över alla resurser

**Datakällor:** Nämndhandlingar (goteborg.se), Yttrandeprotokoll PDF, Valmyndigheten`,
    license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    contact: {
      name: 'DeArbetarForDig',
      url: 'https://github.com/DeArbetarForDig/dearbetarfordig.se',
    },
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
})
app.get('/docs', swaggerUI({ url: '/openapi.json' }))
app.get('/', (c) => c.redirect('/docs'))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API v0.4.0 at http://localhost:${info.port}`)
  console.log(`📖 Docs: http://localhost:${info.port}/docs`)
})
