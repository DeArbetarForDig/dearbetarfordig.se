/**
 * Seed: loads all JSON data from data/ into PostgreSQL
 *
 * Usage: npx tsx src/db/seed.ts
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const connectionString = process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf'

function loadJSON(path: string) {
  const full = join(DATA_DIR, path)
  if (!existsSync(full)) return null
  return JSON.parse(readFileSync(full, 'utf-8'))
}

async function main() {
  const client = postgres(connectionString)
  const db = drizzle(client, { schema })

  console.log('🌱 Seeding database...\n')

  // Create schema
  await client`CREATE SCHEMA IF NOT EXISTS goteborg`
  console.log('   ✓ Schema goteborg')

  // Create tables via raw SQL (simpler than drizzle-kit for initial setup)
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

  console.log('   ✓ Tables created')

  // Seed politiker
  const polData = loadJSON('politiker/goteborg.json')
  if (polData) {
    await client`DELETE FROM goteborg.politiker`
    for (const p of polData.politiker) {
      await client`
        INSERT INTO goteborg.politiker (id, fornamn, efternamn, parti, email, uppdrag)
        VALUES (${p.id}, ${p.förnamn}, ${p.efternamn}, ${p.parti}, ${p.email}, ${JSON.stringify(p.uppdrag)})
        ON CONFLICT (id) DO UPDATE SET
          fornamn = EXCLUDED.fornamn, efternamn = EXCLUDED.efternamn,
          parti = EXCLUDED.parti, email = EXCLUDED.email, uppdrag = EXCLUDED.uppdrag`
    }
    console.log(`   ✓ ${polData.politiker.length} politiker`)
  }

  // Seed graph nodes + edges
  const grafDir = join(DATA_DIR, 'graf')
  if (existsSync(grafDir)) {
    await client`DELETE FROM goteborg.graf_edges`
    await client`DELETE FROM goteborg.graf_nodes`

    const files = readdirSync(grafDir).filter(f => f.endsWith('.json'))
    let totalNodes = 0
    let totalEdges = 0

    for (const file of files) {
      const graph = JSON.parse(readFileSync(join(grafDir, file), 'utf-8'))

      for (const node of graph.nodes) {
        await client`
          INSERT INTO goteborg.graf_nodes (id, typ, label, data)
          VALUES (${node.id}, ${node.typ}, ${node.label}, ${JSON.stringify(node.data)})
          ON CONFLICT (id) DO UPDATE SET typ = EXCLUDED.typ, label = EXCLUDED.label, data = EXCLUDED.data`
        totalNodes++
      }

      for (const edge of graph.edges) {
        try {
          await client`
            INSERT INTO goteborg.graf_edges (from_id, to_id, typ, label, data)
            VALUES (${edge.from}, ${edge.to}, ${edge.typ}, ${edge.label || null}, ${edge.data ? JSON.stringify(edge.data) : null})`
          totalEdges++
        } catch { /* skip edges with missing nodes */ }
      }
    }
    console.log(`   ✓ ${totalNodes} graf nodes, ${totalEdges} edges (from ${files.length} files)`)
  }

  console.log('\n✅ Database seeded')
  await client.end()
}

main().catch(console.error)
