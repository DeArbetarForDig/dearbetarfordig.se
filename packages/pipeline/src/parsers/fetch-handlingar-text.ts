/**
 * Download handling PDFs and extract full text for each beslut.
 *
 * Links: protokoll fulltext mentions "Handling YYYY nr NN" →
 * handlingar JSON has the URL → download PDF → pdftotext → save to graf.
 *
 * Usage: npx tsx packages/pipeline/src/parsers/fetch-handlingar-text.ts [year]
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp/handlingar')
const GRAF_DIR = join(DATA_DIR, 'graf')

mkdirSync(TMP_DIR, { recursive: true })

const year = process.argv[2] || '2026'

// Load handlingar index
const handlingarFile = join(DATA_DIR, `beslut/kf-handlingar-${year}.json`)
if (!existsSync(handlingarFile)) {
  console.error(`No handlingar file for ${year}`)
  process.exit(1)
}
const handlingar = JSON.parse(readFileSync(handlingarFile, 'utf-8'))

// Build URL map: "Handling_YYYY_nr_NN.pdf" → URL
const urlMap = new Map<string, string>()
for (const meeting of handlingar.sammanträden) {
  for (const h of meeting.handlingar) {
    urlMap.set(h.titel, h.url)
  }
}

// Process each graf file for this year's meetings
let totalUpdated = 0

for (const meeting of handlingar.sammanträden) {
  const grafFile = join(GRAF_DIR, `kf-${meeting.datum}.json`)
  if (!existsSync(grafFile)) continue

  const graf = JSON.parse(readFileSync(grafFile, 'utf-8'))
  let updated = 0

  for (const node of graf.nodes) {
    if (node.typ !== 'paragraf') continue
    if (node.data.handlingText) continue // already done

    // Extract handling reference from fulltext
    const fulltext = node.data.fulltext || ''
    const handlingMatch = fulltext.match(/Handling\s*\n?\s*(\d{4})\s+nr\s+(\d+)/)
    if (!handlingMatch) continue

    const handlingYear = handlingMatch[1]
    const handlingNr = handlingMatch[2]
    const filename = `Handling_${handlingYear}_nr_${handlingNr}.pdf`

    // Find URL
    const url = urlMap.get(filename)
    if (!url) continue

    // Download if not cached
    const localPath = join(TMP_DIR, filename)
    if (!existsSync(localPath)) {
      try {
        execSync(`curl -sL -o '${localPath}' '${url}'`, { timeout: 60_000 })
      } catch {
        console.error(`  Failed to download ${filename}`)
        continue
      }
    }

    // Extract text
    try {
      const raw = execSync(`pdftotext -layout "${localPath}" -`, {
        maxBuffer: 20 * 1024 * 1024,
      }).toString().trim()

      if (raw.length < 50) continue

      // Normalize: collapse multiple newlines, remove page headers/footers
      const text = raw
        .replace(/\f/g, '\n') // form feeds → newline
        .replace(/^.*\d+ \(\d+\)\s*$/gm, '') // any line ending with "N (M)" pattern = page footer
        .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines to 2
        .replace(/[ \t]+$/gm, '') // trailing spaces
        .replace(/^[ \t]+/gm, '') // leading spaces per line
        .trim()

      node.data.handlingText = text
      updated++
      process.stdout.write(`  ${node.id} ← ${filename} (${text.length} chars)\n`)
    } catch {
      console.error(`  Failed to extract text from ${filename}`)
    }
  }

  if (updated > 0) {
    writeFileSync(grafFile, JSON.stringify(graf, null, 2))
    console.log(`✓ ${meeting.datum}: ${updated} handlingar extracted`)
    totalUpdated += updated
  }
}

console.log(`\n✅ Done: ${totalUpdated} handlingar texts added for ${year}`)
