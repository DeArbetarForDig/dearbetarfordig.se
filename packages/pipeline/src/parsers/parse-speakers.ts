/**
 * Speaker Attribution — parsar yttrandeprotokoll PDF och kopplar till transkriptioner
 *
 * Input: yttrandeprotokoll PDF + transcription JSON (samma datum)
 * Output: anföranden med talare + text (merged)
 *
 * npx tsx src/parsers/parse-speakers.ts [datum]
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as json from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

interface Anförande {
  talare: string
  parti: string
  ärende: string
  ärendeNr: number
  text: string
}

function parseYttrandeprotokoll(pdfPath: string): Anförande[] {
  const text = execSync(`pdftotext "${pdfPath}" -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
  const lines = text.split('\n')
  const anföranden: Anförande[] = []

  let currentÄrende = ''
  let currentÄrendeNr = 0
  let currentTalare = ''
  let currentParti = ''
  let currentText: string[] = []

  const speakerRe = /^([\wÅÄÖåäö][\wÅÄÖåäö \-]+?)\s*\((\w+)\)\s*$/
  const ärendeRe = /^(\d+)\.\s+(.+)/

  for (const line of lines) {
    const ärendeMatch = line.match(ärendeRe)
    const speakerMatch = line.match(speakerRe)

    if (ärendeMatch) {
      // Save previous anförande
      if (currentTalare && currentText.length > 0) {
        anföranden.push({
          talare: currentTalare,
          parti: currentParti,
          ärende: currentÄrende,
          ärendeNr: currentÄrendeNr,
          text: currentText.join(' ').trim(),
        })
      }
      currentÄrendeNr = Number.parseInt(ärendeMatch[1])
      currentÄrende = ärendeMatch[2].trim()
      currentTalare = ''
      currentParti = ''
      currentText = []
    } else if (speakerMatch) {
      // Save previous anförande
      if (currentTalare && currentText.length > 0) {
        anföranden.push({
          talare: currentTalare,
          parti: currentParti,
          ärende: currentÄrende,
          ärendeNr: currentÄrendeNr,
          text: currentText.join(' ').trim(),
        })
      }
      currentTalare = speakerMatch[1].trim()
      currentParti = speakerMatch[2]
      currentText = []
    } else if (line.trim() && currentTalare) {
      currentText.push(line.trim())
    }
  }

  // Last one
  if (currentTalare && currentText.length > 0) {
    anföranden.push({
      talare: currentTalare,
      parti: currentParti,
      ärende: currentÄrende,
      ärendeNr: currentÄrendeNr,
      text: currentText.join(' ').trim(),
    })
  }

  return anföranden
}

async function main() {
  const datum = process.argv[2] || '2025-11-27'
  console.log(`🎤 Speaker attribution — ${datum}\n`)

  // Find yttrandeprotokoll URL from handlingar
  const år = datum.slice(0, 4)
  const handlingarFile = join(DATA_DIR, `beslut/kf-handlingar-${år}.json`)
  if (!existsSync(handlingarFile)) {
    console.error(`Inga handlingar för ${år}`)
    process.exit(1)
  }

  const handlingar = JSON.parse(readFileSync(handlingarFile, 'utf-8'))
  let yttrandeUrl = ''
  for (const s of handlingar.sammanträden) {
    if (s.datum !== datum) continue
    for (const h of s.handlingar) {
      if (h.titel.toLowerCase().includes('yttrandeprotokoll')) {
        yttrandeUrl = h.url
        break
      }
    }
  }

  if (!yttrandeUrl) {
    console.error(`Inget yttrandeprotokoll för ${datum}`)
    process.exit(1)
  }

  // Download PDF
  mkdirSync(TMP_DIR, { recursive: true })
  const pdfPath = join(TMP_DIR, `yttrandeprotokoll-${datum.replace(/-/g, '')}.pdf`)
  if (!existsSync(pdfPath)) {
    console.log('⬇️  Laddar ner yttrandeprotokoll...')
    execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' '${yttrandeUrl}' -o '${pdfPath}'`)
  }

  // Parse
  console.log('📄 Parsear yttrandeprotokoll...')
  const anföranden = parseYttrandeprotokoll(pdfPath)
  console.log(`   ${anföranden.length} anföranden`)

  // Stats
  const talare = new Map<string, number>()
  for (const a of anföranden) {
    talare.set(a.talare, (talare.get(a.talare) || 0) + 1)
  }
  console.log(`   ${talare.size} unika talare\n`)

  // Top speakers
  const sorted = [...talare.entries()].sort((a, b) => b[1] - a[1])
  for (const [namn, antal] of sorted.slice(0, 5)) {
    console.log(`   ${namn}: ${antal} anföranden`)
  }

  // Save
  const outPath = join(DATA_DIR, `debatter/speakers-${datum}.json`)
  const output = {
    datum,
    källa: yttrandeUrl,
    antalAnföranden: anföranden.length,
    antalTalare: talare.size,
    anföranden,
  }
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${outPath}`)
}

main().catch(console.error)
