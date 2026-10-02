import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { halCollection, halCollectionSchema, mandatListLinks } from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { standardFel, valideringsHook } from '../lib/openapi.js'

export const mandatRouter = new OpenAPIHono({ defaultHook: valideringsHook })

const Mandat = z
  .object({
    parti: z.string(),
    partiNamn: z.string(),
    antalMandat: z.number(),
    antalMandatFöregåendeVal: z.number().nullable(),
    räkningstillfälle: z.string(),
    senasteUppdateringstid: z.string().nullable(),
    valdeltagande: z.string().nullable(),
  })
  .openapi('Mandat')
const MandatList = halCollectionSchema(Mandat).openapi('MandatList')

const mandatRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/mandat',
  operationId: 'listMandat',
  tags: ['Kandidater'],
  summary: 'Mandatfördelning per parti, val 2026',
  description:
    'Rådata från Valmyndigheten (resultat.val.se), mandat per parti i kommunfullmäktige. ' +
    'Räkningstillfälle "preliminär" tills länsstyrelsens slutliga rösträkning är klar.',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    ...standardFel,
    200: { content: { 'application/json': { schema: MandatList } }, description: 'OK' },
  },
})
mandatRouter.openapi(mandatRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const rows = await sql`SELECT * FROM ${sql(schema)}.mandat ORDER BY antal_mandat DESC`
  const items = rows.map((m) => ({
    parti: m.parti,
    partiNamn: m.parti_namn,
    antalMandat: m.antal_mandat,
    antalMandatFöregåendeVal: m.antal_mandat_foregaende,
    räkningstillfälle: m.rakningstillfalle,
    senasteUppdateringstid: m.senaste_uppdateringstid,
    valdeltagande: m.valdeltagande,
  }))
  return c.json(halCollection(items, mandatListLinks(kommun), items.length), 200)
})
