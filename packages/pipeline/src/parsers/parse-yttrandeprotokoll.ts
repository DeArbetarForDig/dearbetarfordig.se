/**
 * Parser: Yttrandeprotokoll PDF → strukturerade anföranden
 *
 * Ersätter Whisper-transkriptioner med officiell text direkt från
 * yttrandeprotokoll PDF:er (100% korrekt text, gratis, omedelbart).
 *
 * Format i PDF:
 *   N. Ärendetitel
 *   Namn Efternamn (PARTI)
 *   Text text text...
 *   Namn2 Efternamn2 (PARTI2)
 *   Text text...
 *
 * Output: data/debatter/kf-{datum}.json (samma format som speakers-*.json)
 *
 * Användning:
 *   # Parsea ett specifikt möte
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts 2026-06-11
 *
 *   # Parsea alla möten (alla år)
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts --all
 *
 *   # Parsea specifikt år
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts --year 2025
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../../..')
const DATA_DIR = join(ROOT, 'data')
const TMP_DIR = join(ROOT, '.tmp', 'yttrande')
const OUTPUT_DIR = join(DATA_DIR, 'debatter')

interface Anförande {
  talare: string
  parti: string
  ärende: number | null
  ärendeTitel: string
  text: string
  ordning: number
}

interface Meeting {
  datum: string
  titel: string
  källa: string
  hämtad: string
  anföranden: Anförande[]
}

/**
 * Extrahera anföranden från yttrandeprotokoll PDF-text
 */
function parseYttrandeprotokoll(text: string, datum: string): Anförande[] {
  const anföranden: Anförande[] = []
  const lines = text.split('\n')

  // Pattern: "Namn Efternamn (PARTI)" — speaker line
  // Handles: "Ann Catrine Fogelgren (L)", "R. Mustafa Soyupak (MP)", "Aslan Akbas (S)"
  const speakerRe =
    /^([A-ZÅÄÖ][a-zA-ZåäöÅÄÖé\.\- ]+(?:\s+[A-ZÅÄÖ][a-zA-ZåäöÅÄÖé\.\- ]+)*)\s+\(([A-ZÅÄÖ\-]+)\)\s*$/

  // Pattern: "  N. Ärendetitel" or "N. Ärendetitel"
  const ärendeRe = /^\s*(\d+)\.\s+(.+)$/

  let currentTalare = ''
  let currentParti = ''
  let currentÄrende: number | null = null
  let currentÄrendeTitel = ''
  let currentText: string[] = []
  let ordning = 0

  function flush() {
    const text = currentText.join(' ').replace(/\s+/g, ' ').trim()
    if (currentTalare && text.length > 10) {
      anföranden.push({
        talare: currentTalare,
        parti: currentParti,
        ärende: currentÄrende,
        ärendeTitel: currentÄrendeTitel,
        text,
        ordning: ++ordning,
      })
    }
    currentText = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Skip page headers/footers
    if (
      line.startsWith('Kommunfullmäktige') ||
      line.startsWith('Göteborgs Stad Kommunfullmäktige') ||
      line.match(/^Yttrandeprotokoll \d{4}$/) ||
      line.match(/^\d+$/) || // page number
      line.match(/^Torsdagen|^Måndagen|^Tisdagen|^Onsdagen|^Fredagen/) ||
      line === ''
    ) {
      continue
    }

    // Ärende heading
    const ärendeMatch = line.match(ärendeRe)
    if (ärendeMatch && !speakerRe.test(line)) {
      const nr = Number.parseInt(ärendeMatch[1])
      const titel = ärendeMatch[2].trim()
      // Only update if it looks like a real ärende title (not a line starting with number in speech)
      if (nr >= 1 && nr <= 200 && titel.length > 3) {
        currentÄrende = nr
        currentÄrendeTitel = titel
      }
      continue
    }

    // Speaker line
    const speakerMatch = line.match(speakerRe)
    if (speakerMatch) {
      flush()
      currentTalare = speakerMatch[1].trim()
      currentParti = speakerMatch[2].trim()
      continue
    }

    // Text content
    if (currentTalare && line.length > 0) {
      currentText.push(line)
    }
  }

  flush()
  return anföranden
}

/**
 * Hämta alla yttrandeprotokoll URLs från handlingar JSON
 */
function getYttrandeUrls(years?: string[]): { datum: string; url: string }[] {
  const result: { datum: string; url: string }[] = []
  const targetYears = years || ['2023', '2024', '2025', '2026']

  for (const year of targetYears) {
    const path = join(DATA_DIR, `beslut/kf-handlingar-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden || []) {
      for (const h of s.handlingar || []) {
        if (h.titel?.includes('Yttrandeprotokoll')) {
          result.push({ datum: s.datum, url: h.url })
          break
        }
      }
    }
  }
  return result
}

async function parseMeeting(datum: string, url: string): Promise<Meeting | null> {
  const pdfPath = join(TMP_DIR, `yttrande-${datum}.pdf`)

  // Download if needed
  if (!existsSync(pdfPath)) {
    console.log(`  ⬇️  ${datum}...`)
    try {
      execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' '${url}' -o '${pdfPath}'`, {
        timeout: 30_000,
      })
    } catch {
      console.error(`  ✗ Download failed: ${datum}`)
      return null
    }
  }

  // Extract text
  let text: string
  try {
    text = execSync(`pdftotext -layout '${pdfPath}' -`, {
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch {
    console.error(`  ✗ pdftotext failed: ${datum}`)
    return null
  }

  const anföranden = parseYttrandeprotokoll(text, datum)
  const parties = [...new Set(anföranden.map((a) => a.parti))]

  console.log(
    `  ✓ ${datum}: ${anföranden.length} anföranden, ${new Set(anföranden.map((a) => a.talare)).size} talare (${parties.join(', ')})`,
  )

  return {
    datum,
    titel: `Kommunfullmäktige ${datum}`,
    källa: url,
    hämtad: new Date().toISOString(),
    anföranden,
  }
}

async function main() {
  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const args = process.argv.slice(2)
  const allFlag = args.includes('--all')
  const yearFlag = args.find((a) => a.startsWith('--year=') || a === '--year')
  const yearArg = yearFlag ? args[args.indexOf('--year') + 1] || yearFlag.split('=')[1] : null
  const datumArg = args.find((a) => a.match(/^\d{4}-\d{2}-\d{2}$/))

  let meetings: { datum: string; url: string }[]

  if (datumArg) {
    // Single date — find URL from handlingar
    const all = getYttrandeUrls()
    const match = all.find((m) => m.datum === datumArg)
    if (!match) {
      console.error(`✗ Inget yttrandeprotokoll för ${datumArg}`)
      process.exit(1)
    }
    meetings = [match]
  } else if (yearArg) {
    meetings = getYttrandeUrls([yearArg])
  } else if (allFlag) {
    meetings = getYttrandeUrls()
  } else {
    // Default: current year
    const year = new Date().getFullYear().toString()
    meetings = getYttrandeUrls([year])
  }

  console.log(`\n📝 Parsear ${meetings.length} yttrandeprotokoll...\n`)

  let ok = 0
  let totalAnföranden = 0

  for (const { datum, url } of meetings.sort((a, b) => a.datum.localeCompare(b.datum))) {
    const outPath = join(OUTPUT_DIR, `kf-${datum}.json`)
    const result = await parseMeeting(datum, url)
    if (result) {
      writeFileSync(outPath, JSON.stringify(result, null, 2))
      ok++
      totalAnföranden += result.anföranden.length
    }
  }

  console.log(`\n✅ ${ok}/${meetings.length} möten parserade, ${totalAnföranden} anföranden totalt`)
}

main().catch(console.error)
