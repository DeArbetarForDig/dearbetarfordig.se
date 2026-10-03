import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { baseUrl, halCollection, halCollectionSchema } from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { standardFel, valideringsHook } from '../lib/openapi.js'

export const sammantradenRouter = new OpenAPIHono({ defaultHook: valideringsHook })

const Sammantrade = z
  .object({
    organ: z.string(),
    datum: z.string(),
    url: z.string().describe('Kallelse/protokoll i kommunens diarium'),
  })
  .openapi('Sammantrade')

const route = createRoute({
  method: 'get',
  path: '/v1/{kommun}/sammantraden',
  operationId: 'listSammantraden',
  tags: ['Möten'],
  summary: 'Sammanträden med publicerade handlingar, länkade till kommunens diarium',
  description:
    'För kommuner där protokollen inte är tolkade till beslut (än): bara möte + länk. ' +
    'Göteborgs möten finns tolkade under /möten.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ organ: z.string().optional() }),
  },
  responses: {
    ...standardFel,
    200: {
      content: { 'application/json': { schema: halCollectionSchema(Sammantrade) } },
      description: 'OK',
    },
  },
})

sammantradenRouter.openapi(route, async (c) => {
  const { kommun } = c.req.valid('param')
  const { organ } = c.req.valid('query')
  const schema = requireSchema(kommun)
  // Tabellen finns bara för kommuner utan tolkade protokoll (seed.ts)
  const [{ finns }] =
    await sql`SELECT to_regclass(${`${schema}.sammantraden`}) IS NOT NULL AS finns`
  const rows = !finns
    ? []
    : organ
      ? await sql`SELECT organ, datum, url FROM ${sql(schema)}.sammantraden WHERE organ = ${organ} ORDER BY datum DESC`
      : await sql`SELECT organ, datum, url FROM ${sql(schema)}.sammantraden ORDER BY datum DESC, organ`
  const items = rows.map((r) => ({ organ: r.organ, datum: r.datum, url: r.url }))
  return c.json(
    halCollection(items, { self: { href: `${baseUrl(kommun)}/sammantraden` } }, items.length),
    200,
  )
})
