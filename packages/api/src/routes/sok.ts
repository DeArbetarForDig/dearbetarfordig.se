import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'

export const sokRouter = new OpenAPIHono()

// --- Sök ---
const sökRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/sök',
  tags: ['Sök'],
  summary: 'Fritextsökning',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ q: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ query: z.string(), resultat: z.array(z.any()) }),
        },
      },
      description: 'OK',
    },
  },
})
sokRouter.openapi(sökRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const q = c.req.valid('query').q
  const schema = requireSchema(kommun)
  const politiker = await sql`
    SELECT id, fornamn || ' ' || efternamn as namn, parti, 'politiker' as typ
    FROM ${sql(schema)}.politiker
    WHERE to_tsvector('swedish', fornamn || ' ' || efternamn) @@ plainto_tsquery('swedish', ${q})
    LIMIT 10`
  const dokument = await sql`
    SELECT id, titel, 'dokument' as typ
    FROM ${sql(schema)}.dokument
    WHERE to_tsvector('swedish', titel || ' ' || innehall) @@ plainto_tsquery('swedish', ${q})
    ORDER BY ts_rank(to_tsvector('swedish', titel || ' ' || innehall), plainto_tsquery('swedish', ${q})) DESC
    LIMIT 10`
  const nodes =
    await sql`SELECT id, label, typ FROM ${sql(schema)}.graf_nodes WHERE label ILIKE ${`%${q}%`} LIMIT 20`
  const resultat: unknown[] = [...politiker, ...dokument, ...nodes]
  return c.json({ query: q, resultat }, 200)
})
