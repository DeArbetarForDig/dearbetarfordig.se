import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'

export const lonRouter = new OpenAPIHono()

// --- Förvaltningsdirektörer (löner) ---
const direktörerRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/lon/direktorer',
  tags: ['Löner'],
  summary: 'Löner för förvaltningsdirektörer',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ sort: z.enum(['namn', 'lön', 'anställd']).optional() }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              kommun: z.string().optional(),
              datum: z.string().optional(),
              antal: z.number(),
              direktörer: z.array(z.any()),
            })
            .openapi('Direktörer'),
        },
      },
      description: 'OK',
    },
  },
})
lonRouter.openapi(direktörerRoute, async (c) => {
  const { sort } = c.req.valid('query')
  const schema = requireSchema(c.req.valid('param').kommun)
  const rows = await sql`
    SELECT id, label, data FROM ${sql(schema)}.graf_nodes
    WHERE typ = 'förvaltningsdirektör'
    ORDER BY CASE
      WHEN ${sort || 'namn'} = 'lön' THEN lpad((data->>'lön')::text, 10, '0')
      WHEN ${sort || 'namn'} = 'anställd' THEN data->>'anställd'
      ELSE data->>'namn'
    END`
  if (rows.length === 0) {
    // Fallback: read from file if not yet seeded
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const filePath = join(
      import.meta.dirname,
      '../../../../data/lon/forvaltningsdirektorer-2026.json',
    )
    if (!existsSync(filePath)) return c.json({ antal: 0, direktörer: [] }, 200)
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return c.json(
      {
        kommun: c.req.valid('param').kommun,
        datum: data.datum,
        antal: data.direktörer.length,
        direktörer: data.direktörer,
      },
      200,
    )
  }
  const direktörer = rows.map((r) => ({ id: r.id, ...r.data }))
  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      datum: '2026-04-01',
      antal: direktörer.length,
      direktörer,
    },
    200,
  )
})

const direktörResultatRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/lon/direktorer/{id}/resultat',
  tags: ['Löner'],
  summary: 'Förvaltningsdirektörs resultat — budget, utfall, revision',
  description: 'Sammanställer ekonomiskt utfall, revisionskritik och kopplingar för en direktör.',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              direktör: z.any(),
              nämnd: z.any(),
              utfall: z.array(z.any()),
              revision: z.array(z.any()),
            })
            .openapi('DirektörResultat'),
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
lonRouter.openapi(direktörResultatRoute, async (c) => {
  const id = c.req.valid('param').id
  const schema = requireSchema(c.req.valid('param').kommun)
  const direktörId = id.startsWith('direktör-') ? id : `direktör-${id}`

  const [direktör] =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${direktörId} AND typ = 'förvaltningsdirektör'`
  if (!direktör) return c.json({ error: 'Direktör inte hittad' }, 404)

  const edges =
    await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ${direktörId} OR to_id = ${direktörId}`

  // Utfall nodes (ansvarig edges pointing TO this director)
  const utfallIds = edges
    .filter((e) => e.typ === 'ansvarig' && e.to_id === direktörId)
    .map((e) => e.from_id)
  const utfallNodes =
    utfallIds.length > 0
      ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${utfallIds})`
      : []

  // Revision nodes
  const revisionIds = edges
    .filter((e) => e.to_id === direktörId && e.from_id.startsWith('revision-'))
    .map((e) => e.from_id)
  const revisionNodes =
    revisionIds.length > 0
      ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${revisionIds})`
      : []

  // Nämnd
  const lederEdge = edges.find((e) => e.from_id === direktörId && e.typ === 'leder')
  const [nämnd] = lederEdge
    ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${lederEdge.to_id}`
    : [null]

  return c.json(
    {
      direktör: { id: direktör.id, ...direktör.data },
      nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
      utfall: utfallNodes.map((n) => ({ id: n.id, label: n.label, ...n.data })),
      revision: revisionNodes.map((n) => ({ id: n.id, label: n.label, ...n.data })),
    },
    200,
  )
})
