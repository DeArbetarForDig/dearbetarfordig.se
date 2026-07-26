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

// Publiceringsgräns (docs/ANALYS-2026-07.md punkt 20): endast tjänsteadresser
// publiceras. Privata adresser (gmail m.fl.) finns i källfilerna eftersom
// kommunen listar dem som kontakt, men dataminimering säger att det publika
// API:t klarar sig med de officiella.
function publiceradEmail(email: string | null): string | null {
  if (!email) return null
  return /@(politiker\.)?goteborg\.se$/i.test(email.trim()) ? email : null
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

  // Fresh schema every run — the DB is a pure derived artifact of data/,
  // and prod re-seeds on every container start, so stale tables or column
  // shapes must never survive a deploy.
  await client`DROP SCHEMA IF EXISTS goteborg CASCADE`
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
    CREATE TABLE IF NOT EXISTS goteborg.kandidater (
      id TEXT PRIMARY KEY,
      namn TEXT NOT NULL,
      parti TEXT NOT NULL,
      parti_namn TEXT,
      listplats INT,
      alder INT,
      kon TEXT,
      faststalld BOOLEAN NOT NULL DEFAULT false,
      politiker_id UUID REFERENCES goteborg.politiker(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )`

  // Befintliga databaser saknar parti_namn (tillagd när småpartiernas
  // registrerade partibeteckning började visas i UI:t)
  await client`ALTER TABLE goteborg.kandidater ADD COLUMN IF NOT EXISTS parti_namn TEXT`

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
  await client`CREATE INDEX IF NOT EXISTS idx_kandidater_parti ON goteborg.kandidater(parti)`
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
        VALUES (${p.id}, ${p.förnamn}, ${p.efternamn}, ${p.parti}, ${publiceradEmail(p.email)}, ${client.json(p.uppdrag)}, ${client.json({ mandatperioder: p.mandatperioder || [], närstående: null })})
        ON CONFLICT (id) DO UPDATE SET
          fornamn = EXCLUDED.fornamn, efternamn = EXCLUDED.efternamn,
          parti = EXCLUDED.parti, email = EXCLUDED.email, uppdrag = EXCLUDED.uppdrag, sociala = EXCLUDED.sociala`
    }
    console.log(`   ✓ ${polData.politiker.length} politiker`)
  }

  // Seed kandidater 2026 (Valmyndighetens rådata, se scrapers/kandidater.ts).
  // politiker_id är redan matchad vid nedladdning — FK:t kräver bara att
  // politiker seedas innan kandidater, vilket blocket ovan garanterar.
  const kandData = loadJSON('politiker/kandidater-2026-goteborg.json')
  if (kandData) {
    await client`DELETE FROM goteborg.kandidater`
    for (const k of kandData.kandidater) {
      await client`
        INSERT INTO goteborg.kandidater (id, namn, parti, parti_namn, listplats, alder, kon, faststalld, politiker_id)
        VALUES (${k.id}, ${k.namn}, ${k.parti}, ${k.partiNamn ?? null}, ${k.listplats}, ${k.ålder}, ${k.kön}, ${k.fastställd}, ${k.politikerId})
        ON CONFLICT (id) DO UPDATE SET
          namn = EXCLUDED.namn, parti = EXCLUDED.parti, parti_namn = EXCLUDED.parti_namn,
          listplats = EXCLUDED.listplats,
          alder = EXCLUDED.alder, kon = EXCLUDED.kon, faststalld = EXCLUDED.faststalld,
          politiker_id = EXCLUDED.politiker_id`
    }
    console.log(`   ✓ ${kandData.kandidater.length} kandidater (val 2026)`)
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

    // Publiceringsgräns (GDPR/redaktionellt beslut, docs/ANALYS-2026-07.md
    // punkt 20): jäv-kontroller av anhöriga SAMLAS i datafilerna men
    // PUBLICERAS inte förrän det finns ett fynd av allmänintresse (och
    // utgivningsbevis). Anhöriga är privatpersoner — "kontrollerad: ren" om
    // en namngiven make/maka hör inte hemma i ett publikt API.
    const undanhållnaNoder = nodes.filter((n) => n.typ === 'närstående').length
    const undanhållnaEdges = edges.filter((e) => e.typ === 'gift_med').length
    if (undanhållnaNoder + undanhållnaEdges > 0) {
      console.log(
        `   ◦ ${undanhållnaNoder} närstående-noder + ${undanhållnaEdges} gift_med-edges undanhållna (publiceringsgräns, ANALYS punkt 20)`,
      )
    }

    const nodeMap = new Map<string, any>()
    for (const node of nodes) {
      if (node.typ === 'närstående') continue
      nodeMap.set(node.id, node)
    }
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
          VALUES (${`politiker-${p.id}`}, 'politiker', ${`${p.förnamn} ${p.efternamn}`}, ${client.json({ parti: p.parti, email: publiceradEmail(p.email) })})
          ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, data = EXCLUDED.data`
        knownNodeIds.add(`politiker-${p.id}`)
      }
      console.log(`   ✓ ${polData.politiker.length} politiker nodes (roster)`)
    }

    // Edges whose endpoints don't exist can't be inserted (FK) — collect and
    // report them loudly instead of swallowing the violation. Any OTHER
    // insert error now crashes the seed instead of being silently eaten.
    for (const edge of edges) {
      if (edge.typ === 'gift_med') continue // publiceringsgräns, se ovan
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
      // Prefer the canonical year-less nämnd node (merge-organisations.ts) —
      // that's what direktör leder-edges point at, so ledamot_i must land on
      // the same node for /forvaltning/* to see the members. org- nodes are
      // next (unmerged nämnder from protocols); year-suffixed budget nodes
      // (nämnd-...-2026) last.
      const nämndPrio = (id: string) =>
        id.match(/^nämnd-.*[^\d]$/) ? 3 : id.startsWith('org-') ? 2 : 1
      const nämndMap = new Map<string, string>()
      for (const n of nämndNodes) {
        const key = (n.label as string).toLowerCase().replace(/- och/g, ' och')
        const id = n.id as string
        const existing = nämndMap.get(key)
        if (!existing || nämndPrio(id) > nämndPrio(existing)) nämndMap.set(key, id)
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

    // Add revisionsrapport → nämnd/bolag edges (avser), from the mottagare
    // (recipient) named in each rekommendation (parse-revisionsrapport.ts,
    // docs/ANALYS-2026-07.md). The parser only extracts raw text — it has
    // no graf-node-id knowledge — so the name→id matching happens here,
    // reusing the same lookup approach as the ledamot_i/bolagsuppdrag edges
    // above (independent per-block lookups is the established pattern in
    // this function, not something to unify).
    const revisionNodes =
      await client`SELECT id, data FROM goteborg.graf_nodes WHERE typ = 'revisionsrapport'`
    if (revisionNodes.length > 0) {
      const nämndNodesForRevision =
        await client`SELECT id, label FROM goteborg.graf_nodes WHERE typ IN ('organisation','nämnd') ORDER BY id`
      const nämndPrioForRevision = (id: string) =>
        id.match(/^nämnd-.*[^\d]$/) ? 3 : id.startsWith('org-') ? 2 : 1
      const nämndMapForRevision = new Map<string, string>()
      for (const n of nämndNodesForRevision) {
        const key = (n.label as string).toLowerCase().replace(/- och/g, ' och')
        const id = n.id as string
        const existing = nämndMapForRevision.get(key)
        if (!existing || nämndPrioForRevision(id) > nämndPrioForRevision(existing)) {
          nämndMapForRevision.set(key, id)
        }
      }
      const bolagNodesForRevision =
        await client`SELECT id, label FROM goteborg.graf_nodes WHERE typ = 'bolag'`
      const normalizeBolagNamnForRevision = (namn: string) =>
        namn
          .toLowerCase()
          .replace(/\(publ\)/g, '')
          .replace(/\b(aktiebolag|ekonomisk förening|ideell förening)\b/g, '')
          .replace(/\bab\b\.?/g, '')
          .replace(/[.,]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      const bolagMapForRevision = new Map<string, string>()
      for (const n of bolagNodesForRevision) {
        bolagMapForRevision.set(normalizeBolagNamnForRevision(n.label as string), n.id as string)
      }

      const lookupOrgan = (namn: string): string | undefined => {
        const nämndKey = namn
          .toLowerCase()
          .replace(/nämnd\b(?!\w)/gi, 'nämnden')
          .replace(/- och/g, ' och')
          .trim()
        return (
          nämndMapForRevision.get(nämndKey) ||
          bolagMapForRevision.get(normalizeBolagNamnForRevision(namn))
        )
      }

      // Splits a mottagare segment on " och " into individual organ names —
      // but "kretslopp och vattennämnden" IS one nämnd's full name, so a
      // naive split breaks it into "kretslopp" + "vattennämnden" (neither
      // resolves). Scans left to right for the first " och "-delimited
      // prefix that resolves to a known organ, consumes it, and recurses on
      // the remainder — so "kretslopp och vattennämnden och Gryaab AB"
      // correctly yields two entities instead of three garbled fragments.
      function splitEntities(text: string): string[] {
        if (lookupOrgan(text)) return [text]
        const marker = ' och '
        let searchFrom = 0
        while (true) {
          const idx = text.indexOf(marker, searchFrom)
          if (idx === -1) break
          const prefix = text.slice(0, idx)
          if (lookupOrgan(prefix))
            return [prefix, ...splitEntities(text.slice(idx + marker.length))]
          searchFrom = idx + marker.length
        }
        return [text]
      }

      let revisionEdges = 0
      let revisionOmatchade = 0
      for (const node of revisionNodes) {
        const rekommendationer = ((node.data as any)?.rekommendationer || []) as Array<{
          mottagare: string
        }>
        const organNamn = new Set<string>()
        for (const { mottagare } of rekommendationer) {
          for (const del of mottagare.split(',')) {
            const trimmed = del.trim()
            if (!trimmed) continue
            for (const entity of splitEntities(trimmed)) organNamn.add(entity)
          }
        }
        for (const namn of organNamn) {
          const organId = lookupOrgan(namn)
          if (!organId) {
            revisionOmatchade++
            continue
          }
          await client`INSERT INTO goteborg.graf_edges (from_id, to_id, typ)
            VALUES (${node.id}, ${organId}, 'avser')`
          revisionEdges++
        }
      }
      console.log(
        `   ✓ ${revisionEdges} revisionsrapport→nämnd/bolag edges (avser)${revisionOmatchade ? `, ${revisionOmatchade} mottagare ej matchade` : ''}`,
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

  // Mark procedurella (mötesledning) anföranden så debattmetriker kan
  // exkludera dem — körs över BÅDA talade_i-representationerna:
  // edges → anforande-*-noder (graf/anforanden.json) och edges → möte-*
  // (debatter/kf-*.json). Se mark-procedurella.ts.
  {
    const { detectProcedurella } = await import('./mark-procedurella.js')

    const anfRows = await client`
      SELECT e.id as edge_id, e.from_id, n.id as node_id,
             n.data->>'datum' as datum, n.data->>'ärendeNr' as ärende,
             COALESCE((n.data->>'textLength')::int, 0) as text_len
      FROM goteborg.graf_edges e
      JOIN goteborg.graf_nodes n ON n.id = e.to_id AND n.typ = 'anförande'
      WHERE e.typ = 'talade_i'`
    const anfMarked = detectProcedurella(
      anfRows.map((r) => ({
        key: r.edge_id as string,
        datum: (r.datum as string) || '',
        ärende: (r.ärende as string) || '',
        talare: r.from_id as string,
        textLen: r.text_len as number,
      })),
    )
    const nodeIdByEdgeId = new Map(anfRows.map((r) => [r.edge_id as string, r.node_id as string]))

    const möteRows = await client`
      SELECT e.id as edge_id, e.data->>'datum' as datum, e.data->>'ärende' as ärende,
             e.data->>'talare' as talare, COALESCE(length(e.data->>'text'), 0) as text_len
      FROM goteborg.graf_edges e
      WHERE e.typ = 'talade_i' AND e.to_id LIKE 'möte-%'`
    const möteMarked = detectProcedurella(
      möteRows.map((r) => ({
        key: r.edge_id as string,
        datum: (r.datum as string) || '',
        ärende: (r.ärende as string) || '',
        talare: (r.talare as string) || '',
        textLen: r.text_len as number,
      })),
    )

    const edgeIds = [...anfMarked, ...möteMarked]
    const nodeIds = [...anfMarked].map((id) => nodeIdByEdgeId.get(id)).filter(Boolean) as string[]
    if (edgeIds.length > 0) {
      await client`UPDATE goteborg.graf_edges
        SET data = COALESCE(data, '{}'::jsonb) || '{"procedurell": true}'::jsonb
        WHERE id = ANY(${edgeIds})`
    }
    if (nodeIds.length > 0) {
      await client`UPDATE goteborg.graf_nodes
        SET data = data || '{"procedurell": true}'::jsonb
        WHERE id = ANY(${nodeIds})`
    }
    console.log(
      `   ✓ ${edgeIds.length} procedurella anföranden markerade (mötesledning: ${anfMarked.size} anförande-noder, ${möteMarked.size} möte-edges)`,
    )
  }

  reportDroppedEdges()
  console.log('\n✅ Database seeded')
  await client.end()
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err)
  // Hard exit: open postgres sockets would otherwise keep the process
  // alive, hanging the container instead of letting restart-policy retry.
  process.exit(1)
})
