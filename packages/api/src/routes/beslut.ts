import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  anförandenLinks,
  baseUrl,
  beslutLinks,
  beslutListLinks,
  halCollection,
  halCollectionSchema,
  halResource,
  halResourceWithRelatedSchema,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { capLimit } from '../lib/helpers.js'

export const beslutRouter = new OpenAPIHono()

// --- Beslut ---
const BeslutSummary = z.object({
  id: z.string(),
  organ: z.string(),
  paragraf: z.string().nullable(),
  rubrik: z.string(),
  datum: z.any(),
  beslut: z.any(),
  votering: z.any(),
  namnupprop: z.boolean(),
  ärendeNr: z.any(),
})

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
        'application/json': { schema: halCollectionSchema(BeslutSummary) },
      },
      description: 'OK',
    },
  },
})
beslutRouter.openapi(beslutRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { datum, år, sök, organ, limit } = c.req.valid('query')
  const lim = capLimit(limit, 2000)
  const schema = requireSchema(kommun)
  let rows
  let total: number
  if (datum) {
    rows =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY (data->>'paragrafNr')::int LIMIT ${lim}`
    ;[{ total }] =
      await sql`SELECT count(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``}`
  } else if (år) {
    rows =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' LIKE ${`${år}-%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC, (data->>'paragrafNr')::int LIMIT ${lim}`
    ;[{ total }] =
      await sql`SELECT count(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' LIKE ${`${år}-%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``}`
  } else if (sök) {
    rows =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND label ILIKE ${`%${sök}%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC LIMIT ${lim}`
    ;[{ total }] =
      await sql`SELECT count(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND label ILIKE ${`%${sök}%`} ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``}`
  } else {
    rows =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``} ORDER BY data->>'datum' DESC, (data->>'paragrafNr')::int DESC LIMIT ${lim}`
    ;[{ total }] =
      await sql`SELECT count(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' ${organ === 'kf' ? sql`AND id LIKE 'kf-%'` : organ === 'ks' ? sql`AND id LIKE 'ks-%'` : sql``}`
  }

  // Check which beslut have namnupprop (röstade-edges)
  const ids = rows.map((r) => r.id)
  const namnuppropIds =
    ids.length > 0
      ? await sql`SELECT DISTINCT to_id FROM ${sql(schema)}.graf_edges WHERE to_id = ANY(${ids}) AND typ LIKE 'röstade_%'`
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
  return c.json(halCollection(items, beslutListLinks(kommun), total), 200)
})

const KopplingItem = z.object({
  typ: z.string(),
  riktning: z.string(),
  nod: z.object({ id: z.any(), typ: z.any(), label: z.any() }).nullable(),
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
          schema: halResourceWithRelatedSchema(
            z.any(),
            z.object({ kopplingar: z.array(KopplingItem) }),
          ),
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
beslutRouter.openapi(beslutDetailRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)
  const schema = requireSchema(kommun)
  const [node] = await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Beslut inte hittat' }, 404)
  const edges =
    await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => (e.from_id === id ? e.to_id : e.from_id)))]
  const related =
    relatedIds.length > 0
      ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${relatedIds})`
      : []

  // Build röster from edges if not in node data
  let röster = (node.data as any).röster
  if (!röster) {
    const voteEdges = edges.filter((e) => e.typ.startsWith('röstade_') && e.to_id === id)
    if (voteEdges.length > 0) {
      const voterIds = voteEdges.map((e) => e.from_id)
      const voters =
        await sql`SELECT id, label, data->>'parti' as parti FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${voterIds})`
      const voterMap = new Map(voters.map((v) => [v.id, v]))
      röster = voteEdges.map((e) => {
        const voter = voterMap.get(e.from_id)
        const namn = voter?.label?.replace(/\s*\([^)]+\)$/, '') || ''
        return {
          namn,
          parti: voter?.parti || '',
          röst: e.typ.replace('röstade_', ''),
          politikerId: e.from_id.replace('politiker-', ''),
          _links: {
            politiker: {
              href: `${baseUrl(kommun)}/politiker/${e.from_id.replace('politiker-', '')}`,
            },
          },
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
const AnförandeItem = z.object({
  id: z.any(),
  talare: z.string(),
  parti: z.string(),
  politikerId: z.string().nullable(),
  text: z.any(),
})

const anförandenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut/{id}/anforanden',
  tags: ['Beslut'],
  summary: 'Anföranden (debattinlägg) kopplade till ett beslut',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: halCollectionSchema(AnförandeItem).openapi('Anföranden') },
      },
      description: 'OK',
    },
  },
})
beslutRouter.openapi(anförandenRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)
  const schema = requireSchema(kommun)

  // Get anförande nodes linked via 'diskuterade' edge
  const anföranden = await sql`
    SELECT a.id, a.label, a.data, e2.from_id as politiker_id
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes a ON a.id = e.from_id
    LEFT JOIN ${sql(schema)}.graf_edges e2 ON e2.to_id = a.id AND e2.typ = 'talade_i'
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
      const newPath = join(import.meta.dirname, `../../../../data/debatter/kf-${datum}.json`)
      const legacyPath = join(
        import.meta.dirname,
        `../../../../data/debatter/speakers-${datum}.json`,
      )
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
