import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { budgetLinks, halCollection, halResource } from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const budgetRouter = new OpenAPIHono()

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
budgetRouter.openapi(budgetRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const år = c.req.valid('query').år
  const schema = requireSchema(kommun)
  if (år) {
    const budgetNode =
      await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${`budget-${år}`} AND typ = 'budget'`
    if (budgetNode.length === 0) {
      const item = { år: Number(år), totalMnkr: 0, styre: null }
      return c.json(halResource(item, budgetLinks(kommun, år), { nämnder: [] }), 200)
    }
    const meta = budgetNode[0].data as any
    const rows =
      await sql`SELECT n.* FROM ${sql(schema)}.graf_nodes n JOIN ${sql(schema)}.graf_edges e ON e.to_id = n.id WHERE e.from_id = ${`budget-${år}`} AND e.typ = 'finansierar' ORDER BY (n.data->>'kommunbidragMnkr')::float DESC NULLS LAST`
    const item = { år: Number(år), totalMnkr: meta.totalMnkr, styre: meta.styre }
    const nämnder = rows.map((r) => ({ id: r.id, namn: r.label, ...(r.data as object) }))
    return c.json(halResource(item, budgetLinks(kommun, år), { nämnder }), 200)
  }
  // Utan år: returnera alla tillgängliga budgetår med summary
  const years =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'budget' AND id LIKE 'budget-20%' AND data ? 'totalMnkr' ORDER BY (data->>'år')::int`
  const items = years.map((y) => ({
    år: (y.data as any).år,
    totalMnkr: (y.data as any).totalMnkr,
    styre: (y.data as any).styre,
    _links: budgetLinks(kommun, String((y.data as any).år)),
  }))
  return c.json(halCollection(items, budgetLinks(kommun)), 200)
})
