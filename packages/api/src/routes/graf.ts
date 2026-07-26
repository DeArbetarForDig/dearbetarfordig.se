import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'
import { heltalParam, standardFel, valideringsHook } from '../lib/openapi.js'

export const grafRouter = new OpenAPIHono({ defaultHook: valideringsHook })

// --- Schemas ---
// data: z.any() — NOT z.record()/.passthrough()/z.unknown(): under this
// zod+@hono/zod-openapi combination those forms make the whole response
// infer as `never` (see hal.ts for the confirmed repro).
const GraphNode = z
  .object({ id: z.string(), typ: z.string(), label: z.string(), data: z.any() })
  .openapi('GraphNode')
const GraphEdge = z
  .object({
    id: z.string().optional(),
    from_id: z.string(),
    to_id: z.string(),
    typ: z.string(),
    label: z.string().nullable().optional(),
    data: z.any(),
  })
  .openapi('GraphEdge')

// --- Uppdrag per nämnd ---
grafRouter.get('/v1/:kommun/graf/uppdrag-per-nämnd', async (c) => {
  const schema = requireSchema(c.req.param('kommun'))
  const rows =
    await sql`SELECT n.label as namn, COUNT(*)::int as count FROM ${sql(schema)}.graf_edges e JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id WHERE e.typ = 'uppdrag_till' GROUP BY n.label ORDER BY count DESC`
  return c.json({ rows })
})

// Politiker per nämnd via graf — returnerar politiker med API-länk
grafRouter.get('/v1/:kommun/graf/politiker-per-nämnd', async (c) => {
  const schema = requireSchema(c.req.param('kommun'))
  const rows =
    await sql`SELECT e.to_id as namnd_id, n.label as namnd, gp.id as pol_id, gp.label as namn, gp.data->>'parti' as parti, e.data->>'roll' as roll,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(p.uppdrag, '[]'::jsonb)) u
          WHERE u->>'organisation' ILIKE '%Kommunfullmäktige%'
        ) as ar_kf
      FROM ${sql(schema)}.graf_edges e
      JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
      JOIN ${sql(schema)}.graf_nodes gp ON gp.id = e.from_id
      LEFT JOIN ${sql(schema)}.politiker p ON p.id = replace(gp.id, 'politiker-', '')::uuid
      WHERE e.typ = 'ledamot_i' AND gp.typ = 'politiker' AND e.data->>'roll' NOT LIKE 'Ersättare%'
      ORDER BY n.label, gp.label`

  // Group by nämnd, then sort each nämnd's politicians by party size (desc)
  const byNämnd = new Map<string, any[]>()
  for (const r of rows) {
    if (!byNämnd.has(r.namnd)) byNämnd.set(r.namnd, [])
    const uuid = (r.pol_id as string).replace(/^politiker-/, '')
    byNämnd.get(r.namnd)!.push({
      id: uuid,
      namn: r.namn,
      parti: r.parti,
      roll: r.roll,
      ärKf: r.ar_kf,
      url: `/v1/${c.req.param('kommun')}/politiker/${uuid}`,
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

// Paragrafnodernas texter dominerar helt storleken på grafsvaren:
// handlingText (ärendets underlag) är 102 MB över alla noder och fulltext
// 4,7 MB, vilket gjorde /graf?typ=paragraf till ett 113 MB-svar och
// /graf/node/{möte} till 5,6 MB — oanvändbart för en klient och en billig väg
// att belasta servern. Texterna utelämnas därför som standard; `<fält>Tecken`
// visar att de finns och hur långa de är. Hämta dem med ?fulltext=true eller,
// hellre, via /beslut/{id} som är gjord för det.
const TUNGA_TEXTFÄLT = ['fulltext', 'handlingText'] as const

function nodUtanTungText(nod: { id: string; typ: string; label: string; data: unknown }) {
  const data = (nod.data || {}) as Record<string, unknown>
  if (!TUNGA_TEXTFÄLT.some((f) => typeof data[f] === 'string')) return nod
  const kvar: Record<string, unknown> = {}
  for (const [nyckel, värde] of Object.entries(data)) {
    if (TUNGA_TEXTFÄLT.includes(nyckel as (typeof TUNGA_TEXTFÄLT)[number])) {
      kvar[`${nyckel}Tecken`] = (värde as string).length
    } else {
      kvar[nyckel] = värde
    }
  }
  return { ...nod, data: kvar }
}

// --- Graf ---
const grafRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/graf',
  operationId: 'getGraf',
  tags: ['Knowledge Graph'],
  summary: 'Graf översikt eller filtrering',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({
      datum: z.string().optional(),
      typ: z.string().optional(),
      limit: heltalParam('Max antal noder, default 500, max 5000', 1),
      offset: heltalParam('Paginering, default 0'),
      fulltext: z.enum(['true', 'false']).optional().openapi({
        description:
          'true tar med paragrafernas fulltext (stora svar — 3 900 paragrafer är ~113 MB). Default false, då `data.fulltextTecken` visar hur lång texten är.',
      }),
    }),
  },
  responses: {
    ...standardFel,
    200: {
      content: {
        // Three genuinely different shapes depending on which query param is
        // set (?datum=, ?typ=, or neither) — all fields optional to
        // accommodate whichever branch actually runs.
        'application/json': {
          schema: z.object({
            nodes: z.any().optional(),
            edges: z.any().optional(),
            antal: z.number().optional(),
            total: z.number().optional(),
          }),
        },
      },
      description: 'OK',
    },
  },
})
grafRouter.openapi(grafRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { datum, typ, limit, offset, fulltext } = c.req.valid('query')
  const schema = requireSchema(kommun)
  const lim = Math.min(Number.parseInt(limit || '500') || 500, 5000)
  const off = Number.parseInt(offset || '0') || 0
  const medFulltext = fulltext === 'true'
  const banta = (noder: { id: string; typ: string; label: string; data: unknown }[]) =>
    medFulltext ? noder : noder.map(nodUtanTungText)

  if (datum) {
    const nodes = await sql`SELECT id, typ, label, data FROM ${sql(schema)}.graf_nodes
      WHERE data->>'datum' = ${datum} OR id = ${`möte-kf-${datum}`}
      ORDER BY id LIMIT ${lim} OFFSET ${off}`
    const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total
      FROM ${sql(schema)}.graf_nodes
      WHERE data->>'datum' = ${datum} OR id = ${`möte-kf-${datum}`}`
    const allIds = nodes.map((n) => n.id)
    const edges =
      allIds.length > 0
        ? await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ANY(${allIds}) OR to_id = ANY(${allIds})`
        : []
    const relatedIds = [
      ...new Set(edges.flatMap((e) => [e.from_id, e.to_id]).filter((id) => !allIds.includes(id))),
    ]
    const relatedNodes =
      relatedIds.length > 0
        ? await sql`SELECT id, typ, label, data FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${relatedIds})`
        : []
    return c.json(
      {
        nodes: banta([...nodes, ...relatedNodes] as never),
        edges,
        total,
      },
      200,
    )
  }
  if (typ) {
    const nodes = await sql`SELECT id, typ, label, data FROM ${sql(schema)}.graf_nodes
      WHERE typ = ${typ} ORDER BY id LIMIT ${lim} OFFSET ${off}`
    const [{ total }] = await sql<
      { total: number }[]
    >`SELECT count(*)::int AS total FROM ${sql(schema)}.graf_nodes WHERE typ = ${typ}`
    return c.json({ antal: nodes.length, total, nodes: banta(nodes as never) }, 200)
  }
  const counts =
    await sql`SELECT typ, COUNT(*)::int as antal FROM ${sql(schema)}.graf_nodes GROUP BY typ ORDER BY antal DESC`
  const edgeCount = await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_edges`
  return c.json({ nodes: counts, edges: edgeCount[0].total }, 200)
})

const grafNodeRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/graf/node/{id}',
  operationId: 'getGrafNode',
  tags: ['Knowledge Graph'],
  summary: 'Traversera graf — enskild nod med alla kopplingar',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    ...standardFel,
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
grafRouter.openapi(grafNodeRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)
  const medFulltext = c.req.query('fulltext') === 'true'
  const schema = requireSchema(kommun)
  const [node] =
    await sql`SELECT id, typ, label, data FROM ${sql(schema)}.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)
  const edges =
    await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => (e.from_id === id ? e.to_id : e.from_id)))]
  const related =
    relatedIds.length > 0
      ? await sql`SELECT id, typ, label, data FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${relatedIds})`
      : []
  // Den efterfrågade noden behåller sin fulltext (det är den man bad om);
  // grannarna bantas, annars blir ett mötes 90 paragrafer 5,6 MB kontext.
  return c.json(
    { node, edges, related: medFulltext ? related : related.map(nodUtanTungText as never) } as any,
    200,
  )
})
