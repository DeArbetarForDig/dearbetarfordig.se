import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  baseUrl,
  förvaltningLinks,
  förvaltningarListLinks,
  halCollection,
  halResource,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const forvaltningarRouter = new OpenAPIHono()

const förvaltningarRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar',
  tags: ['Förvaltningar'],
  summary: 'Lista alla förvaltningar med direktör, budget och utfall',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('Förvaltningar') },
      },
      description: 'OK',
    },
  },
})
forvaltningarRouter.openapi(förvaltningarRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const direktörer =
    await sql`SELECT id, label, data FROM ${sql(schema)}.graf_nodes WHERE typ = 'förvaltningsdirektör' ORDER BY data->>'namn'`
  const results = []
  for (const d of direktörer) {
    const [lederEdge] =
      await sql`SELECT to_id FROM ${sql(schema)}.graf_edges WHERE from_id = ${d.id} AND typ = 'leder' LIMIT 1`
    const nämndId = lederEdge?.to_id || null
    const [nämnd] = nämndId
      ? await sql`SELECT id, label, data FROM ${sql(schema)}.graf_nodes WHERE id = ${nämndId}`
      : [null]
    const [utfall] = nämndId
      ? await sql`SELECT data FROM ${sql(schema)}.graf_nodes WHERE typ = 'utfall' AND id LIKE ${'utfall-nämnd-%'} AND data->>'nämnd' = ${(nämnd?.label || '').replace(/^Göteborgs Stads /, '')}`
      : [null]
    const [revision] = nämndId
      ? await sql`SELECT n.data FROM ${sql(schema)}.graf_edges e JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id WHERE e.to_id = ${nämndId} AND e.typ = 'riktas_mot' LIMIT 1`
      : [null]
    results.push({
      id: d.id,
      nämndId,
      direktör: d.data,
      nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
      utfall: utfall?.data || null,
      revision: revision?.data || null,
      _links: förvaltningLinks(kommun, d.id),
    })
  }
  return c.json(halCollection(results, förvaltningarListLinks(kommun)), 200)
})

const förvaltningDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar/{id}',
  tags: ['Förvaltningar'],
  summary: 'Enskild förvaltning — direktör, nämnd, budget, utfall, revision, ledamöter',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({}).passthrough().openapi('FörvaltningDetail') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
forvaltningarRouter.openapi(förvaltningDetailRoute, async (c) => {
  const { kommun, id } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const direktörId = id.startsWith('direktör-') ? id : `direktör-${id}`

  const [direktör] =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${direktörId} AND typ = 'förvaltningsdirektör'`
  if (!direktör) return c.json({ error: 'Förvaltning inte hittad' }, 404)

  const edges =
    await sql`SELECT * FROM ${sql(schema)}.graf_edges WHERE from_id = ${direktörId} OR to_id = ${direktörId}`

  // Nämnd
  const lederEdge = edges.find((e) => e.from_id === direktörId && e.typ === 'leder')
  const [nämnd] = lederEdge
    ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ${lederEdge.to_id}`
    : [null]

  // Ledamöter (politiker → nämnd via ledamot_i). Only ledamot_i — after the
  // org-alias merge every edge family (yrkat, talade_i, …) can reach the
  // canonical nämnd node, and an untyped query returned duplicates and
  // non-members.
  const ledamöter = nämnd
    ? await sql`SELECT DISTINCT ON (n.id) n.id, n.label, n.data, e.data->>'roll' as roll
        FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id
        WHERE e.to_id = ${nämnd.id} AND e.typ = 'ledamot_i' AND n.typ = 'politiker'
        ORDER BY n.id LIMIT 80`
    : []

  // Utfall
  const utfallNodes =
    await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE typ = 'utfall' AND id LIKE ${'utfall-nämnd-%'}`
  const utfall = utfallNodes.filter((n) =>
    edges.some((e) => e.from_id === n.id && e.to_id === direktörId),
  )

  // Revision
  const revisionIds = edges
    .filter((e) => e.to_id === direktörId && e.from_id.startsWith('revision-'))
    .map((e) => e.from_id)
  const revision =
    revisionIds.length > 0
      ? await sql`SELECT * FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${revisionIds})`
      : []

  // Linked KF decisions per revision node
  const revisionLinks =
    revisionIds.length > 0
      ? await sql`SELECT e.from_id, e.typ, e.label, n.id as nod_id, n.label as nod_label, n.data->>'datum' as datum FROM ${sql(schema)}.graf_edges e JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id WHERE e.from_id = ANY(${revisionIds}) AND e.typ IN ('hänvisar_till','behandlad_i')`
      : []

  // Budget (nämnd data has kommunbidragMnkr)
  const budget = nämnd?.data || {}

  const item = {
    direktör: { id: direktör.id, ...direktör.data },
    nämnd: nämnd ? { id: nämnd.id, label: nämnd.label, ...nämnd.data } : null,
    budget,
  }

  const related = {
    utfall: utfall.map((n) => ({ id: n.id, label: n.label, ...n.data })),
    revision: revision.map((n) => {
      const links = revisionLinks
        .filter((l) => l.from_id === n.id)
        .map((l) => ({
          typ: l.typ,
          label: l.label,
          beslutId: l.nod_id,
          beslutLabel: l.nod_label,
          datum: l.datum,
          _links: { beslut: { href: `${baseUrl(kommun)}/beslut/${encodeURIComponent(l.nod_id)}` } },
        }))
      return { id: n.id, label: n.label, ...n.data, kopplingar: links }
    }),
    ledamöter: ledamöter.map((l) => {
      const polId = (l.id as string).replace('politiker-', '')
      return {
        id: l.id,
        label: l.label,
        parti: l.data?.parti,
        roll: l.roll,
        _links: { politiker: { href: `${baseUrl(kommun)}/politiker/${polId}` } },
      }
    }),
  }

  return c.json(halResource(item, förvaltningLinks(kommun, direktörId), related), 200)
})
