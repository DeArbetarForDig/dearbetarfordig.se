import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'
import { standardFel, valideringsHook } from '../lib/openapi.js'

export const dokumentRouter = new OpenAPIHono({ defaultHook: valideringsHook })

// --- Dokument (full-text parsed documents for AI/research) ---
const dokumentListRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/dokument',
  operationId: 'listDokument',
  tags: ['Dokument'],
  summary: 'Lista alla dokument med metadata',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ typ: z.string().optional() }),
  },
  responses: {
    ...standardFel,
    200: {
      content: {
        'application/json': {
          schema: z.object({
            antal: z.number(),
            dokument: z.array(
              z.object({
                id: z.string(),
                titel: z.string(),
                typ: z.string(),
                nämnd: z.string(),
                datum: z.string(),
                källa: z.string(),
                graf_nod: z.string().nullable(),
                chars: z.number(),
              }),
            ),
          }),
        },
      },
      description: 'OK',
    },
  },
})
dokumentRouter.openapi(dokumentListRoute, async (c) => {
  const { typ } = c.req.valid('query')
  const schema = requireSchema(c.req.valid('param').kommun)
  const docs = typ
    ? await sql`SELECT id, titel, typ, namnd, datum, kalla, graf_nod, LENGTH(innehall)::int as chars FROM ${sql(schema)}.dokument WHERE typ = ${typ} ORDER BY datum DESC`
    : await sql`SELECT id, titel, typ, namnd, datum, kalla, graf_nod, LENGTH(innehall)::int as chars FROM ${sql(schema)}.dokument ORDER BY datum DESC`
  return c.json(
    {
      antal: docs.length,
      dokument: docs.map((d) => ({
        id: d.id,
        titel: d.titel,
        typ: d.typ,
        nämnd: d.namnd,
        datum: d.datum,
        källa: d.kalla,
        graf_nod: d.graf_nod,
        chars: d.chars,
      })),
    },
    200,
  )
})

// dokumentSökRoute registreras FÖRE dokumentDetailRoute — annars matchar Hono
// /dokument/sök mot /dokument/{id} (id="sök") och söket blir aldrig nått.
const dokumentSökRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/dokument/sök',
  operationId: 'searchDokument',
  tags: ['Dokument'],
  summary: 'Sök i dokumentinnehåll (fulltext) — DEPRECERAD, använd /sök?typ=dokument',
  deprecated: true,
  description: `**Deprecerad.** \`/v1/{kommun}/sök?typ=dokument\` gör samma sak och
mer: typade träffar, filter på organ/datum, paginering, \`_links\` och utdrag
utan HTML. Den här routen fanns före den generella sökningen och är nu en
delmängd av den.

Svaret bär \`Deprecation\`- och \`Link\`-headers enligt RFC 8594. Routen tas
bort tidigast 2027-01-01 (\`Sunset\`).`,
  request: { params: z.object({ kommun: z.string() }), query: z.object({ q: z.string().min(2) }) },
  responses: {
    ...standardFel,
    200: {
      content: {
        'application/json': {
          schema: z.object({
            query: z.string(),
            resultat: z.array(
              z.object({
                id: z.any(),
                titel: z.any(),
                typ: z.any(),
                datum: z.any(),
                utdrag: z.any(),
              }),
            ),
          }),
        },
      },
      description: 'OK',
    },
  },
})
dokumentRouter.openapi(dokumentSökRoute, async (c) => {
  const q = c.req.valid('query').q
  const kommun = c.req.valid('param').kommun
  const schema = requireSchema(kommun)
  // StartSel/StopSel tomma: den gamla varianten returnerade <b>-taggar i
  // JSON — HTML som klienten inte bett om och måste strippa själv.
  const results = await sql`
    SELECT id, titel, typ, datum, ts_headline('swedish', innehall, plainto_tsquery('swedish', ${q}), 'MaxWords=60,MinWords=20,StartSel="",StopSel=""') as utdrag
    FROM ${sql(schema)}.dokument
    WHERE to_tsvector('swedish', titel || ' ' || innehall) @@ plainto_tsquery('swedish', ${q})
    ORDER BY ts_rank(to_tsvector('swedish', titel || ' ' || innehall), plainto_tsquery('swedish', ${q})) DESC
    LIMIT 20`
  const resultat = results.map((r) => ({
    id: r.id,
    titel: r.titel,
    typ: r.typ,
    datum: r.datum,
    utdrag: r.utdrag,
  }))
  // RFC 8594: maskinläsbar deprecation. Sunset ligger långt fram — routen är
  // dokumenterad och kan finnas i klienter vi inte känner till.
  c.header('Deprecation', 'true')
  c.header('Sunset', 'Fri, 01 Jan 2027 00:00:00 GMT')
  // Header-värden måste vara ASCII (Node avvisar annars hela svaret och
  // klienten får tom body) — därför procent-kodad sökväg här.
  c.header(
    'Link',
    `</v1/${kommun}/s%C3%B6k?typ=dokument>; rel="successor-version"; title="Generell fritextsokning"`,
  )
  return c.json({ query: q, resultat }, 200)
})

const dokumentDetailRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/dokument/{id}',
  operationId: 'getDokument',
  tags: ['Dokument'],
  summary: 'Hämta dokument med full text',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    ...standardFel,
    200: {
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            titel: z.string(),
            typ: z.string(),
            nämnd: z.string(),
            datum: z.string(),
            källa: z.string(),
            graf_nod: z.string().nullable(),
            innehåll: z.string(),
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
dokumentRouter.openapi(dokumentDetailRoute, async (c) => {
  const id = c.req.valid('param').id
  const schema = requireSchema(c.req.valid('param').kommun)
  const [doc] = await sql`SELECT * FROM ${sql(schema)}.dokument WHERE id = ${id}`
  if (!doc) return c.json({ error: 'Dokument ej hittat' }, 404)
  return c.json(
    {
      id: doc.id,
      titel: doc.titel,
      typ: doc.typ,
      nämnd: doc.namnd,
      datum: doc.datum,
      källa: doc.kalla,
      graf_nod: doc.graf_nod,
      innehåll: doc.innehall,
    } as any,
    200,
  )
})
