import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  baseUrl,
  budgetLinks,
  halCollection,
  halCollectionSchema,
  halResource,
  halResourceWithRelatedSchema,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const budgetRouter = new OpenAPIHono()

// --- Budget ---
// Med ?år ger endpointen en HAL-RESOURCE (ett budgetår + dess nämnder som
// related); utan ?år en HAL-COLLECTION (lista av budgetår). Samma path,
// två olika envelopes — svaret typas som union av båda.
const BudgetÅrItem = z.object({
  år: z.number(),
  totalMnkr: z.any(),
  styre: z.any(),
  beslut: z.any(),
})
const BudgetÅrSummary = z.object({ år: z.any(), totalMnkr: z.any(), styre: z.any() })

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
          schema: z.union([
            halResourceWithRelatedSchema(BudgetÅrItem, z.object({ nämnder: z.array(z.any()) })),
            halCollectionSchema(BudgetÅrSummary),
          ]),
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
      const item = { år: Number(år), totalMnkr: 0, styre: null, beslut: null }
      return c.json(halResource(item, budgetLinks(kommun, år), { nämnder: [] }), 200)
    }
    const meta = budgetNode[0].data as any
    const rows =
      await sql`SELECT n.* FROM ${sql(schema)}.graf_nodes n JOIN ${sql(schema)}.graf_edges e ON e.to_id = n.id WHERE e.from_id = ${`budget-${år}`} AND e.typ = 'finansierar' ORDER BY (n.data->>'kommunbidragMnkr')::float DESC NULLS LAST`
    // Beslutet som antog budgeten (KF-§, 'antagen_genom'-edge) — finns bara
    // för budgetår vars antagande-möte täcks av KF-korpusen (från 2023-01-26;
    // 2022/2023 antogs på möten före dess och saknar därför beslut här).
    const [beslutRow] =
      await sql`SELECT n.id, n.label, n.data->>'datum' as datum FROM ${sql(schema)}.graf_edges e JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id WHERE e.from_id = ${`budget-${år}`} AND e.typ = 'antagen_genom'`
    const beslut = beslutRow
      ? {
          id: beslutRow.id,
          label: beslutRow.label,
          datum: beslutRow.datum,
          _links: {
            self: { href: `${baseUrl(kommun)}/beslut/${encodeURIComponent(beslutRow.id)}` },
          },
        }
      : null
    const item = { år: Number(år), totalMnkr: meta.totalMnkr, styre: meta.styre, beslut }
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

// --- Budgetutfall per nämnd (kommunbidrag vs faktiska kostnader) ---
const budgetUtfallRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/budget/utfall',
  tags: ['Budget'],
  summary:
    'Ekonomiskt utfall per nämnd för ett år (?år=2025) — kommunbidrag, kostnader, resultat, status',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ år: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: halCollectionSchema(z.any()).openapi('BudgetUtfall') },
      },
      description: 'OK',
    },
  },
})
budgetRouter.openapi(budgetUtfallRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const år = c.req.valid('query').år
  const schema = requireSchema(kommun)
  const rows =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'utfall' AND id LIKE ${'utfall-nämnd-%'} AND (data->>'år')::int = ${Number(år)} ORDER BY (data->>'kommunbidragMnkr')::float DESC NULLS LAST`
  const nämnder = rows.map((r) => ({ id: r.id, ...(r.data as object) }))
  return c.json(halCollection(nämnder, budgetLinks(kommun)), 200)
})
