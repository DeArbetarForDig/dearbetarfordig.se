import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import postgres from 'postgres'

// --- Config ---
const DATABASE_URL = process.env.DATABASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'postgresql://daf:daf_local@localhost:5432/daf')
if (!DATABASE_URL) { console.error('❌ DATABASE_URL required in production'); process.exit(1) }

const sql = postgres(DATABASE_URL, { max: 20, idle_timeout: 30, connect_timeout: 10 })
const app = new OpenAPIHono()

// --- Multi-tenancy allowlist ---
const ALLOWED_KOMMUNER = ['goteborg'] // expand as we add more
function getSchema(kommun: string): string {
  if (!ALLOWED_KOMMUNER.includes(kommun)) throw new Error('Unknown kommun')
  return kommun
}

// --- Middleware ---
app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))

// Rate limiting (simple in-memory, per IP)
const rateMap = new Map<string, { count: number; reset: number }>()
app.use('/*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown'
  const now = Date.now()
  const entry = rateMap.get(ip)
  if (entry && entry.reset > now) {
    if (entry.count >= 200) return c.json({ error: 'Rate limit exceeded (200/min)' }, 429)
    entry.count++
  } else {
    rateMap.set(ip, { count: 1, reset: now + 60_000 })
  }
  await next()
})

// --- Helpers ---
function capLimit(val: string | undefined, max = 100): number {
  return Math.min(Math.max(parseInt(val || '50') || 50, 1), max)
}

// --- Schemas ---
const PolitikerSummary = z.object({ id: z.string().uuid(), namn: z.string(), parti: z.string(), email: z.string().nullable(), antalUppdrag: z.number() }).openapi('PolitikerSummary')
const PolitikerList = z.object({ kommun: z.string(), antal: z.number(), politiker: z.array(PolitikerSummary) }).openapi('PolitikerList')
const GraphNode = z.object({ id: z.string(), typ: z.string(), label: z.string(), data: z.record(z.unknown()) }).openapi('GraphNode')
const GraphEdge = z.object({ id: z.string().optional(), from_id: z.string(), to_id: z.string(), typ: z.string(), label: z.string().nullable().optional(), data: z.record(z.unknown()).nullable().optional() }).openapi('GraphEdge')

// --- Health ---
app.get('/healthz', async (c) => {
  try {
    await sql`SELECT 1`
    return c.json({ status: 'ok', db: 'connected' })
  } catch {
    return c.json({ status: 'error', db: 'disconnected' }, 503)
  }
})

// --- Routes ---
const politikerRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/politiker', tags: ['Politiker'],
  summary: 'Lista alla politiker',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ parti: z.string().optional(), limit: z.string().optional() }) },
  responses: { 200: { content: { 'application/json': { schema: PolitikerList } }, description: 'OK' } },
})
app.openapi(politikerRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti, limit } = c.req.valid('query')
  const lim = capLimit(limit)
  const schema = getSchema(kommun)
  const rows = parti
    ? await sql`SELECT * FROM goteborg.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn LIMIT ${lim}`
    : await sql`SELECT * FROM goteborg.politiker ORDER BY efternamn LIMIT ${lim}`
  return c.json({ kommun, antal: rows.length, politiker: rows.map((p) => ({ id: p.id, namn: `${p.fornamn} ${p.efternamn}`, parti: p.parti, email: p.email, antalUppdrag: (p.uppdrag as any[]).length })) }, 200)
})

const politikerDetailRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/politiker/{id}', tags: ['Politiker'],
  summary: 'Enskild politiker med alla uppdrag',
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({}).passthrough().openapi('PolitikerDetail') } }, description: 'OK' }, 404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' } },
})
app.openapi(politikerDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const [person] = await sql`SELECT * FROM goteborg.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)
  return c.json(person as any, 200)
})

// --- Möten (fixed N+1) ---
const mötenRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/möten', tags: ['Möten'],
  summary: 'Lista alla sammanträden',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ år: z.string().optional() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), möten: z.array(z.unknown()) }) } }, description: 'OK' } },
})
app.openapi(mötenRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { år } = c.req.valid('query')

  // Single query — no N+1
  const meetings = await sql`SELECT data->>'datum' as datum, label FROM goteborg.graf_nodes WHERE typ = 'möte' ORDER BY data->>'datum' DESC`
  const counts = await sql`SELECT data->>'datum' as datum, COUNT(*)::int as antal FROM goteborg.graf_nodes WHERE typ = 'paragraf' GROUP BY data->>'datum'`
  const countMap = Object.fromEntries(counts.map(c => [c.datum, c.antal]))

  let möten = meetings.map(m => ({ datum: m.datum, label: m.label, antalBeslut: countMap[m.datum] || 0 }))
  if (år) möten = möten.filter(m => m.datum?.startsWith(år))

  return c.json({ kommun, antal: möten.length, möten }, 200)
})

// --- Beslut ---
const beslutRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/beslut', tags: ['Beslut'],
  summary: 'Lista/sök beslut',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ datum: z.string().optional(), sök: z.string().optional(), limit: z.string().optional() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), beslut: z.array(z.unknown()) }) } }, description: 'OK' } },
})
app.openapi(beslutRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { datum, sök, limit } = c.req.valid('query')
  const lim = capLimit(limit)
  let rows
  if (datum) {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND data->>'datum' = ${datum} ORDER BY (data->>'paragrafNr')::int LIMIT ${lim}`
  } else if (sök) {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' AND label ILIKE ${'%' + sök + '%'} ORDER BY data->>'datum' DESC LIMIT ${lim}`
  } else {
    rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'paragraf' ORDER BY data->>'datum' DESC LIMIT ${lim}`
  }
  return c.json({ kommun, antal: rows.length, beslut: rows.map(r => ({ id: r.id, paragraf: (r.data as any).paragrafNr ? `§ ${(r.data as any).paragrafNr}` : null, rubrik: r.label, datum: (r.data as any).datum, beslut: (r.data as any).beslut, votering: (r.data as any).votering, ärendeNr: (r.data as any).ärendeNr })) }, 200)
})

const beslutDetailRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/beslut/{id}', tags: ['Beslut'],
  summary: 'Enskilt beslut med kopplingar',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ beslut: z.unknown(), kopplingar: z.array(z.unknown()) }) } }, description: 'OK' }, 404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' } },
})
app.openapi(beslutDetailRoute, async (c) => {
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Beslut inte hittat' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map(e => e.from_id === id ? e.to_id : e.from_id))]
  const related = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
  return c.json({ beslut: { id: node.id, ...node.data, label: node.label }, kopplingar: edges.map(e => { const target = related.find(r => r.id === (e.from_id === id ? e.to_id : e.from_id)); return { typ: e.typ, riktning: e.from_id === id ? 'ut' : 'in', nod: target ? { id: target.id, typ: target.typ, label: target.label } : null } }) }, 200)
})

// --- Budget ---
const budgetRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/budget', tags: ['Budget'],
  summary: 'Kommunbudget per nämnd',
  request: { params: z.object({ kommun: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), nämnder: z.array(z.unknown()) }) } }, description: 'OK' } },
})
app.openapi(budgetRoute, async (c) => {
  const rows = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = 'nämnd' ORDER BY (data->>'kommunbidragMnkr')::float DESC NULLS LAST`
  const totalMnkr = rows.reduce((sum, r) => sum + ((r.data as any).kommunbidragMnkr || 0), 0)
  return c.json({ kommun: c.req.valid('param').kommun, år: 2026, totalMnkr, nämnder: rows.map(r => ({ id: r.id, namn: r.label, ...(r.data as object) })) }, 200)
})

// --- Graf ---
const grafRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/graf', tags: ['Knowledge Graph'],
  summary: 'Graf översikt eller filtrering',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ datum: z.string().optional(), typ: z.string().optional() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ nodes: z.unknown(), edges: z.unknown() }) } }, description: 'OK' } },
})
app.openapi(grafRoute, async (c) => {
  const { datum, typ } = c.req.valid('query')
  if (datum) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE data->>'datum' = ${datum} OR id = ${'möte-kf-' + datum}`
    const allIds = nodes.map(n => n.id)
    const edges = allIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ANY(${allIds}) OR to_id = ANY(${allIds})` : []
    const relatedIds = [...new Set(edges.flatMap(e => [e.from_id, e.to_id]).filter(id => !allIds.includes(id)))]
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

const grafNodeRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/graf/node/{id}', tags: ['Knowledge Graph'],
  summary: 'Traversera graf — enskild nod med alla kopplingar',
  request: { params: z.object({ kommun: z.string(), id: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ node: GraphNode, edges: z.array(GraphEdge), related: z.array(GraphNode) }) } }, description: 'OK' }, 404: { content: { 'application/json': { schema: z.object({ error: z.string() }) } }, description: 'Ej hittad' } },
})
app.openapi(grafNodeRoute, async (c) => {
  const id = decodeURIComponent(c.req.valid('param').id)
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)
  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map(e => e.from_id === id ? e.to_id : e.from_id))]
  const related = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
  return c.json({ node, edges, related } as any, 200)
})

// --- Sök ---
const sökRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/sök', tags: ['Sök'],
  summary: 'Fritextsökning',
  request: { params: z.object({ kommun: z.string() }), query: z.object({ q: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ query: z.string(), resultat: z.array(z.unknown()) }) } }, description: 'OK' } },
})
app.openapi(sökRoute, async (c) => {
  const q = c.req.valid('query').q
  const politiker = await sql`SELECT id, fornamn || ' ' || efternamn as namn, parti, 'politiker' as typ FROM goteborg.politiker WHERE fornamn ILIKE ${'%' + q + '%'} OR efternamn ILIKE ${'%' + q + '%'} LIMIT 10`
  const nodes = await sql`SELECT id, label, typ FROM goteborg.graf_nodes WHERE label ILIKE ${'%' + q + '%'} LIMIT 20`
  return c.json({ query: q, resultat: [...politiker, ...nodes] }, 200)
})

// --- Stats ---
const statsRoute = createRoute({
  method: 'get', path: '/api/v1/{kommun}/stats', tags: ['Statistik'],
  summary: 'Övergripande statistik',
  request: { params: z.object({ kommun: z.string() }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ kommun: z.string(), politiker: z.number(), partier: z.record(z.number()), graf: z.object({ nodes: z.number(), edges: z.number() }) }).openapi('Stats') } }, description: 'OK' } },
})
app.openapi(statsRoute, async (c) => {
  const [pol, parties, nodeCount, edgeCount] = await Promise.all([
    sql`SELECT COUNT(*)::int as total FROM goteborg.politiker`,
    sql`SELECT parti, COUNT(*)::int as antal FROM goteborg.politiker GROUP BY parti ORDER BY antal DESC`,
    sql`SELECT COUNT(*)::int as total FROM goteborg.graf_nodes`,
    sql`SELECT COUNT(*)::int as total FROM goteborg.graf_edges`,
  ])
  return c.json({ kommun: c.req.valid('param').kommun, politiker: pol[0].total, partier: Object.fromEntries(parties.map(p => [p.parti, p.antal])), graf: { nodes: nodeCount[0].total, edges: edgeCount[0].total } }, 200)
})

// --- OpenAPI + Swagger ---
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: { title: 'De Arbetar För Dig — API', version: '0.2.0', description: 'Öppen demokrati-API. Knowledge graph med politiker, beslut, budget och lagar.', license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' }, contact: { name: 'DeArbetarForDig', url: 'https://github.com/DeArbetarForDig/dearbetarfordig.se' } },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
})
app.get('/docs', swaggerUI({ url: '/openapi.json' }))
app.get('/', (c) => c.redirect('/docs'))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API v0.2.0 at http://localhost:${info.port}`)
  console.log(`📖 Docs: http://localhost:${info.port}/docs`)
})
