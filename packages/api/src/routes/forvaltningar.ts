import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  baseUrl,
  förvaltningLinks,
  förvaltningarListLinks,
  halCollection,
  halCollectionSchema,
  halResource,
  halResourceWithRelatedSchema,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'

export const forvaltningarRouter = new OpenAPIHono()

const FörvaltningSummary = z.object({
  id: z.any(),
  nämndId: z.any(),
  direktör: z.any(),
  nämnd: z.any(),
  utfall: z.any(),
  revision: z.any(),
})

const förvaltningarRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar',
  tags: ['Förvaltningar'],
  summary: 'Lista alla förvaltningar med direktör, budget och utfall',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: halCollectionSchema(FörvaltningSummary).openapi('Förvaltningar'),
        },
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

const FörvaltningDetail = z.object({ direktör: z.any(), nämnd: z.any(), budget: z.any() })
const FörvaltningRelated = z.object({
  utfall: z.array(z.any()),
  revision: z.array(z.any()),
  revisionsrapporter: z.array(z.any()),
  leverantörsutfall: z.array(z.any()),
  avtal: z.array(z.any()),
  ledamöter: z.array(z.any()),
})

const förvaltningDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/forvaltningar/{id}',
  tags: ['Förvaltningar'],
  summary:
    'Enskild förvaltning — direktör, nämnd, budget, utfall, revision, revisionsrapporter, leverantörsutfall, avtal, ledamöter',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: halResourceWithRelatedSchema(FörvaltningDetail, FörvaltningRelated).openapi(
            'FörvaltningDetail',
          ),
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

  // Revisionsrapporter (Stadsrevisionens rapportsammandrag, se
  // parse-revisionsrapport.ts / docs/ANALYS-2026-07.md) — de detaljerade
  // enskilda granskningsrapporterna, kopplade via 'avser'-edges till nämnden.
  // Ett separat koncept från `revision`/`riktas_mot` ovan (kurerade
  // anmärkningar ur årsredogörelsen); de två visas som skilda sektioner.
  const revisionsrapporter = nämnd
    ? await sql`SELECT n.id, n.label, n.data FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id
        WHERE e.to_id = ${nämnd.id} AND e.typ = 'avser' AND n.typ = 'revisionsrapport'
        ORDER BY n.label`
    : []

  // Leverantörsutfall (psidata leverantörsfakturor, se
  // parse-leverantorsfakturor-namnd.ts / docs/ANALYS-2026-07.md) — totala
  // leverantörsutgifter, största leverantörer och utgiftskategorier per år.
  // Täcker bara externa inköp (inte löner) — kan därför överstiga 100% av
  // kommunbidraget för avgiftsfinansierade nämnder (VA, stadsmiljö) som har
  // stora intäkter utöver kommunbidraget.
  const leverantörsutfall = nämnd
    ? await sql`SELECT n.id, n.label, n.data FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id
        WHERE e.to_id = ${nämnd.id} AND e.typ = 'avser' AND n.typ = 'leverantörsutfall'
        ORDER BY n.data->>'år' DESC`
    : []
  // Månadsfakta för samma nämnd — bara total + antal (inget plan att jämföra
  // mot, se leverantorsfakturor-namnd.ts), grupperat per år på webben.
  const leverantörsutfallMånad = nämnd
    ? await sql`SELECT n.data FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id
        WHERE e.to_id = ${nämnd.id} AND e.typ = 'avser' AND n.typ = 'leverantörsutfall-månad'
        ORDER BY (n.data->>'år')::int, (n.data->>'månad')::int`
    : []

  // Avtal (upphandlingar och inköp ur allmänna handlingar, se
  // docs/ANALYS-2026-07.md punkt 21) — avtal-noder kopplade via
  // upphandlat_av till nämnden; leverantör (återförsäljare) och tillverkare
  // hämtas via avtalets egna levererar_till/produkt_från-edges.
  const avtal = nämnd
    ? await sql`SELECT n.id, n.label, n.data FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id
        WHERE e.to_id = ${nämnd.id} AND e.typ = 'upphandlat_av' AND n.typ = 'avtal'
        ORDER BY n.data->>'start' DESC NULLS LAST, n.id`
    : []
  const avtalParter =
    avtal.length > 0
      ? await sql`SELECT e.from_id, e.typ, n.label FROM ${sql(schema)}.graf_edges e
          JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
          WHERE e.from_id = ANY(${avtal.map((n) => n.id)}) AND e.typ IN ('levererar_till', 'produkt_från') AND n.typ = 'leverantör'`
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
    revisionsrapporter: revisionsrapporter.map((n) => ({ id: n.id, label: n.label, ...n.data })),
    leverantörsutfall: leverantörsutfall.map((n) => ({
      id: n.id,
      label: n.label,
      ...n.data,
      månadstrend: leverantörsutfallMånad
        .filter((m) => m.data.år === n.data.år)
        .map((m) => ({ månad: m.data.månad, totalTkr: m.data.totalTkr })),
    })),
    avtal: avtal.map((n) => ({
      id: n.id,
      label: n.label,
      ...n.data,
      leverantör:
        avtalParter.find((p) => p.from_id === n.id && p.typ === 'levererar_till')?.label || null,
      tillverkare:
        avtalParter.find((p) => p.from_id === n.id && p.typ === 'produkt_från')?.label || null,
    })),
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
