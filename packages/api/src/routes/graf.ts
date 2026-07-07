import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'

export const grafRouter = new OpenAPIHono()

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
grafRouter.get('/api/v1/:kommun/graf/uppdrag-per-nämnd', async (c) => {
  const schema = requireSchema(c.req.param('kommun'))
  const rows =
    await sql`SELECT n.label as namn, COUNT(*)::int as count FROM ${sql(schema)}.graf_edges e JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id WHERE e.typ = 'uppdrag_till' GROUP BY n.label ORDER BY count DESC`
  return c.json({ rows })
})

// Politiker per nämnd via graf — returnerar politiker med API-länk
grafRouter.get('/api/v1/:kommun/graf/politiker-per-nämnd', async (c) => {
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
        // Three genuinely different shapes depending on which query param is
        // set (?datum=, ?typ=, or neither) — all fields optional to
        // accommodate whichever branch actually runs.
        'application/json': {
          schema: z.object({
            nodes: z.any().optional(),
            edges: z.any().optional(),
            antal: z.number().optional(),
          }),
        },
      },
      description: 'OK',
    },
  },
})
grafRouter.openapi(grafRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { datum, typ } = c.req.valid('query')
  const schema = requireSchema(kommun)
  if (datum) {
    const nodes =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE data->>'datum' = ${datum} OR id = ${`möte-kf-${datum}`}`
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
        ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${relatedIds})`
        : []
    return c.json({ nodes: [...nodes, ...relatedNodes], edges }, 200)
  }
  if (typ) {
    const nodes = await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = ${typ}`
    return c.json({ antal: nodes.length, nodes }, 200)
  }
  const counts =
    await sql`SELECT typ, COUNT(*)::int as antal FROM ${sql(schema)}.graf_nodes GROUP BY typ ORDER BY antal DESC`
  const edgeCount = await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_edges`
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
grafRouter.openapi(grafNodeRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const id = decodeURIComponent(c.req.valid('param').id)
  const schema = requireSchema(kommun)
  const [node] = await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)
  const edges =
    await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => (e.from_id === id ? e.to_id : e.from_id)))]
  const related =
    relatedIds.length > 0
      ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${relatedIds})`
      : []
  return c.json({ node, edges, related } as any, 200)
})
