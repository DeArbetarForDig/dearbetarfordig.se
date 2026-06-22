/**
 * parse-voteringar.ts — Dedicated parser for voteringsbilagor (individual votes).
 *
 * Extracts individual votes (namn + parti + ja/nej/avstår) from KF protocol appendices.
 * Supports both 2023 and 2025+ formats (same column layout).
 *
 * Input: KF protocol PDF with voteringsbilagor (Bilaga 2, 3, etc.)
 * Output: Updates data/graf/politiker-komplett.json with röstade_ja/nej/avstår edges
 *
 * Usage: npx tsx parse-voteringar.ts [path-to-pdf] [datum]
 *        npx tsx parse-voteringar.ts --all  (parse all .tmp/kf-protokoll-*.pdf)
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const KOMPLETT_PATH = join(DATA_DIR, 'graf/politiker-komplett.json')

// Column-based vote line: "Aslan Akbas                  S               1    Ordförande   Ja"
const VOTE_RE =
  /^(.{15,42}?)\s{2,}(S|M|V|SD|L|MP|D|KD|C)\s{2,}\d+\s{2,}\S+\s{2,}(Ja|Nej|Avstår|Frånvarande)\s*$/

interface Röst {
  namn: string
  parti: string
  röst: string
  ärende: string
  datum: string
}

function parseVotesPdf(pdfPath: string, datum: string): Röst[] {
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
  const röster: Röst[] = []

  // Split on Bilaga headers
  const bilagor = text.split(/(?=\n?Bilaga \d+\s*\n)/)

  for (const bilaga of bilagor) {
    const ärendeMatch = bilaga.match(/Ärende:\s*(\d+)/)
    const jaMatch = bilaga.match(/Antal Ja:\s*(\d+)/)
    if (!ärendeMatch || !jaMatch) continue

    const ärende = ärendeMatch[1]
    const resultatIdx = bilaga.indexOf('Resultat')
    if (resultatIdx === -1) continue

    const lines = bilaga.slice(resultatIdx).split('\n').slice(1)
    let pendingName = ''

    for (const line of lines) {
      const m = line.match(VOTE_RE)
      if (m) {
        const namn = `${pendingName} ${m[1]}`.trim()
        pendingName = ''
        röster.push({ namn, parti: m[2], röst: m[3].toLowerCase(), ärende, datum })
      } else if (
        line.trim() &&
        !line.match(/^\s*(Namn|Bilaga|\f|Göteborgs|Kommunfullmäktige|Protokoll|Sammanträdes)/)
      ) {
        pendingName += ` ${line.trim()}`
      } else {
        pendingName = ''
      }
    }
  }

  return röster
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: npx tsx parse-voteringar.ts <pdf> <datum>')
    console.error('       npx tsx parse-voteringar.ts --all')
    process.exit(1)
  }

  let allRöster: Röst[] = []

  if (arg === '--all') {
    // Parse all protocol PDFs
    const pdfs = readdirSync('.tmp')
      .filter((f) => f.match(/^kf-protokoll-\d+\.pdf$/))
      .map((f) => `.tmp/${f}`)
      .sort()
    for (const pdf of pdfs) {
      const datumMatch = pdf.match(/(\d{4})(\d{2})(\d{2})/)
      if (!datumMatch) continue
      const datum = `${datumMatch[1]}-${datumMatch[2]}-${datumMatch[3]}`
      const votes = parseVotesPdf(pdf, datum)
      if (votes.length > 0) {
        console.log(`  ✅ ${datum}: ${votes.length} röster`)
      }
      allRöster.push(...votes)
    }
  } else {
    const datum = process.argv[3] || '2025-01-01'
    allRöster = parseVotesPdf(arg, datum)
    console.log(`  ✅ ${datum}: ${allRöster.length} röster`)
  }

  if (allRöster.length === 0) {
    console.log('   Inga voteringar hittade.')
    return
  }

  // Load politiker for name matching
  const polData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const politiker = polData.politiker as Array<{
    id: string
    förnamn: string
    efternamn: string
    parti: string
  }>

  // Build name→id
  const nameToId: Record<string, string> = {}
  for (const p of politiker) {
    const pid = `politiker-${p.id}`
    const full = `${p.förnamn} ${p.efternamn}`.toLowerCase()
    nameToId[full] = pid
    const parts = p.efternamn.split(' ')
    if (parts.length > 1) {
      for (const part of parts) nameToId[`${p.förnamn} ${part}`.toLowerCase()] = pid
      nameToId[`${p.förnamn} ${parts[0]}`.toLowerCase()] = pid
    }
  }

  // Convert röster to edges
  const newEdges = new Set<string>()
  let matched = 0
  for (const r of allRöster) {
    const key = r.namn.trim().toLowerCase()
    const pid = nameToId[key]
    if (!pid) continue
    matched++

    const paragrafId = `kf-${r.datum}-§${r.ärende}`
    const typ =
      r.röst === 'ja'
        ? 'röstade_ja'
        : r.röst === 'nej'
          ? 'röstade_nej'
          : r.röst === 'avstår'
            ? 'röstade_avstår'
            : 'röstade_frånvarande'
    newEdges.add(JSON.stringify({ from: pid, to: paragrafId, typ }))
  }

  console.log(`\n📊 Totalt: ${allRöster.length} röster, ${matched} matchade till politiker`)
  console.log(`   ${newEdges.size} unika edges att lägga till`)

  // Update politiker-komplett.json
  const komplett = JSON.parse(readFileSync(KOMPLETT_PATH, 'utf-8'))
  const existingSet = new Set(
    komplett.edges.map((e: any) => JSON.stringify({ from: e.from, to: e.to, typ: e.typ })),
  )

  let added = 0
  for (const edgeStr of newEdges) {
    if (!existingSet.has(edgeStr)) {
      komplett.edges.push(JSON.parse(edgeStr))
      added++
    }
  }

  writeFileSync(KOMPLETT_PATH, JSON.stringify(komplett, null, 2))
  console.log(`   ✅ ${added} nya edges tillagda i politiker-komplett.json`)
}

main()
