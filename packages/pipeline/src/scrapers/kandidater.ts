/**
 * Downloader: Valmyndighetens kandidaturer (rådata) inför val 2026 — KF Göteborg.
 *
 * Källa: https://data.val.se/filer/val2026/parti/kandidaturer.csv
 * (uppdateras varje timme fram till valet 2026-09-13).
 *
 * Filtrerar VALTYP=KF, VALOMRÅDESKOD=1480 (Göteborgs kommun), och matchar
 * varje kandidat mot sittande politiker (data/politiker/goteborg.json) med
 * samma namn+parti-resolver som redan används för att koppla ihop talare i
 * yttrandeprotokoll med politiker-registret — kandidater som redan sitter i
 * KF länkas då till sin befintliga politiker-sida.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPolitikerResolver } from '../parsers/parse-yttrandeprotokoll'

const CSV_URL = 'https://data.val.se/filer/val2026/parti/kandidaturer.csv'
const GÖTEBORG_KOMMUNKOD = '1480'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/politiker')
const ROSTER_PATH = join(OUTPUT_DIR, 'goteborg.json')

// Valmyndighetens PARTIFÖRKORTNING matchar sajtens partikoder rakt av,
// utom Demokraterna (Göteborgs lokala parti) som Valmyndigheten kodar "DEM".
const PARTI_ALIAS: Record<string, string> = { DEM: 'D' }

// Fallback för partier utan officiell förkortning (småpartier/skämtlistor):
// initialer av flerordsnamn ("Svarta ballonger" → "SB"), annars tre bokstäver.
function kortaPartinamn(beteckning: string): string {
  const ord = beteckning
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-ZåäöÅÄÖ]/.test(w))
  if (ord.length > 1)
    return ord
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3)
  return beteckning.trim().slice(0, 3).toUpperCase()
}

function partiKod(förkortning: string, beteckning: string): string {
  const kod = förkortning.trim()
  if (!kod) return kortaPartinamn(beteckning)
  return PARTI_ALIAS[kod] || kod
}

// CSV:t levererar namn som "Förnamn Efternamn" för fastställda listor, men
// "Efternamn, Förnamn" för ännu ej fastställda (ANMÄLDAKANDIDATER=N).
function normaliseraNamn(namn: string): string {
  const trimmed = namn.trim()
  if (!trimmed.includes(',')) return trimmed
  const [efternamn, förnamn] = trimmed.split(',').map((s) => s.trim())
  return `${förnamn} ${efternamn}`
}

interface Kandidat {
  id: string
  namn: string
  parti: string
  listplats: number | null
  ålder: number | null
  kön: string | null
  fastställd: boolean
  politikerId: string | null
}

async function main() {
  console.log('🔍 Hämtar kandidaturer 2026 (Valmyndigheten)...\n')
  const res = await fetch(CSV_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${CSV_URL}`)
  const csv = (await res.text()).replace(/^﻿/, '')
  const [headerLine, ...lines] = csv.trim().split('\n')
  const headers = headerLine.split(';').map((h) => h.trim())
  const col = (row: string[], name: string) => row[headers.indexOf(name)]?.trim() ?? ''

  const roster = existsSync(ROSTER_PATH)
    ? (JSON.parse(readFileSync(ROSTER_PATH, 'utf-8')).politiker as Array<{
        id: string
        förnamn: string
        efternamn: string
        parti: string
      }>)
    : []
  const resolve = createPolitikerResolver(roster)

  const kandidater: Kandidat[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const row = line.split(';')
    if (col(row, 'VALTYP') !== 'KF') continue
    if (col(row, 'VALOMRÅDESKOD') !== GÖTEBORG_KOMMUNKOD) continue
    if (col(row, 'GILTIG') !== 'J') continue

    const namn = normaliseraNamn(col(row, 'NAMN'))
    const parti = partiKod(col(row, 'PARTIFÖRKORTNING'), col(row, 'PARTIBETECKNING'))
    const ordning = col(row, 'ORDNING')
    const ålder = col(row, 'ÅLDER_PÅ_VALDAGEN')

    kandidater.push({
      id: col(row, 'KANDIDATNUMMER'),
      namn,
      parti,
      listplats: ordning ? Number(ordning) : null,
      ålder: ålder ? Number(ålder) : null,
      kön: col(row, 'KÖN') || null,
      fastställd: col(row, 'ANMÄLDAKANDIDATER') === 'J',
      politikerId: resolve(namn, parti),
    })
  }

  kandidater.sort((a, b) => {
    if (a.parti !== b.parti) return a.parti.localeCompare(b.parti, 'sv')
    return (a.listplats ?? 999) - (b.listplats ?? 999)
  })

  const matchade = kandidater.filter((k) => k.politikerId).length
  console.log(
    `   ${kandidater.length} kandidater (KF Göteborg), ${matchade} länkade till sittande politiker\n`,
  )

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, 'kandidater-2026-goteborg.json')
  const output = {
    val: '2026',
    kommun: 'goteborg',
    valtyp: 'kommunfullmäktige',
    källa: CSV_URL,
    hämtad: new Date().toISOString(),
    antal: kandidater.length,
    kandidater,
  }
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`✅ Sparad: ${outPath}`)
}

main().catch(console.error)
