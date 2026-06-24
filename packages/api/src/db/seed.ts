/**
 * Seed: loads all JSON data from data/ into PostgreSQL
 * Creates schema, tables, indexes. Drops unused tables.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const connectionString = process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf'

function loadJSON(path: string) {
  const full = join(DATA_DIR, path)
  if (!existsSync(full)) return null
  return JSON.parse(readFileSync(full, 'utf-8'))
}

async function main() {
  const client = postgres(connectionString, { max: 5 })

  console.log('🌱 Seeding database...\n')

  // Create schema
  await client`CREATE SCHEMA IF NOT EXISTS goteborg`
  console.log('   ✓ Schema goteborg')

  // Create tables
  await client`
    CREATE TABLE IF NOT EXISTS goteborg.politiker (
      id UUID PRIMARY KEY,
      fornamn TEXT NOT NULL,
      efternamn TEXT NOT NULL,
      parti TEXT NOT NULL,
      email TEXT,
      foto_url TEXT,
      sociala JSONB,
      uppdrag JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT now()
    )`

  await client`
    CREATE TABLE IF NOT EXISTS goteborg.graf_nodes (
      id TEXT PRIMARY KEY,
      typ TEXT NOT NULL,
      label TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'
    )`

  await client`
    CREATE TABLE IF NOT EXISTS goteborg.graf_edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_id TEXT NOT NULL REFERENCES goteborg.graf_nodes(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES goteborg.graf_nodes(id) ON DELETE CASCADE,
      typ TEXT NOT NULL,
      label TEXT,
      data JSONB
    )`

  // Drop unused tables (data lives in graph)
  await client`DROP TABLE IF EXISTS goteborg.arenden CASCADE`
  await client`DROP TABLE IF EXISTS goteborg.moten CASCADE`
  await client`DROP TABLE IF EXISTS goteborg.budget CASCADE`

  await client`
    CREATE TABLE IF NOT EXISTS goteborg.dokument (
      id TEXT PRIMARY KEY,
      titel TEXT NOT NULL,
      typ TEXT NOT NULL,
      namnd TEXT NOT NULL,
      datum TEXT NOT NULL,
      kalla TEXT NOT NULL,
      innehall TEXT NOT NULL,
      graf_nod TEXT
    )`

  console.log('   ✓ Tables created (unused dropped)')

  // Create indexes
  await client`CREATE INDEX IF NOT EXISTS idx_politiker_parti ON goteborg.politiker(parti)`
  await client`CREATE INDEX IF NOT EXISTS idx_graf_nodes_typ ON goteborg.graf_nodes(typ)`
  await client`CREATE INDEX IF NOT EXISTS idx_graf_nodes_datum ON goteborg.graf_nodes((data->>'datum')) WHERE typ = 'paragraf'`
  await client`CREATE INDEX IF NOT EXISTS idx_graf_edges_from ON goteborg.graf_edges(from_id)`
  await client`CREATE INDEX IF NOT EXISTS idx_graf_edges_to ON goteborg.graf_edges(to_id)`
  await client`CREATE INDEX IF NOT EXISTS idx_graf_edges_typ ON goteborg.graf_edges(typ)`
  await client`CREATE INDEX IF NOT EXISTS idx_politiker_fts ON goteborg.politiker USING GIN (to_tsvector('swedish', fornamn || ' ' || efternamn))`
  console.log('   ✓ Indexes created')

  // Seed politiker
  const polData = loadJSON('politiker/goteborg.json')
  if (polData) {
    await client`DELETE FROM goteborg.politiker`
    for (const p of polData.politiker) {
      await client`
        INSERT INTO goteborg.politiker (id, fornamn, efternamn, parti, email, uppdrag, sociala)
        VALUES (${p.id}, ${p.förnamn}, ${p.efternamn}, ${p.parti}, ${p.email}, ${client.json(p.uppdrag)}, ${client.json({ mandatperioder: p.mandatperioder || [], närstående: p.närstående || null })})
        ON CONFLICT (id) DO UPDATE SET
          fornamn = EXCLUDED.fornamn, efternamn = EXCLUDED.efternamn,
          parti = EXCLUDED.parti, email = EXCLUDED.email, uppdrag = EXCLUDED.uppdrag, sociala = EXCLUDED.sociala`
    }
    console.log(`   ✓ ${polData.politiker.length} politiker`)
  }

  // Seed graph nodes + edges (with organisation merge)
  const grafDir = join(DATA_DIR, 'graf')
  if (existsSync(grafDir)) {
    await client`DELETE FROM goteborg.graf_edges`
    await client`DELETE FROM goteborg.graf_nodes`

    const { mergeOrganisations } = await import('./merge-organisations.js')
    const files = readdirSync(grafDir).filter((f) => f.endsWith('.json'))
    const allNodes: any[] = []
    const allEdges: any[] = []
    for (const file of files) {
      const graph = JSON.parse(readFileSync(join(grafDir, file), 'utf-8'))
      allNodes.push(...graph.nodes)
      allEdges.push(...graph.edges)
    }
    const { nodes, edges, mergeCount } = mergeOrganisations(allNodes, allEdges)
    console.log(`   ✓ Merged ${mergeCount} duplicate org nodes`)
    const nodeMap = new Map<string, any>()
    for (const node of nodes) nodeMap.set(node.id, node)
    let totalNodes = 0
    let totalEdges = 0
    for (const node of nodeMap.values()) {
      await client`INSERT INTO goteborg.graf_nodes (id, typ, label, data) VALUES (${node.id}, ${node.typ}, ${node.label}, ${client.json(node.data)}) ON CONFLICT (id) DO UPDATE SET typ = EXCLUDED.typ, label = EXCLUDED.label, data = EXCLUDED.data`
      totalNodes++
    }
    for (const edge of edges) {
      try {
        await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, label, data) VALUES (${edge.from}, ${edge.to}, ${edge.typ}, ${edge.label || null}, ${edge.data ? client.json(edge.data) : null})`
        totalEdges++
      } catch {}
    }

    console.log(`   ✓ ${totalNodes} graf nodes, ${totalEdges} edges (from ${files.length} files)`)
  }

  // Seed dokument (full-text parsed documents)
  const dokDir = join(DATA_DIR, 'dokument')
  if (existsSync(dokDir) && existsSync(join(dokDir, 'index.json'))) {
    await client`DELETE FROM goteborg.dokument`
    const docs = JSON.parse(readFileSync(join(dokDir, 'index.json'), 'utf-8'))
    for (const doc of docs) {
      const textPath = join(dokDir, doc.fil)
      if (!existsSync(textPath)) continue
      const innehall = readFileSync(textPath, 'utf-8')
      await client`INSERT INTO goteborg.dokument (id, titel, typ, namnd, datum, kalla, innehall, graf_nod)
        VALUES (${doc.id}, ${doc.titel}, ${doc.typ}, ${doc.nämnd}, ${doc.datum}, ${doc.källa}, ${innehall}, ${doc.graf_nod || null})`
    }
    console.log(`   ✓ ${docs.length} dokument (full-text)`)
  }

  console.log('\n✅ Database seeded')
  await client.end()
}

main().catch(console.error)
