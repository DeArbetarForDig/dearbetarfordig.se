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
