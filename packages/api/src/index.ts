import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf')
const app = new OpenAPIHono()

app.use('/*', cors())

// --- Schemas ---
const PolitikerSummary = z.object({
  id: z.string().uuid(),
  namn: z.string(),
  parti: z.string(),
  email: z.string().nullable(),
  antalUppdrag: z.number(),
}).openapi('PolitikerSummary')

const PolitikerList = z.object({
  kommun: z.string(),
  antal: z.number(),
  politiker: z.array(PolitikerSummary),
}).openapi('PolitikerList')

const GraphNode = z.object({
  id: z.string(),
  typ: z.string(),
  label: z.string(),
  data: z.record(z.unknown()),
}).openapi('GraphNode')

const GraphEdge = z.object({
  id: z.string().optional(),
  from_id: z.string(),
  to_id: z.string(),
  typ: z.string(),
  label: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
}).openapi('GraphEdge')

const StatsResponse = z.object({
  kommun: z.string(),
  politiker: z.number(),
  partier: z.record(z.number()),
  graf: z.object({ nodes: z.number(), edges: z.number() }),
}).openapi('Stats')

// --- Routes ---

const politikerRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker',
  tags: ['Politiker'],
  summary: 'Lista alla politiker',
  description: 'Returnerar alla förtroendevalda i kommunfullmäktige. Kan filtreras på parti.',
  request: {
    params: z.object({ kommun: z.string().openapi({ example: 'goteborg' }) }),
    query: z.object({ parti: z.string().optional().openapi({ example: 'S' }) }),
  },
  responses: { 200: { content: { 'application/json': { schema: PolitikerList } }, description: 'Lista politiker' } },
})

app.openapi(politikerRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti } = c.req.valid('query')
  const rows = parti
    ? await sql`SELECT * FROM goteborg.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn`
    : await sql`SELECT * FROM goteborg.politiker ORDER BY efternamn`
  return c.json({
    kommun,
    antal: rows.length,
    politiker: rows.map((p) => ({ id: p.id, namn: `${p.fornamn} ${p.efternamn}`, parti: p.parti, email: p.email, antalUppdrag: (p.uppdrag as any[]).length })),
  }, 200)
})

const politikerDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}',
  tags: ['Politiker'],
  summary: 'Enskild politiker',
  description: 'Full profil med alla uppdrag, roller och kontaktuppgifter.',
  request: {
    params: z.object({ kommun: z.string(), id: z.string().uuid() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ id: z.string(), fornamn: z.string(), efternamn: z.string(), parti: z.string(), email: z.string().nullable(), uppdrag: z.array(z.unknown()) }).openapi('PolitikerDetail') } }, description: 'Politiker' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' },
  },
})

app.openapi(politikerDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const [person] = await sql`SELECT * FROM goteborg.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)
  return c.json(person as any, 200)
})

const grafNodeRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/graf/node/{id}',
  tags: ['Knowledge Graph'],
  summary: 'Traversera graf — enskild nod',
  description: 'Returnerar en nod med alla dess kanter och relaterade noder. Möjliggör graf-traversering.',
  request: {
    params: z.object({ kommun: z.string(), id: z.string().openapi({ example: 'kf-2025-11-27-§491' }) }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ node: GraphNode, edges: z.array(GraphEdge), related: z.array(GraphNode) }).openapi('GraphNodeResponse') } }, description: 'Nod med kopplingar' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' },
  },
})

app.openapi(grafNodeRoute, async (c) => {
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => e.from_id === id ? e.to_id : e.from_id))]
  const related = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
  return c.json({ node, edges, related } as any, 200)
})

const grafRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/graf',
  tags: ['Knowledge Graph'],
  summary: 'Graf översikt eller filtrering',
  description: 'Utan parametrar: visar statistik. Med datum: alla noder/kanter för ett möte. Med typ: alla noder av den typen.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ datum: z.string().optional().openapi({ example: '2025-11-27' }), typ: z.string().optional().openapi({ example: 'nämnd' }) }),
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ nodes: z.unknown(), edges: z.unknown() }) } }, description: 'Graf data' } },
})

app.openapi(grafRoute, async (c) => {
  const { datum, typ } = c.req.valid('query')
  if (datum) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE id LIKE ${'%' + datum + '%'} OR id = ${'möte-kf-' + datum}`
    const allIds = nodes.map((n) => n.id)
    const edges = allIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ANY(${allIds}) OR to_id = ANY(${allIds})` : []
    const relatedIds = [...new Set(edges.flatMap((e) => [e.from_id, e.to_id]).filter((id) => !allIds.includes(id)))]
    const relatedNodes = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
    return c.json({ nodes: [...nodes, ...relatedNodes], edges }, 200)
  }
  if (typ) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = ${typ}`
    return c.json({ antal: nodes.length, nodes }, 200)
  }
  const counts = await sql`SELECT typ, COUNT(*)::int as antal FROM goteborg.graf_nodes GROUP BY typ ORDER BY antal DESC`
  const edgeCount = await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges`
  return c.json({ nodes: counts, edges: edgeCount[0].total }, 200)
})

const statsRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/stats',
  tags: ['Statistik'],
  summary: 'Övergripande statistik',
  request: { params: z.object({ kommun: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: StatsResponse } }, description: 'Statistik' } },
})

app.openapi(statsRoute, async (c) => {
  const polCount = await sql`SELECT COUNT(*)::int as total FROM goteborg.politiker`
  const parties = await sql`SELECT parti, COUNT(*)::int as antal FROM goteborg.politiker GROUP BY parti ORDER BY antal DESC`
  const nodeCount = await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes`
  const edgeCount = await sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges`
  return c.json({
    kommun: c.req.valid('param').kommun,
    politiker: polCount[0].total,
    partier: Object.fromEntries(parties.map((p) => [p.parti, p.antal])),
    graf: { nodes: nodeCount[0].total, edges: edgeCount[0].total },
  }, 200)
})

// --- Möten (sammanträden) ---
const mötenRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/möten',
  tags: ['Möten'],
  summary: 'Lista alla sammanträden',
  description: 'Alla KF-sammanträden med datum. Startpunkt för att hitta beslut.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ år: z.string().optional().openapi({ example: '2025' }) }),
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), möten: z.array(z.unknown()) }) } }, description: 'Lista sammanträden' } },
})

app.openapi(mötenRoute, async (c) => {
  const { år } = c.req.valid('query')
  let nodes
  if (år) {
    nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'möte' AND data->>'datum' LIKE ${år + '%'} ORDER BY data->>'datum' DESC`
  } else {
    nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'möte' ORDER BY data->>'datum' DESC`
  }
  // Also get paragraf counts per meeting
  const möten = await Promise.all(nodes.map(async (m) => {
    const datum = (m.data as any).datum
    const beslut = await sql`SELECT COUNT(*)::int as antal FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum}`
    return { id: m.id, datum, label: m.label, antalBeslut: beslut[0].antal }
  }))
  return c.json({ kommun: c.req.valid('param').kommun, antal: möten.length, möten }, 200)
})

// --- Beslut (paragrafer) ---
const beslutRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut',
  tags: ['Beslut'],
  summary: 'Lista alla beslut',
  description: 'Alla KF-beslut (paragrafer). Filtrera på datum, sök i rubrik.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({
      datum: z.string().optional().openapi({ example: '2025-11-27', description: 'Specifikt sammanträde' }),
      sök: z.string().optional().openapi({ example: 'budget', description: 'Sök i rubrik' }),
      limit: z.string().optional().openapi({ example: '20' }),
    }),
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), beslut: z.array(z.unknown()) }) } }, description: 'Lista beslut' } },
})

app.openapi(beslutRoute, async (c) => {
  const { datum, sök, limit } = c.req.valid('query')
  const lim = parseInt(limit || '50')
  let rows
  if (datum) {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ORDER BY (data->>'paragrafNr')::int LIMIT ${lim}`
  } else if (sök) {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND label ILIKE ${'%' + sök + '%'} ORDER BY data->>'datum' DESC LIMIT ${lim}`
  } else {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' ORDER BY data->>'datum' DESC, (data->>'paragrafNr')::int LIMIT ${lim}`
  }
  return c.json({
    kommun: c.req.valid('param').kommun,
    antal: rows.length,
    beslut: rows.map((r) => ({
      id: r.id,
      paragraf: (r.data as any).paragrafNr ? `§ ${(r.data as any).paragrafNr}` : null,
      rubrik: r.label,
      datum: (r.data as any).datum,
      beslut: (r.data as any).beslut,
      votering: (r.data as any).votering,
      ärendeNr: (r.data as any).ärendeNr,
    })),
  }, 200)
})

// --- Enskilt beslut ---
const beslutDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/beslut/{id}',
  tags: ['Beslut'],
  summary: 'Enskilt beslut med alla kopplingar',
  description: 'Fullständig information om ett beslut: votering, individuella röster, yrkanden, reservationer, kopplingar till lagar och nämnder.',
  request: {
    params: z.object({ kommun: z.string(), id: z.string().openapi({ example: 'kf-2025-11-27-§491' }) }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ beslut: z.unknown(), kopplingar: z.array(z.unknown()) }) } }, description: 'Beslut med kopplingar' },
    404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' },
  },
})

app.openapi(beslutDetailRoute, async (c) => {
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Beslut inte hittat' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => e.from_id === id ? e.to_id : e.from_id))]
  const related = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
  return c.json({
    beslut: { id: node.id, ...node.data, label: node.label },
    kopplingar: edges.map((e) => {
      const target = related.find((r) => r.id === (e.from_id === id ? e.to_id : e.from_id))
      return { typ: e.typ, riktning: e.from_id === id ? 'ut' : 'in', nod: target ? { id: target.id, typ: target.typ, label: target.label } : null }
    }),
  }, 200)
})

// --- Budget ---
const budgetRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/budget',
  tags: ['Budget'],
  summary: 'Kommunbudget per nämnd',
  description: 'Visar kommunbidraget per nämnd — var skattepengar hamnar.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ år: z.string().optional().openapi({ example: '2026' }) }),
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), nämnder: z.array(z.unknown()) }) } }, description: 'Budget per nämnd' } },
})

app.openapi(budgetRoute, async (c) => {
  const rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'nämnd' ORDER BY (data->>'kommunbidragMnkr')::float DESC`
  const totalMnkr = rows.reduce((sum, r) => sum + ((r.data as any).kommunbidragMnkr || 0), 0)
  return c.json({
    kommun: c.req.valid('param').kommun,
    år: 2026,
    totalMnkr,
    nämnder: rows.map((r) => ({ id: r.id, namn: r.label, ...(r.data as object) })),
  }, 200)
})

// --- Sök ---
const sökRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/sök',
  tags: ['Sök'],
  summary: 'Sök i alla data',
  description: 'Fritextsökning i politiker, beslut, organisationer.',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ q: z.string().openapi({ example: 'cykelväg' }) }),
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ resultat: z.array(z.unknown()) }) } }, description: 'Sökresultat' } },
})

app.openapi(sökRoute, async (c) => {
  const q = c.req.valid('query').q
  const politiker = await sql`SELECT id, fornamn || ' ' || efternamn as namn, parti, 'politiker' as typ FROM goteborg.politiker WHERE fornamn ILIKE ${'%' + q + '%'} OR efternamn ILIKE ${'%' + q + '%'} LIMIT 10`
  const nodes = await sql`SELECT id, label, typ FROM goteborg.graf_nodes WHERE label ILIKE ${'%' + q + '%'} LIMIT 20`
  return c.json({ query: q, resultat: [...politiker, ...nodes] }, 200)
})

// --- OpenAPI spec + Swagger UI ---
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'De Arbetar För Dig — API',
    version: '0.2.0',
    description: 'Öppen demokrati-API för svenska kommuner. Knowledge graph med politiker, beslut, budget och lagar.',
    license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    contact: { name: 'DeArbetarForDig', url: 'https://github.com/DeArbetarForDig/dearbetarfordig.se' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
})

app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// --- Root redirect ---
app.get('/', (c) => c.redirect('/docs'))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API running at http://localhost:${info.port}`)
  console.log(`📖 Swagger UI: http://localhost:${info.port}/docs`)
  console.log(`📋 OpenAPI spec: http://localhost:${info.port}/openapi.json`)
})
