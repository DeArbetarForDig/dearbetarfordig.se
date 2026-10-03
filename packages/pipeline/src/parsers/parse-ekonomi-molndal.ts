/**
 * Mölndals stads ekonomi → kunskapsgraf (samma format som Göteborgs
 * data/graf/budget-ÅR.json och utfall-nämnder-ÅR.json, men under
 * data/molndal/graf/ — seed.ts laddar data/graf/ in i goteborg-schemat).
 *
 * Källor (PDF-länkarna hittas på sidorna, inget hårdkodat id):
 * - "Budget och plan ÅR–ÅR+2", tabellen "Totalt kommunbidrag per nämnd"
 *   (kolumner: föregående år, budgetår, förändring %).
 * - "Årsredovisning ÅR", tabellen "Driftredovisning kommun" (intäkter,
 *   kostnader, utfall för föregående år och ÅR, budget ÅR, resultat, andel).
 *
 * Usage: npx tsx packages/pipeline/src/parsers/parse-ekonomi-molndal.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BAS = 'https://www.molndal.se'
const BUDGETSIDA = `${BAS}/kommun-och-politik/ekonomi-och-budget/budget`
const ÅRSREDOVISNINGSSIDA = `${BAS}/kommun-och-politik/ekonomi-och-budget/arsredovisning`
const FRÅN_ÅR = 2022
const ROOT = join(import.meta.dirname, '../../../..')
const OUTPUT_DIR = join(ROOT, 'data/molndal/graf')
const TMP_DIR = join(ROOT, '.tmp/molndal-ekonomi')

// "1 833,3" → 1833.3. En fotnotssiffra kan sitta ihop med talet ("471,51" =
// 471,5 + fotnot 1), så exakt en decimal läses och resten ignoreras.
const TAL = String.raw`-?\d{1,3}(?: \d{3})*,\d`
const tal = (s: string) => Number(s.replace(/ /g, '').replace(',', '.'))
const avrunda = (n: number) => Math.round(n * 10) / 10

export function slug(namn: string): string {
  return namn
    .toLowerCase()
    .replace(/[^a-zåäö0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface Kommunbidrag {
  namn: string
  föregående: number
  budget: number
}

/** "Totalt kommunbidrag per nämnd" → rader + Summa (budgetårets kolumn). */
export function parseKommunbidrag(text: string): { rader: Kommunbidrag[]; summa: number } {
  const rader: Kommunbidrag[] = []
  const rad = new RegExp(
    String.raw`^\s*([A-ZÅÄÖ][^\d]*?)\s*(?:\d\))?\s{2,}(${TAL})\d?\s+(${TAL})\d?`,
  )
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /Totalt kommunbidrag per nämnd/i.test(l))
  if (start < 0) throw new Error('Hittar inte tabellen "Totalt kommunbidrag per nämnd"')
  for (const line of lines.slice(start + 1, start + 40)) {
    const m = line.match(rad)
    if (!m) continue
    const namn = m[1].trim()
    if (/^summa/i.test(namn)) return { rader, summa: tal(m[3]) }
    rader.push({ namn, föregående: tal(m[2]), budget: tal(m[3]) })
  }
  throw new Error('Tabellen "Totalt kommunbidrag per nämnd" saknar Summa-rad')
}

export interface Driftrad {
  nämnd: string
  intäkter: number
  kostnader: number
  utfall: number
  budget: number
  resultat: number
}

/**
 * "Driftredovisning kommun" → nämndrader för redovisningsåret (kolumn 4–8).
 * Kastar om nämndernas resultat inte summerar till Summa-raden.
 */
export function parseDriftredovisning(text: string): Driftrad[] {
  const rader: Driftrad[] = []
  const rad = new RegExp(
    String.raw`^\s*([A-ZÅÄÖ][^\d]*?)\s{2,}${Array(8).fill(`(${TAL})`).join(String.raw`\s+`)}\s+-?\d+,\d%`,
  )
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^\s*Driftredovisning kommun\s*$/.test(l))
  if (start < 0) throw new Error('Hittar inte tabellen "Driftredovisning kommun"')
  for (const line of lines.slice(start + 1, start + 40)) {
    const m = line.match(rad)
    if (!m) continue
    const nämnd = m[1].trim()
    const [, , , intäkter, kostnader, utfall, budget, resultat] = m.slice(2).map(tal)
    if (/^summa/i.test(nämnd)) {
      const summa = avrunda(rader.reduce((s, r) => s + r.resultat, 0))
      if (Math.abs(summa - resultat) > 0.5)
        throw new Error(
          `Driftredovisning: resultaten summerar till ${summa}, Summa-raden ${resultat}`,
        )
      return rader
    }
    rader.push({ nämnd, intäkter, kostnader, utfall, budget, resultat })
  }
  throw new Error('Tabellen "Driftredovisning kommun" saknar Summa-rad')
}

async function pdfLänkar(sida: string, mönster: RegExp): Promise<Map<number, string>> {
  const res = await fetch(sida, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${sida}`)
  const html = await res.text()
  const länkar = new Map<number, string>()
  // Fillistorna ligger som JSON i sidans AppRegistry-state ("uri":"/download/…"),
  // inte som <a href> — matcha därför bara den citerade sökvägen.
  for (const m of html.matchAll(/"(\/download\/[^"]+\.pdf)"/g)) {
    const år = decodeURIComponent(m[1]).match(mönster)?.[1]
    if (år && Number(år) >= FRÅN_ÅR) länkar.set(Number(år), `${BAS}${m[1]}`)
  }
  return länkar
}

function pdfText(url: string, namn: string): string {
  const pdf = join(TMP_DIR, `${namn}.pdf`)
  if (!existsSync(pdf)) execSync(`curl -sfL -A 'Mozilla/5.0' '${url}' -o '${pdf}'`)
  return execSync(`pdftotext -layout '${pdf}' -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
}

async function main() {
  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Budget per år
  const budgetar = await pdfLänkar(BUDGETSIDA, /Budget plan (\d{4})-\d{4}\.pdf$/)
  for (const [år, url] of [...budgetar].sort()) {
    const { rader, summa } = parseKommunbidrag(pdfText(url, `budget-${år}`))
    const summaRader = avrunda(rader.reduce((s, r) => s + r.budget, 0))
    if (Math.abs(summaRader - summa) > 0.5)
      throw new Error(`Budget ${år}: raderna summerar till ${summaRader}, Summa-raden ${summa}`)
    const nodes = [
      {
        id: `budget-${år}`,
        typ: 'budget',
        label: `Mölndals stad kommunbidrag ${år}`,
        data: { år, totalMnkr: summa, källa: url },
      },
      ...rader.map((r) => ({
        id: `nämnd-${slug(r.namn)}-${år}`,
        typ: 'organisation',
        label: r.namn,
        data: { kommunbidragMnkr: r.budget, andelProcent: avrunda((r.budget / summa) * 100) },
      })),
    ]
    const edges = rader.map((r) => ({
      from: `budget-${år}`,
      to: `nämnd-${slug(r.namn)}-${år}`,
      typ: 'finansierar',
      data: { mnkr: r.budget, andel: avrunda((r.budget / summa) * 100) },
    }))
    writeFileSync(join(OUTPUT_DIR, `budget-${år}.json`), JSON.stringify({ nodes, edges }, null, 2))
    console.log(`   ✓ budget ${år}: ${rader.length} nämnder, ${summa} mnkr`)
  }

  // Utfall per år (årsredovisningen)
  const årsredovisningar = await pdfLänkar(ÅRSREDOVISNINGSSIDA, /Årsredovisning_(\d{4})\.pdf$/)
  for (const [år, url] of [...årsredovisningar].sort()) {
    const rader = parseDriftredovisning(pdfText(url, `arsredovisning-${år}`))
    const nodes = [
      {
        id: `utfall-sammanfattning-${år}`,
        typ: 'utfall',
        label: `Ekonomiskt utfall ${år} — alla nämnder`,
        data: {
          år,
          källa: `Mölndals stads årsredovisning ${år}`,
          url,
          totalResultatMnkr: avrunda(rader.reduce((s, r) => s + r.resultat, 0)),
          antalNämnder: rader.length,
        },
      },
      ...rader.map((r) => ({
        id: `utfall-nämnd-${slug(r.nämnd)}-${år}`,
        typ: 'utfall',
        label: `${r.nämnd} utfall ${år}: ${r.resultat > 0 ? '+' : ''}${r.resultat} mnkr`,
        data: {
          nämnd: r.nämnd,
          år,
          intäkterMnkr: r.intäkter,
          kostnaderMnkr: r.kostnader,
          kommunbidragMnkr: r.budget,
          resultatMnkr: r.resultat,
          budgetMnkr: 0,
          // Samma gränser som Göteborgs utfall (generate-utfall-historik.ts)
          status:
            r.resultat < -50 ? 'stort_underskott' : r.resultat < 0 ? 'underskott' : 'i_balans',
        },
      })),
    ]
    writeFileSync(
      join(OUTPUT_DIR, `utfall-nämnder-${år}.json`),
      JSON.stringify({ nodes, edges: [] }, null, 2),
    )
    console.log(`   ✓ utfall ${år}: ${rader.length} nämnder`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
