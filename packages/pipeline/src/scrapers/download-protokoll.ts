/**
 * download-protokoll.ts — downloads the official KF protokoll PDF for every
 * meeting listed in data/beslut/kf-handlingar-{year}.json into
 * data/beslut/protokoll/, so the weekly workflow's "Parse new protokoll"
 * step (which globs that directory) has something to parse.
 *
 * Missing link found 2026-07-23: scrape:handlingar only writes a JSON index
 * of document URLs, nothing ever downloaded the PDFs themselves — every
 * past "Parse new protokoll" run silently processed zero files. Same
 * "kf_protokoll" title match and %PDF magic-byte check as parse-voteringar.ts
 * uses for its own (separately cached) protocol download.
 *
 * Usage: npx tsx packages/pipeline/src/scrapers/download-protokoll.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const OUTPUT_DIR = join(DATA_DIR, 'beslut/protokoll')

function findProtokoll(): Array<{ datum: string; url: string }> {
  const currentYear = new Date().getFullYear()
  const found = new Map<string, string>()
  for (let y = currentYear - 4; y <= currentYear; y++) {
    const path = join(DATA_DIR, `beslut/kf-handlingar-${y}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden) {
      const h = s.handlingar.find((h: { titel: string }) =>
        h.titel.toLowerCase().includes('kf_protokoll'),
      )
      if (h && !found.has(s.datum)) found.set(s.datum, h.url)
    }
  }
  return [...found.entries()].sort().map(([datum, url]) => ({ datum, url }))
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const protokoll = findProtokoll()
  console.log(`📥 ${protokoll.length} protokoll i handlingar-index\n`)

  let downloaded = 0
  let skipped = 0
  let failed = 0
  for (const { datum, url } of protokoll) {
    const pdfPath = join(OUTPUT_DIR, `kf-protokoll-${datum}.pdf`)
    if (existsSync(pdfPath)) {
      skipped++
      continue
    }
    try {
      execSync(`curl -sfL '${url}' -o "${pdfPath}"`, { timeout: 60_000 })
      if (!readFileSync(pdfPath).subarray(0, 5).toString().startsWith('%PDF')) {
        throw new Error('not a PDF')
      }
      console.log(`  ✓ ${datum}`)
      downloaded++
    } catch {
      if (existsSync(pdfPath)) rmSync(pdfPath)
      console.log(`  ✗ ${datum} — nedladdning misslyckades`)
      failed++
    }
  }

  console.log(`\n✅ ${downloaded} nedladdade, ${skipped} redan cachade, ${failed} misslyckades`)
}

main()
