import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { baseUrl, halCollection, halCollectionSchema, kandidaterListLinks } from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const kandidaterRouter = new OpenAPIHono()

const Kandidat = z
  .object({
    id: z.string(),
    namn: z.string(),
    parti: z.string(),
    partiNamn: z.string().nullable(),
    listplats: z.number().nullable(),
    ålder: z.number().nullable(),
    kön: z.string().nullable(),
    fastställd: z.boolean(),
    politikerId: z.string().nullable(),
  })
  .openapi('Kandidat')
const KandidatList = halCollectionSchema(Kandidat).openapi('KandidatList')

const kandidaterRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/kandidater',
  tags: ['Kandidater'],
  summary: 'Kandidater till kommunfullmäktige, val 2026',
  description:
    'Rådata från Valmyndigheten (data.val.se), kommunfullmäktige-listor. Kandidater som redan sitter i KF är länkade till sin politiker-profil via politikerId.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ parti: z.string().optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: KandidatList } }, description: 'OK' },
  },
})
kandidaterRouter.openapi(kandidaterRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti } = c.req.valid('query')
  const schema = requireSchema(kommun)
  const rows = parti
    ? await sql`SELECT * FROM ${sql(schema)}.kandidater WHERE parti = ${parti.toUpperCase()} ORDER BY parti, listplats NULLS LAST`
    : await sql`SELECT * FROM ${sql(schema)}.kandidater ORDER BY parti, listplats NULLS LAST`
  const items = rows.map((k) => ({
    id: k.id,
    namn: k.namn,
    parti: k.parti,
    partiNamn: k.parti_namn,
    listplats: k.listplats,
    ålder: k.alder,
    kön: k.kon,
    fastställd: k.faststalld,
    politikerId: k.politiker_id,
    _links: k.politiker_id
      ? { politiker: { href: `${baseUrl(kommun)}/politiker/${k.politiker_id}` } }
      : undefined,
  }))
  return c.json(halCollection(items, kandidaterListLinks(kommun), items.length), 200)
})
