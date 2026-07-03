/**
 * Parser: Årsredovisning / ekonomiskt utfall per nämnd
 *
 * Extraherar budget vs utfall per nämnd/förvaltning från:
 * 1. Göteborgs Stads årsredovisning (PDF med tabeller)
 * 2. Kompletterande uppföljning per december
 *
 * Producerar graf-noder av typ 'utfall' kopplade till
 * förvaltningsdirektörer och nämnder.
 *
 * Användning:
 *   npx tsx packages/pipeline/src/parsers/parse-arsredovisning.ts <pdf|url> <år>
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

interface NämndUtfall {
  nämnd: string
  nämndId: string
  direktörId: string | null
  budgetMnkr: number
  utfallMnkr: number
  avvikelseMnkr: number
  avvikelseProcent: number
}

interface GraphNode {
  id: string
  typ: string
  label: string
  data: Record<string, unknown>
}

interface GraphEdge {
  from: string
  to: string
  typ: string
  label?: string
  data?: Record<string, unknown>
}

// Mapping: nämnd name → nämnd graph ID
const NÄMND_ID_MAP: Record<string, string> = {
  Förskolenämnden: 'nämnd-förskolenämnden',
  Grundskolenämnden: 'nämnd-grundskolenämnden',
  Utbildningsnämnden: 'nämnd-utbildningsnämnden',
  Stadsmiljönämnden: 'nämnd-stadsmiljönämnden',
  Exploateringsnämnden: 'nämnd-exploateringsnämnden',
  Stadsbyggnadsnämnden: 'nämnd-stadsbyggnadsnämnden',
  'Idrotts- och föreningsnämnden': 'nämnd-idrotts-och-föreningsnämnden',
  Kulturnämnden: 'nämnd-kulturnämnden',
  'Miljö- och klimatnämnden': 'nämnd-miljö-och-klimatnämnden',
  'Nämnden för funktionsstöd': 'nämnd-nämnden-för-funktionsstöd',
  'Nämnden för intraservice': 'nämnd-nämnden-för-intraservice',
  'Nämnden för demokrati och medborgarservice': 'nämnd-nämnden-för-demokrati-och-medborgarservice',
  'Inköps- och upphandlingsnämnden': 'nämnd-inköps-och-upphandlingsnämnden',
  'Nämnden för arbetsmarknad och vuxenutbildning':
    'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
  'Äldre samt vård- och omsorgsnämnden': 'nämnd-äldre-samt-vård-och-omsorgsnämnden',
  'Socialnämnden Nordost': 'nämnd-socialnämnden-nordost',
  'Socialnämnden Centrum': 'nämnd-socialnämnden-centrum',
  'Socialnämnden Sydväst': 'nämnd-socialnämnden-sydväst',
  'Socialnämnden Hisingen': 'nämnd-socialnämnden-hisingen',
  Stadsfastighetsnämnden: 'nämnd-stadsfastighetsnämnden',
  'Kretslopp och vattennämnden': 'nämnd-kretslopp-och-vatten-västsvenska-paketet',
  Arkivnämnden: 'nämnd-arkivnämnden',
}

// Mapping: nämnd → direktör graph ID
const DIREKTÖR_MAP: Record<string, string> = {
  'nämnd-stadsmiljönämnden': 'direktör-anders-ramsby',
  'nämnd-kulturnämnden': 'direktör-anna-rosengren',
  'nämnd-socialnämnden-sydväst': 'direktör-annika-ljungh',
  'nämnd-äldre-samt-vård-och-omsorgsnämnden': 'direktör-babbs-edberg',
  'nämnd-arkivnämnden': 'direktör-birgitta-torgén',
  'nämnd-kretslopp-och-vatten-västsvenska-paketet': 'direktör-emma-hansryd',
  'nämnd-nämnden-för-demokrati-och-medborgarservice': 'direktör-eva-englund',
  'nämnd-socialnämnden-nordost': 'direktör-fredrik-johansson',
  'nämnd-stadsbyggnadsnämnden': 'direktör-henrik-kant',
  'nämnd-inköps-och-upphandlingsnämnden': 'direktör-henrik-karlsson',
  'nämnd-förskolenämnden': 'direktör-johan-olofsson',
  'nämnd-idrotts-och-föreningsnämnden': 'direktör-johan-sävhage',
  'nämnd-exploateringsnämnden': 'direktör-kristina-lindfors',
  'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning': 'direktör-lars-durfeldt',
  'nämnd-grundskolenämnden': 'direktör-maria-andersson',
  'nämnd-miljö-och-klimatnämnden': 'direktör-maria-jacobsson',
  'nämnd-socialnämnden-hisingen': 'direktör-marie-larsson',
  'nämnd-nämnden-för-funktionsstöd': 'direktör-neri-samuelsson',
  'nämnd-nämnden-för-intraservice': 'direktör-peter-söderström',
  'nämnd-socialnämnden-centrum': 'direktör-sandra-säljö',
  'nämnd-utbildningsnämnden': 'direktör-tomas-berndtsson',
}

function downloadPdf(source: string): string {
  mkdirSync(TMP_DIR, { recursive: true })
  if (source.startsWith('http')) {
    const filename = source.split('/').pop()?.replace(/\?.*/, '') || 'arsredovisning.pdf'
    const localPath = join(TMP_DIR, filename)
    if (!existsSync(localPath)) {
      console.log(`   Downloading ${filename}...`)
      execSync(`curl -sL -o "${localPath}" "${source}"`, { timeout: 120_000 })
    }
    return localPath
  }
  return source
}

function extractText(pdfPath: string): string {
  return execSync(`pdftotext -layout "${pdfPath}" -`, { maxBuffer: 50 * 1024 * 1024 }).toString()
}

function parseNumber(s: string): number {
  // Handle Swedish number format: "1 234,5" or "-1 234" or "1234"
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  return Number.parseFloat(cleaned) || 0
}

function findNämndId(name: string): string | null {
  // Exact match first
  if (NÄMND_ID_MAP[name]) return NÄMND_ID_MAP[name]
  // Fuzzy match
  const lower = name.toLowerCase()
  for (const [key, id] of Object.entries(NÄMND_ID_MAP)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase().slice(0, 15))) {
      return id
    }
  }
  return null
}

/**
 * Parse the "Kommunbidrag" or "Resultat per nämnd" table from årsredovisning PDF.
 *
 * Typical table format:
 *   Nämnd                    Budget    Utfall    Avvikelse
 *   Förskolenämnden          5 361     5 320     41
 *   Grundskolenämnden       10 547    10 612     -65
 */
function parseUtfallTable(text: string): NämndUtfall[] {
  const results: NämndUtfall[] = []
  const lines = text.split('\n')

  // Find table start: look for header row with "Budget" and "Utfall" or "Resultat"
  let tableStart = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    if (
      (line.includes('budget') && (line.includes('utfall') || line.includes('bokslut'))) ||
      (line.includes('kommunbidrag') && line.includes('avvikelse')) ||
      (line.includes('nämnd') && line.includes('budget') && line.includes('resultat'))
    ) {
      tableStart = i + 1
      break
    }
  }

  if (tableStart === -1) {
    // Alternative: look for "Driftredovisning" section
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('driftredovisning')) {
        tableStart = i + 2
        break
      }
    }
  }

  if (tableStart === -1) return results

  // Parse rows: "Name    num    num    num"
  for (let i = tableStart; i < Math.min(tableStart + 60, lines.length); i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.match(/^[\s-=]+$/)) continue // separator
    if (line.toLowerCase().includes('summa') || line.toLowerCase().includes('total')) break

    // Match: name followed by 2-4 numbers
    // Pattern: text (at least 10 chars), then 2+ number columns separated by spaces
    const match = line.match(
      /^(.{10,50}?)\s{2,}(-?[\d ]+(?:,\d)?)\s{2,}(-?[\d ]+(?:,\d)?)\s{2,}(-?[\d ]+(?:,\d)?)/,
    )
    if (!match) continue

    const nämndNamn = match[1].trim()
    const budget = parseNumber(match[2])
    const utfall = parseNumber(match[3])
    const avvikelse = parseNumber(match[4])

    // Skip if numbers don't make sense
    if (budget === 0 && utfall === 0) continue

    const nämndId = findNämndId(nämndNamn)
    if (!nämndId) continue

    results.push({
      nämnd: nämndNamn,
      nämndId,
      direktörId: DIREKTÖR_MAP[nämndId] || null,
      budgetMnkr: budget,
      utfallMnkr: utfall,
      avvikelseMnkr: avvikelse || utfall - budget,
      avvikelseProcent:
        budget !== 0 ? Math.round(((utfall - budget) / Math.abs(budget)) * 1000) / 10 : 0,
    })
  }

  return results
}

/**
 * Alternative: parse "kompletterande uppföljning" which has
 * a different table format with prognos per nämnd
 */
function parseKompletterandeUppföljning(text: string): NämndUtfall[] {
  const results: NämndUtfall[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Look for nämnd names followed by numbers
    for (const [nämndNamn, nämndId] of Object.entries(NÄMND_ID_MAP)) {
      if (
        line.includes(nämndNamn) ||
        line.toLowerCase().includes(nämndNamn.toLowerCase().slice(0, 20))
      ) {
        // Try to find numbers on same line or next line
        const numbers = line.match(/-?[\d ]{3,}(?:,\d)?/g)
        if (numbers && numbers.length >= 2) {
          const vals = numbers.map(parseNumber)
          const budget = vals[0]
          const utfall = vals.length >= 3 ? vals[1] : vals[1]
          const avvikelse = vals.length >= 3 ? vals[2] : utfall - budget
          results.push({
            nämnd: nämndNamn,
            nämndId,
            direktörId: DIREKTÖR_MAP[nämndId] || null,
            budgetMnkr: budget,
            utfallMnkr: utfall,
            avvikelseMnkr: avvikelse,
            avvikelseProcent:
              budget !== 0 ? Math.round(((utfall - budget) / Math.abs(budget)) * 1000) / 10 : 0,
          })
          break
        }
      }
    }
  }

  return results
}

function buildGraph(utfall: NämndUtfall[], år: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Summary node
  const totalBudget = utfall.reduce((s, u) => s + u.budgetMnkr, 0)
  const totalUtfall = utfall.reduce((s, u) => s + u.utfallMnkr, 0)
  const summaryId = `utfall-sammanfattning-${år}`

  nodes.push({
    id: summaryId,
    typ: 'utfall',
    label: `Ekonomiskt utfall ${år} — alla nämnder`,
    data: {
      år,
      totalBudgetMnkr: totalBudget,
      totalUtfallMnkr: totalUtfall,
      totalAvvikelseMnkr: totalUtfall - totalBudget,
      antalNämnder: utfall.length,
      underskott: utfall
        .filter((u) => u.avvikelseMnkr < 0)
        .map((u) => ({ nämnd: u.nämnd, mnkr: u.avvikelseMnkr })),
      överskott: utfall
        .filter((u) => u.avvikelseMnkr > 0)
        .map((u) => ({ nämnd: u.nämnd, mnkr: u.avvikelseMnkr })),
    },
  })

  // Per-nämnd utfall nodes
  for (const u of utfall) {
    const nodeId = `utfall-${u.nämndId}-${år}`
    nodes.push({
      id: nodeId,
      typ: 'utfall',
      label: `${u.nämnd} utfall ${år}: ${u.avvikelseMnkr > 0 ? '+' : ''}${u.avvikelseMnkr} mnkr`,
      data: {
        nämnd: u.nämnd,
        år,
        budgetMnkr: u.budgetMnkr,
        utfallMnkr: u.utfallMnkr,
        avvikelseMnkr: u.avvikelseMnkr,
        avvikelseProcent: u.avvikelseProcent,
        status:
          u.avvikelseMnkr < -10
            ? 'stort_underskott'
            : u.avvikelseMnkr < 0
              ? 'underskott'
              : 'i_balans',
      },
    })

    // Edge: utfall → nämnd
    edges.push({
      from: nodeId,
      to: u.nämndId,
      typ: 'utfall_för',
      label: `${u.avvikelseMnkr > 0 ? '+' : ''}${u.avvikelseMnkr} mnkr`,
    })

    // Edge: utfall → summary
    edges.push({ from: nodeId, to: summaryId, typ: 'ingår_i' })

    // Edge: utfall → direktör (if mapped)
    if (u.direktörId) {
      edges.push({
        from: nodeId,
        to: u.direktörId,
        typ: 'ansvarig',
        label: 'förvaltningsdirektör',
        data: {
          avvikelseMnkr: u.avvikelseMnkr,
          status: u.avvikelseMnkr < 0 ? 'underskott' : 'i_balans',
        },
      })
    }
  }

  return { nodes, edges }
}

async function main() {
  const source = process.argv[2]
  const år = process.argv[3] || '2025'

  if (!source) {
    console.log('Användning: npx tsx parse-arsredovisning.ts <pdf|url> <år>')
    console.log('Exempel:')
    console.log('  npx tsx parse-arsredovisning.ts ./data/inbox/arsredovisning-2025.pdf 2025')
    console.log('  npx tsx parse-arsredovisning.ts https://goteborg.se/.../arsredovisning.pdf 2025')
    process.exit(1)
  }

  console.log(`📊 Parsing årsredovisning ${år}...\n`)

  const pdfPath = downloadPdf(source)
  console.log(`   PDF: ${pdfPath}`)

  const text = extractText(pdfPath)
  console.log(`   Extracted ${text.length} chars`)

  // Try primary table format
  let utfall = parseUtfallTable(text)
  console.log(`   Primary parser: ${utfall.length} nämnder found`)

  // Fallback to kompletterande uppföljning format
  if (utfall.length < 5) {
    const alt = parseKompletterandeUppföljning(text)
    console.log(`   Alternative parser: ${alt.length} nämnder found`)
    if (alt.length > utfall.length) utfall = alt
  }

  if (utfall.length === 0) {
    console.log('\n⚠️  Kunde inte hitta budgettabell. Kanske behövs pixelRAG för denna PDF.')
    console.log('   Spara text för manuell inspektion:')
    const debugPath = join(TMP_DIR, `arsredovisning-${år}-text.txt`)
    writeFileSync(debugPath, text)
    console.log(`   ${debugPath}`)
    process.exit(1)
  }

  // Print summary
  console.log('\n   Resultat per nämnd:')
  console.log(`   ${'-'.repeat(70)}`)
  for (const u of utfall.sort((a, b) => a.avvikelseMnkr - b.avvikelseMnkr)) {
    const sign = u.avvikelseMnkr >= 0 ? '+' : ''
    const flag = u.avvikelseMnkr < -10 ? ' ⚠️' : ''
    console.log(`   ${u.nämnd.padEnd(45)} ${sign}${u.avvikelseMnkr} mnkr${flag}`)
  }

  const { nodes, edges } = buildGraph(utfall, år)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, `utfall-nämnder-${år}.json`)
  writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2))
  console.log(`\n✅ ${outPath} (${nodes.length} nodes, ${edges.length} edges)`)
}

main().catch(console.error)
