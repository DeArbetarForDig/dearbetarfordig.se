import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const app = new Hono()
const DATA_DIR = join(import.meta.dirname, '../../../data')

app.use('/*', cors())

// --- Helpers ---
function loadJSON(path: string) {
  const full = join(DATA_DIR, path)
  if (!existsSync(full)) return null
  return JSON.parse(readFileSync(full, 'utf-8'))
}

// --- Root ---
app.get('/', (c) =>
  c.json({
    name: 'De Arbetar För Dig — API',
    version: '0.1.0',
    licens: 'AGPL-3.0',
    endpoints: {
      politiker: '/api/v1/goteborg/politiker',
      politiker_detail: '/api/v1/goteborg/politiker/:id',
      beslut: '/api/v1/goteborg/beslut',
      debatter: '/api/v1/goteborg/debatter',
    },
  }),
)

// --- Politiker ---
app.get('/api/v1/:kommun/politiker', (c) => {
  const kommun = c.req.param('kommun')
  const data = loadJSON(`politiker/${kommun}.json`)
  if (!data) return c.json({ error: 'Kommun inte hittad' }, 404)

  const parti = c.req.query('parti')
  let politiker = data.politiker
  if (parti) {
    politiker = politiker.filter((p: any) => p.parti.toLowerCase() === parti.toLowerCase())
  }

  return c.json({
    kommun,
    mandatperiod: data.mandatperiod,
    antal: politiker.length,
    politiker: politiker.map((p: any) => ({
      id: p.id,
      namn: `${p.förnamn} ${p.efternamn}`,
      parti: p.parti,
      email: p.email,
      antalUppdrag: p.uppdrag.length,
    })),
  })
})

app.get('/api/v1/:kommun/politiker/:id', (c) => {
  const kommun = c.req.param('kommun')
  const id = c.req.param('id')
  const data = loadJSON(`politiker/${kommun}.json`)
  if (!data) return c.json({ error: 'Kommun inte hittad' }, 404)

  const person = data.politiker.find((p: any) => p.id === id)
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  return c.json(person)
})

// --- Beslut / Handlingar ---
app.get('/api/v1/:kommun/beslut', (c) => {
  const kommun = c.req.param('kommun')
  const år = c.req.query('år') || new Date().getFullYear().toString()
  const data = loadJSON(`beslut/kf-handlingar-${år}.json`)
  if (!data) return c.json({ error: `Inga beslut för ${år}` }, 404)

  return c.json({
    kommun,
    organisation: data.organisation,
    år: data.år,
    antalSammanträden: data.antalSammanträden || data.sammanträden?.length || 0,
    sammanträden: data.sammanträden,
  })
})

// --- Debatter / YouTube ---
app.get('/api/v1/:kommun/debatter', (c) => {
  const kommun = c.req.param('kommun')
  const data = loadJSON(`debatter/youtube-kf-${kommun}.json`)
  if (!data) return c.json({ error: 'Inga debatter hittade' }, 404)

  return c.json({
    kommun,
    kanal: data.kanal,
    antal: data.antal,
    videor: data.videor,
  })
})

// --- Graf (Knowledge Graph) ---
app.get('/api/v1/:kommun/graf', (c) => {
  const kommun = c.req.param('kommun')
  const datum = c.req.query('datum')

  if (datum) {
    const data = loadJSON(`graf/kf-${datum}.json`)
    if (!data) return c.json({ error: `Ingen graf för ${datum}` }, 404)
    return c.json(data)
  }

  // List available graphs
  const grafDir = join(DATA_DIR, 'graf')
  if (!existsSync(grafDir)) return c.json({ nodes: [], edges: [], available: [] })
  const files = readdirSync(grafDir).filter((f: string) => f.endsWith('.json'))
  return c.json({
    available: files.map((f: string) => f.replace('kf-', '').replace('.json', '')),
    description: 'Use ?datum=YYYY-MM-DD to get the full graph for a specific meeting',
  })
})

app.get('/api/v1/:kommun/graf/node/:id', (c) => {
  const id = c.req.param('id')
  // Search all graph files for this node and its edges
  const grafDir = join(DATA_DIR, 'graf')
  if (!existsSync(grafDir)) return c.json({ error: 'No graph data' }, 404)

  const files = readdirSync(grafDir).filter((f: string) => f.endsWith('.json'))
  for (const file of files) {
    const graph = JSON.parse(readFileSync(join(grafDir, file), 'utf-8'))
    const node = graph.nodes.find((n: any) => n.id === id)
    if (node) {
      const edges = graph.edges.filter((e: any) => e.from === id || e.to === id)
      const relatedIds = new Set(edges.map((e: any) => e.from === id ? e.to : e.from))
      const related = graph.nodes.filter((n: any) => relatedIds.has(n.id))
      return c.json({ node, edges, related })
    }
  }
  return c.json({ error: 'Node not found' }, 404)
})

// --- Stats ---
app.get('/api/v1/:kommun/stats', (c) => {
  const kommun = c.req.param('kommun')
  const pol = loadJSON(`politiker/${kommun}.json`)
  const deb = loadJSON(`debatter/youtube-kf-${kommun}.json`)

  if (!pol) return c.json({ error: 'Kommun inte hittad' }, 404)

  const parties: Record<string, number> = {}
  for (const p of pol.politiker) {
    parties[p.parti] = (parties[p.parti] || 0) + 1
  }

  return c.json({
    kommun,
    politiker: pol.antal,
    partier: parties,
    videor: deb?.antal || 0,
    mandatperiod: pol.mandatperiod,
  })
})

import { serve } from '@hono/node-server'

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API running at http://localhost:${info.port}`)
})
