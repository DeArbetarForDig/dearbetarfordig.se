import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  baseUrl,
  beslutLinks,
  halCollection,
  halResource,
  möteLinks,
  mötenListLinks,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const motenRouter = new OpenAPIHono()

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
motenRouter.openapi(mötenRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { år } = c.req.valid('query')
  const schema = requireSchema(kommun)

  // Single query — no N+1
  const meetings =
    await sql`SELECT id, data->>'datum' as datum, data->>'videoUrl' as video_url, label FROM ${sql(schema)}.graf_nodes WHERE typ = 'möte' ORDER BY data->>'datum' DESC`
  const counts =
    await sql`SELECT data->>'datum' as datum, COUNT(*)::int as antal FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' GROUP BY data->>'datum'`
  const countMap = Object.fromEntries(counts.map((c) => [c.datum, c.antal]))
  const närvaroRows = await sql`SELECT e.to_id, e.from_id, e.label, p.fornamn, p.efternamn, p.parti
      FROM ${sql(schema)}.graf_edges e
      LEFT JOIN ${sql(schema)}.politiker p ON p.id = replace(e.from_id, 'politiker-', '')::uuid
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
motenRouter.openapi(moteRoute, async (c) => {
  const { kommun, datum } = c.req.valid('param')
  const schema = requireSchema(kommun)

  const [mote] =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'möte' AND data->>'datum' = ${datum}`
  if (!mote) return c.json({ error: 'Sammanträde ej hittat' }, 404)

  const beslutRows =
    await sql`SELECT id, label, data FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ORDER BY (data->>'paragrafNr')::int`

  const nearvaroRows = await sql`
    SELECT e.label, p.fornamn, p.efternamn, p.parti, p.id as politiker_id
    FROM ${sql(schema)}.graf_edges e
    LEFT JOIN ${sql(schema)}.politiker p ON p.id = replace(e.from_id, 'politiker-', '')::uuid
    WHERE e.to_id = ${mote.id} AND e.typ = 'närvarade' AND p.id IS NOT NULL`

  // Anföranden from yttrandeprotokoll (talade_i)
  const anförandenRows = await sql`
    SELECT e.data, gp.label as talare, gp.data->>'parti' as parti, gp.id as pol_id
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes gp ON gp.id = e.from_id
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
        _links: r.politiker_id
          ? { politiker: { href: `${baseUrl(kommun)}/politiker/${r.politiker_id}` } }
          : undefined,
      })),
    anföranden: anförandenRows.map((r) => {
      const polId = (r.pol_id as string).replace('politiker-', '')
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

// --- Möte anföranden (yttrandeprotokoll) ---
const moteAnforandenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/möten/{datum}/anföranden',
  tags: ['Möten'],
  summary: 'Alla anföranden från ett sammanträde (?talare=, ?ärende=, ?q=)',
  request: {
    params: z.object({ kommun: z.string(), datum: z.string() }),
    query: z.object({
      talare: z.string().optional(),
      ärende: z.string().optional(),
      q: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('MoteAnforanden') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
motenRouter.openapi(moteAnforandenRoute, async (c) => {
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
    _links: a.politikerId
      ? { politiker: { href: `${baseUrl(kommun)}/politiker/${a.politikerId}` } }
      : undefined,
  }))

  return c.json(
    halCollection(items, {
      self: { href: `${baseUrl(kommun)}/möten/${datum}/anföranden` },
      möte: { href: `${baseUrl(kommun)}/möten/${datum}` },
    }),
    200,
  )
})
