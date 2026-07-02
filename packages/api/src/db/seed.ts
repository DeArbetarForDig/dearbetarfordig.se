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
    }
    for (const edge of edges) {
      try {
        await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, label, data) VALUES (${edge.from}, ${edge.to}, ${edge.typ}, ${edge.label || null}, ${edge.data ? client.json(edge.data) : null})`
        totalEdges++
      } catch {}
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
      for (const p of polData.politiker) {
        await client`INSERT INTO goteborg.graf_nodes (id, typ, label, data)
          VALUES (${`politiker-${p.id}`}, 'politiker', ${`${p.förnamn} ${p.efternamn}`}, ${client.json({ parti: p.parti, email: p.email })})
          ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, data = EXCLUDED.data`
      }

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
          try {
            await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
              VALUES (${`politiker-${p.id}`}, ${nämndId}, 'ledamot_i', ${client.json({ roll: u.roll, från: u.från, till: u.till })})`
            polEdges++
          } catch {}
        }
      }
      console.log(`   ✓ ${polEdges} politiker→nämnd edges (KF-ledamöter)`)
    }

    const nämndLedamoterFile = join(DATA_DIR, 'politiker/namnd-ledamoter.json')
    if (existsSync(nämndLedamoterFile)) {
      const nämndData = JSON.parse(readFileSync(nämndLedamoterFile, 'utf-8'))

      // Nämnd-only ledamöter (not in goteborg.json/KF-rostret) get a full
      // delete+reinsert here, same as every other table in this script —
      // otherwise a stale row from an older seed run (e.g. empty uppdrag,
      // before this aggregation existed) would linger forever behind
      // ON CONFLICT DO NOTHING.
      const kfIds = polData ? polData.politiker.map((p: any) => p.id) : []
      await client`DELETE FROM goteborg.politiker WHERE NOT (id = ANY(${kfIds}))`

      const nämndNodes2 =
        await client`SELECT id, label FROM goteborg.graf_nodes WHERE typ IN ('organisation','nämnd') ORDER BY id`
      const nämndMap2 = new Map<string, string>()
      for (const n of nämndNodes2) {
        const key = (n.label as string).toLowerCase().replace(/- och/g, ' och')
        const id = n.id as string
        const existing = nämndMap2.get(key)
        if (!existing || id.startsWith('org-') || (!existing.startsWith('org-') && id > existing)) {
          nämndMap2.set(key, id)
        }
      }

      // Pre-aggregate nämnd-memberships per person — samma person kan sitta i
      // flera nämnder, och den första INSERT (ON CONFLICT DO NOTHING nedan)
      // ska redan ha hela listan, annars visar profilsidan "Uppdrag (0)".
      const uppdragByPerson = new Map<
        string,
        Array<{ organisation: string; organisationId: string; roll: string }>
      >()
      for (const members of Object.values(nämndData.nämnder as Record<string, any[]>)) {
        for (const m of members) {
          if (!m.id) continue
          if (!uppdragByPerson.has(m.id)) uppdragByPerson.set(m.id, [])
          uppdragByPerson.get(m.id)!.push({
            organisation: m.organisation,
            organisationId: m.organisationId,
            roll: m.roll,
          })
        }
      }

      let nämndEdges = 0
      for (const [orgNamn, members] of Object.entries(nämndData.nämnder as Record<string, any[]>)) {
        const orgKey = orgNamn
          .replace(/^Göteborgs Stads\s+/i, '')
          .replace(/nämnd\b(?!\w)/gi, 'nämnden')
          .replace(/- och/g, ' och')
          .toLowerCase()
        const nämndId = nämndMap2.get(orgKey)
        if (!nämndId) continue
        for (const m of members) {
          if (!m.id) continue
          const polId = `politiker-${m.id}`
          const edgeKey = `${m.id}:${nämndId}`
          if (allLedamotEdges.has(edgeKey)) continue
          allLedamotEdges.add(edgeKey)
          // Ensure politiker node exists
          await client`INSERT INTO goteborg.graf_nodes (id, typ, label, data)
            VALUES (${polId}, 'politiker', ${`${m.förnamn} ${m.efternamn}`}, ${client.json({ parti: m.parti })})
            ON CONFLICT (id) DO NOTHING`
          // Ensure a politiker row exists too — nämnd-only ledamöter (not KF
          // ledamöter) aren't in goteborg.json, so /politiker/{id} 404:ade
          // even though they had a graph node and showed up in nämnd listings.
          // Table was cleared of non-KF rows above, so this is a fresh insert;
          // uppdrag = alla nämnder personen sitter i (aggregerat ovan), inte
          // bara den vi råkar iterera över just nu.
          await client`INSERT INTO goteborg.politiker (id, fornamn, efternamn, parti, uppdrag)
            VALUES (${m.id}, ${m.förnamn}, ${m.efternamn}, ${m.parti}, ${client.json(uppdragByPerson.get(m.id) || [])})
            ON CONFLICT (id) DO NOTHING`
          try {
            await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
              VALUES (${polId}, ${nämndId}, 'ledamot_i', ${client.json({ roll: m.roll })})
              ON CONFLICT DO NOTHING`
            nämndEdges++
          } catch {}
        }
      }
      console.log(`   ✓ ${nämndEdges} nämndledamot edges (full roster)`)
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
        const edgeData = {
          talare: a.talare,
          parti: a.parti,
          ärende: a.ärende,
          ärendeTitel: a.ärendeTitel,
          text: a.text,
          ordning: a.ordning,
          datum,
        }
        try {
          await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ, data)
            VALUES (${polId}, ${moteId}, 'talade_i', ${client.json(edgeData)})`
          taladEdges++
        } catch {}
      }
    }
    console.log(`   ✓ ${taladEdges} talade_i edges (anföranden→möten)`)
  }

  console.log('\n✅ Database seeded')
  await client.end()
}

main().catch(console.error)
