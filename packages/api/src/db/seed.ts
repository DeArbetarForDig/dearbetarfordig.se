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

// Every node id inserted into graf_nodes this run — edges are validated
// against this set up front so a dangling edge is a reported data gap,
// not a silently swallowed FK violation.
const knownNodeIds = new Set<string>()
const droppedEdges = new Map<string, { count: number; sample: string }>()

function droppedEdge(typ: string, from: string, to: string) {
  const missing = knownNodeIds.has(from) ? to : from
  // Collapse per-paragraf/per-ärende ids so the report groups by source
  // document instead of listing thousands of individual paragraphs.
  const grupp = missing.replace(/-§\d+.*$/, '-§*').replace(/-ärende-\d+$/, '-ärende-*')
  const key = `${typ} → ${grupp}`
  const entry = droppedEdges.get(key)
  if (entry) entry.count++
  else droppedEdges.set(key, { count: 1, sample: `${from} → ${to}` })
}

function reportDroppedEdges() {
  if (droppedEdges.size === 0) return
  const total = [...droppedEdges.values()].reduce((s, e) => s + e.count, 0)
  console.warn(
    `\n   ⚠️  ${total} edges DROPPED — endpoint saknas i graf_nodes (data gap, se docs/ANALYS-2026-07.md):`,
  )
  const sorted = [...droppedEdges.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [key, { count, sample }] of sorted.slice(0, 25)) {
    console.warn(`      ${String(count).padStart(6)}  ${key}  (t.ex. ${sample})`)
  }
  if (sorted.length > 25) console.warn(`      … och ${sorted.length - 25} grupper till`)
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
  await client`CREATE INDEX IF NOT EXISTS idx_dokument_fts ON goteborg.dokument USING GIN (to_tsvector('swedish', titel || ' ' || innehall))`
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
      knownNodeIds.add(node.id)
    }

    // Politiker nodes from the roster must exist BEFORE edge insertion:
    // röstade_*/talade_i edges reference politiker-<uuid> ids of which only
    // a fraction appear as nodes in the graf files themselves (125 of 734),
    // so inserting roster nodes after the edges silently dropped every edge
    // pointing at the rest on FK violations.
    if (polData) {
      for (const p of polData.politiker) {
        await client`INSERT INTO goteborg.graf_nodes (id, typ, label, data)
          VALUES (${`politiker-${p.id}`}, 'politiker', ${`${p.förnamn} ${p.efternamn}`}, ${client.json({ parti: p.parti, email: p.email })})
          ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, data = EXCLUDED.data`
        knownNodeIds.add(`politiker-${p.id}`)
      }
      console.log(`   ✓ ${polData.politiker.length} politiker nodes (roster)`)
    }

    // Edges whose endpoints don't exist can't be inserted (FK) — collect and
    // report them loudly instead of swallowing the violation. Any OTHER
    // insert error now crashes the seed instead of being silently eaten.
    for (const edge of edges) {
      if (!knownNodeIds.has(edge.from) || !knownNodeIds.has(edge.to)) {
        droppedEdge(edge.typ, edge.from, edge.to)
        continue
      }
      await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, label, data) VALUES (${edge.from}, ${edge.to}, ${edge.typ}, ${edge.label || null}, ${edge.data ? client.json(edge.data) : null})`
      totalEdges++
    }

    console.log(`   ✓ ${totalNodes} graf nodes, ${totalEdges} edges (from ${files.length} files)`)

    // Merge webb-TV sändningslänkar onto möte nodes
    const webbtv = loadJSON('debatter/webbtv-kf-goteborg.json')
    if (webbtv?.sändningar?.length) {
      let withVideo = 0
      for (const s of webbtv.sändningar) {
        const res =
          await client`UPDATE goteborg.graf_nodes SET data = data || ${client.json({ videoUrl: s.url })} WHERE id = ${`möte-kf-${s.datum}`}`
        withVideo += res.count
      }
      console.log(`   ✓ ${withVideo} möten med sändningslänk (webb-TV)`)
    }

    // Add politiker → nämnd edges (ledamot_i)
    // Single global set to deduplicate across both KF and full nämnd roster sources
    const allLedamotEdges = new Set<string>()

    if (polData) {
      let polEdges = 0
      const nämndNodes =
        await client`SELECT id, label FROM goteborg.graf_nodes WHERE typ IN ('organisation','nämnd') ORDER BY id`
      const nämndMap = new Map<string, string>()
      for (const n of nämndNodes) {
        const key = (n.label as string).toLowerCase().replace(/- och/g, ' och')
        const id = n.id as string
        // Prefer org- nodes (from protocols) over nämnd-...-year nodes (from budget)
        const existing = nämndMap.get(key)
        if (!existing || id.startsWith('org-') || (!existing.startsWith('org-') && id > existing)) {
          nämndMap.set(key, id)
        }
      }

      for (const p of polData.politiker) {
        for (const u of p.uppdrag || []) {
          const orgRaw: string = (u.organisation || '').replace(/^Göteborgs Stads\s+/i, '')
          if (!orgRaw.toLowerCase().includes('nämnd')) continue
          const orgKey = orgRaw
            .replace(/nämnd\b(?!\w)/gi, 'nämnden')
            .replace(/- och/g, ' och')
            .toLowerCase()
          const nämndId = nämndMap.get(orgKey)
          if (!nämndId) continue
          const edgeKey = `${p.id}:${nämndId}`
          if (allLedamotEdges.has(edgeKey)) continue
          allLedamotEdges.add(edgeKey)
          await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
            VALUES (${`politiker-${p.id}`}, ${nämndId}, 'ledamot_i', ${client.json({ roll: u.roll, från: u.från, till: u.till })})`
          polEdges++
        }
      }
      console.log(`   ✓ ${polEdges} politiker→nämnd edges (KF-ledamöter)`)
    }

    // Add politiker → bolag edges (bolagsuppdrag) — company board/leadership
    // roles scraped from allabolag.se (allabolag.ts →
    // data/politiker/bolagsengagemang-goteborg.json). This is a jäv/conflict-
    // of-interest signal (a politiker sitting on a company board that later
    // gets city contracts) central to this site's mission, so it's worth
    // wiring up even though company-name matching across sources is
    // inherently fuzzy.
    const bolagData = loadJSON('politiker/bolagsengagemang-goteborg.json')
    if (bolagData?.politiker?.length) {
      const normalizeBolagNamn = (namn: string) =>
        namn
          .toLowerCase()
          .replace(/\(publ\)/g, '')
          .replace(/\b(aktiebolag|ekonomisk förening|ideell förening)\b/g, '')
          .replace(/\bab\b\.?/g, '')
          .replace(/[.,]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      const slugifyBolag = (namn: string) =>
        `bolag-${namn
          .toLowerCase()
          .trim()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/g, '')}`

      // Clear previously-seeded bolagsuppdrag edges so re-running seed stays
      // idempotent instead of accumulating duplicates on every re-seed.
      await client`DELETE FROM goteborg.graf_edges WHERE typ = 'bolagsuppdrag'`

      const existingBolagNodes =
        await client`SELECT id, label FROM goteborg.graf_nodes WHERE typ = 'bolag'`
      const bolagByNamn = new Map<string, string>()
      for (const n of existingBolagNodes) {
        bolagByNamn.set(normalizeBolagNamn(n.label as string), n.id as string)
      }

      let bolagEdges = 0
      let nyaBolagNoder = 0
      let ejMatchade = 0
      for (const p of bolagData.politiker) {
        for (const b of p.bolagsuppdrag || []) {
          const bolagNamn: string = (b.bolag || '').trim()
          if (!bolagNamn) {
            ejMatchade++
            continue
          }
          const key = normalizeBolagNamn(bolagNamn)
          let bolagId = bolagByNamn.get(key)
          if (!bolagId) {
            bolagId = slugifyBolag(bolagNamn)
            await client`INSERT INTO goteborg.graf_nodes (id, typ, label, data)
              VALUES (${bolagId}, 'bolag', ${bolagNamn}, ${client.json({ källa: 'allabolag.se' })})
              ON CONFLICT (id) DO NOTHING`
            bolagByNamn.set(key, bolagId)
            knownNodeIds.add(bolagId)
            nyaBolagNoder++
          }
          if (!knownNodeIds.has(`politiker-${p.id}`)) {
            droppedEdge('bolagsuppdrag', `politiker-${p.id}`, bolagId)
            ejMatchade++
            continue
          }
          await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
            VALUES (${`politiker-${p.id}`}, ${bolagId}, 'bolagsuppdrag', ${client.json({ roll: b.roll, url: b.url || null })})`
          bolagEdges++
        }
      }
      console.log(
        `   ✓ ${bolagEdges} politiker→bolag edges (bolagsuppdrag), ${nyaBolagNoder} nya bolagsnoder${ejMatchade ? `, ${ejMatchade} ej matchade/hoppade över` : ''}`,
      )
    }
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

  // Seed talade_i edges from yttrandeprotokoll (kf-*.json in debatter/)
  const debatterDir = join(DATA_DIR, 'debatter')
  if (existsSync(debatterDir)) {
    const files = readdirSync(debatterDir).filter((f) => f.match(/^kf-\d{4}-\d{2}-\d{2}\.json$/))
    let taladEdges = 0
    for (const file of files) {
      const datum = file.replace('kf-', '').replace('.json', '')
      const moteId = `möte-kf-${datum}` // möte node id in graf
      const data = JSON.parse(readFileSync(join(debatterDir, file), 'utf-8'))
      for (const a of data.anföranden || []) {
        if (!a.politikerId) continue
        const polId = `politiker-${a.politikerId}`
        if (!knownNodeIds.has(polId) || !knownNodeIds.has(moteId)) {
          droppedEdge('talade_i', polId, moteId)
          continue
        }
        const edgeData = {
          talare: a.talare,
          parti: a.parti,
          ärende: a.ärende,
          ärendeTitel: a.ärendeTitel,
          text: a.text,
          ordning: a.ordning,
          datum,
        }
        await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
          VALUES (${polId}, ${moteId}, 'talade_i', ${client.json(edgeData)})`
        taladEdges++
      }
    }
    console.log(`   ✓ ${taladEdges} talade_i edges (anföranden→möten)`)
  }

  reportDroppedEdges()
  console.log('\n✅ Database seeded')
  await client.end()
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err)
  process.exitCode = 1
})
