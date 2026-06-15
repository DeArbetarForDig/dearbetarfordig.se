import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import postgres from 'postgres'

const app = new Hono()
const sql = postgres(process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf')

app.use('/*', cors())

// --- Root ---
app.get('/', (c) =>
  c.json({
    name: 'De Arbetar För Dig — API',
    version: '0.2.0',
    licens: 'AGPL-3.0',
    databas: 'PostgreSQL',
    endpoints: {
      politiker: '/api/v1/goteborg/politiker',
      politiker_detail: '/api/v1/goteborg/politiker/:id',
      beslut: '/api/v1/goteborg/beslut',
      debatter: '/api/v1/goteborg/debatter',
      graf: '/api/v1/goteborg/graf',
      graf_node: '/api/v1/goteborg/graf/node/:id',
      stats: '/api/v1/goteborg/stats',
    },
  }),
)

// --- Politiker ---
app.get('/api/v1/:kommun/politiker', async (c) => {
  const parti = c.req.query('parti')
  const rows = parti
    ? await sql`SELECT * FROM goteborg.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn`
    : await sql`SELECT * FROM goteborg.politiker ORDER BY efternamn`

  return c.json({
    kommun: c.req.param('kommun'),
    antal: rows.length,
    politiker: rows.map((p) => ({
      id: p.id,
      namn: `${p.fornamn} ${p.efternamn}`,
      parti: p.parti,
      email: p.email,
      antalUppdrag: (p.uppdrag as any[]).length,
    })),
  })
})

app.get('/api/v1/:kommun/politiker/:id', async (c) => {
  const [person] = await sql`SELECT * FROM goteborg.politiker WHERE id = ${c.req.param('id')}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)
  return c.json({ ...person, förnamn: person.fornamn })
})

// --- Graf ---
app.get('/api/v1/:kommun/graf', async (c) => {
  const datum = c.req.query('datum')
  const typ = c.req.query('typ')

  if (datum) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE id LIKE ${'%' + datum + '%'} OR id LIKE ${'möte-kf-' + datum}`
    const allIds = nodes.map((n) => n.id)
    const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ANY(${allIds}) OR to_id = ANY(${allIds})`
    // Also fetch related nodes
    const relatedIds = [...new Set(edges.flatMap((e) => [e.from_id, e.to_id]).filter((id) => !allIds.includes(id)))]
    const relatedNodes = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []
    return c.json({ nodes: [...nodes, ...relatedNodes], edges })
  }

  if (typ) {
    const nodes = await sql`SELECT * FROM goteborg.graf_nodes WHERE typ = ${typ}`
    return c.json({ antal: nodes.length, nodes })
  }

  // Summary
  const counts = await sql`SELECT typ, COUNT(*) as antal FROM goteborg.graf_nodes GROUP BY typ ORDER BY antal DESC`
  const edgeCount = await sql`SELECT COUNT(*) as total FROM goteborg.graf_edges`
  return c.json({ nodes: counts, edges: edgeCount[0].total })
})

app.get('/api/v1/:kommun/graf/node/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'))
  const [node] = await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ${id}`
  if (!node) return c.json({ error: 'Node not found' }, 404)

  const edges = await sql`SELECT * FROM goteborg.graf_edges WHERE from_id = ${id} OR to_id = ${id}`
  const relatedIds = [...new Set(edges.map((e) => e.from_id === id ? e.to_id : e.from_id))]
  const related = relatedIds.length > 0 ? await sql`SELECT * FROM goteborg.graf_nodes WHERE id = ANY(${relatedIds})` : []

  return c.json({ node, edges, related })
})

// --- Stats ---
app.get('/api/v1/:kommun/stats', async (c) => {
  const polCount = await sql`SELECT COUNT(*) as total FROM goteborg.politiker`
  const parties = await sql`SELECT parti, COUNT(*) as antal FROM goteborg.politiker GROUP BY parti ORDER BY antal DESC`
  const nodeCount = await sql`SELECT COUNT(*) as total FROM goteborg.graf_nodes`
  const edgeCount = await sql`SELECT COUNT(*) as total FROM goteborg.graf_edges`

  return c.json({
    kommun: c.req.param('kommun'),
    politiker: Number(polCount[0].total),
    partier: Object.fromEntries(parties.map((p) => [p.parti, Number(p.antal)])),
    graf: { nodes: Number(nodeCount[0].total), edges: Number(edgeCount[0].total) },
  })
})

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API running at http://localhost:${info.port} (PostgreSQL)`)
})
