/**
 * Aggregerar Leverantörsfakturor (psidata, catalog.goteborg.se store 6) per
 * nämnd, på två nivåer:
 *   - typ 'leverantörsutfall' (per år): största leverantörer, total
 *     leverantörsutgift jämfört mot kommunbidrag (budget-ÅR.json), utgifter
 *     per kontokategori.
 *   - typ 'leverantörsutfall-månad' (per månad): bara fakta — total +
 *     största leverantörer den månaden. Inget jämförbart plan: staden
 *     publicerar bara ett årligt kommunbidrag, ingen månadsvis budget.
 *     Läs inte in "hög/låg månad" som avvikelse — leverantörsfakturor är
 *     ojämnt fördelade över året (stora entreprenadfakturor kan komma i en
 *     enda betalning), inte en signal om budgetproblem i sig.
 *
 * Detta är INTE samma sak som "budgetuppföljning"/utfall i stort — en
 * leverantörsfaktura täcker bara externa inköp (varor, tjänster,
 * entreprenader). Löner (ofta nämndens största kostnad) går via
 * lönesystemet, inte leverantörsreskontran, och syns alltså inte här.
 * "andelAvKommunbidragProcent" mäter därför bara hur stor del av
 * kommunbidraget som går till externa leverantörer — inte nämndens totala
 * budgetutfall.
 *
 * Återanvänder resolveMonthlyResourceGroups/downloadMonthText från
 * leverantorsfakturor.ts (samma källa, samma dedup/fallback-hantering för
 * trasiga uppladdningar).
 *
 * Användning: npx tsx packages/pipeline/src/scrapers/leverantorsfakturor-namnd.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type MonthCandidate,
  downloadMonthText,
  resolveMonthlyResourceGroups,
} from './leverantorsfakturor'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp/leverantorsfakturor')
const OUTPUT_PATH = join(DATA_DIR, 'graf/leverantorsutfall-namnder.json')

const TOP_LEVERANTÖRER = 15
const TOP_KATEGORIER = 10

// Samma CANONICAL-lista som packages/api/src/db/merge-organisations.ts
// (duplicerad — pipeline beror inte på api), plus alias för stavningar som
// bara förekommer i leverantörsfaktura-CSV:ernas "Förvaltning"-kolumn.
const CANONICAL: Record<string, string> = {
  förskolenämnden: 'nämnd-förskolenämnden',
  grundskolenämnden: 'nämnd-grundskolenämnden',
  utbildningsnämnden: 'nämnd-utbildningsnämnden',
  'socialnämnden nordost': 'nämnd-socialnämnden-nordost',
  'socialnämnden centrum': 'nämnd-socialnämnden-centrum',
  'socialnämnden sydväst': 'nämnd-socialnämnden-sydväst',
  'socialnämnden hisingen': 'nämnd-socialnämnden-hisingen',
  kulturnämnden: 'nämnd-kulturnämnden',
  'idrotts- och föreningsnämnden': 'nämnd-idrotts-och-föreningsnämnden',
  stadsmiljönämnden: 'nämnd-stadsmiljönämnden',
  stadsbyggnadsnämnden: 'nämnd-stadsbyggnadsnämnden',
  exploateringsnämnden: 'nämnd-exploateringsnämnden',
  'miljö- och klimatnämnden': 'nämnd-miljö-och-klimatnämnden',
  kommunstyrelsen: 'nämnd-kommunledningen',
  'nämnden för funktionsstöd': 'nämnd-nämnden-för-funktionsstöd',
  'nämnden för arbetsmarknad och vuxenutbildning':
    'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
  'inköps- och upphandlingsnämnden': 'nämnd-inköps-och-upphandlingsnämnden',
  'nämnden för intraservice': 'nämnd-nämnden-för-intraservice',
  'nämnden för demokrati och medborgarservice': 'nämnd-nämnden-för-demokrati-och-medborgarservice',
  stadsfastighetsnämnden: 'nämnd-stadsfastighetsnämnden',
  'kretslopp- och vattennämnden': 'nämnd-kretslopp-och-vattennämnden',
  'kretslopp och vattennämnden': 'nämnd-kretslopp-och-vattennämnden',
  valnämnden: 'nämnd-valnämnden',
  'äldre samt vård- och omsorgsnämnden': 'nämnd-äldre-samt-vård-och-omsorgsnämnden',
  arkivnämnden: 'nämnd-arkivnämnden',
}

// CSV-specifika varianter som inte matchar CANONICAL rakt av, plus
// predecessor→successor från Göteborgs Stads omorganisation 2021 (rena
// namnbyten/sammanslagningar — inte de 10 stadsdelsnämnderna eller Sociala
// resursnämnden, vars ansvar splittrades över FLERA nya nämnder och därför
// inte kan mappas 1:1 utan att felaktigt tillskriva utgifter; de lämnas
// omappade och loggas, se `unmapped` i main()).
const FÖRVALTNING_ALIASES: Record<string, string> = {
  'nämnden för inköp och upphandling': 'inköps- och upphandlingsnämnden',
  'inköp och upphandling': 'inköps- och upphandlingsnämnden',
  'idrotts-och föreningsnämnden': 'idrotts- och föreningsnämnden',
  byggnadsnämnden: 'stadsbyggnadsnämnden',
  fastighetsnämnden: 'stadsfastighetsnämnden',
  'fastighetsnämnden transfer': 'stadsfastighetsnämnden',
  lokalnämnden: 'stadsfastighetsnämnden',
  trafiknämnden: 'stadsmiljönämnden',
  'park- och naturnämnden': 'stadsmiljönämnden',
  'park-och naturnämnden': 'stadsmiljönämnden',
  vuxenutbildningsnämnden: 'nämnden för arbetsmarknad och vuxenutbildning',
  'arbetsmarknad och vuxenutb': 'nämnden för arbetsmarknad och vuxenutbildning',
  'konsument och medborgarservice': 'nämnden för demokrati och medborgarservice',
  kommunledning: 'kommunstyrelsen',
  intraservice: 'nämnden för intraservice',
  'socialnämnd sydväst': 'socialnämnden sydväst',
  'socialnämnd nordost': 'socialnämnden nordost',
  'socialnämnd centrum': 'socialnämnden centrum',
  'socialnämnd hisingen': 'socialnämnden hisingen',
}

function normalizeFörvaltning(raw: string): string | null {
  // "400 - Stadsmiljönämnden" / "205 - Stadsbyggnadsnämnden (transfereringar)"
  // / "Göteborgs grundskolenämnd" (older months prefix the name with
  // "Göteborgs" and sometimes drop the final "en").
  let name = raw
    .replace(/^\d+\s*-\s*/, '')
    .replace(/\([^)]*\)\s*$/, '')
    .replace(/\s+transfer(eringar)?$/i, '')
    .replace(/^göteborgs\s+/i, '')
    .trim()
    .toLowerCase()
  if (name.match(/nämnd$/) && !name.endsWith('nämnden')) name += 'en'
  name = FÖRVALTNING_ALIASES[name] || name

  if (CANONICAL[name]) return CANONICAL[name]
  for (const key of Object.keys(CANONICAL)) {
    if (key.startsWith(name) && name.length >= 10) return CANONICAL[key]
    if (name.startsWith(key)) return CANONICAL[key]
  }
  return null
}

// Accumulates in raw kronor (what parseBelopp returns) — converted to tkr
// (thousands of kronor, this project's existing budgetpost convention, see
// data/graf/budget-*.json) only at output time, to keep the unit unambiguous
// while summing.
interface Accumulator {
  sumKr: number
  count: number
}

interface SupplierAccumulator extends Accumulator {
  leverantör: string
  orgnr: string
}

interface KategoriAccumulator extends Accumulator {
  kontotext: string
}

function parseCsvLine(line: string): string[] {
  return line.split(';')
}

function parseBelopp(raw: string): number {
  return Number((raw || '0').trim().replace(/\s/g, '').replace(',', '.')) || 0
}

async function processMonth(
  key: string,
  candidates: MonthCandidate[],
  nämndYear: Map<string, Accumulator>,
  nämndYearSupplier: Map<string, Map<string, SupplierAccumulator>>,
  nämndYearKategori: Map<string, Map<string, KategoriAccumulator>>,
  nämndMonth: Map<string, Accumulator>,
  nämndMonthSupplier: Map<string, Map<string, SupplierAccumulator>>,
  unmapped: Map<string, number>,
): Promise<void> {
  const year = Number(key.slice(0, 4))
  const cachePath = join(TMP_DIR, `${key}.csv`)
  const text = await downloadMonthText(candidates, cachePath)
  if (!text) {
    console.warn(`   ⚠️  ${key}: inget innehåll — hoppar över`)
    return
  }

  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = parseCsvLine(lines[0])
  const idxFörvaltning = header.findIndex((h) => h.trim() === 'Förvaltning')
  const idxLeverantör = header.findIndex((h) => h.trim() === 'Leverantör')
  const idxOrgnr = header.findIndex((h) => h.trim() === 'Organisationsnummer')
  const idxKontotext = header.findIndex((h) => h.trim() === 'Kontotext')
  const idxBelopp = header.findIndex((h) => h.trim().startsWith('Belopp'))

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    const förvaltningRaw = cols[idxFörvaltning]?.trim()
    if (!förvaltningRaw) continue
    const nämndId = normalizeFörvaltning(förvaltningRaw)
    if (!nämndId) {
      unmapped.set(förvaltningRaw, (unmapped.get(förvaltningRaw) || 0) + 1)
      continue
    }
    const belopp = parseBelopp(cols[idxBelopp])
    const nyKey = `${nämndId}|${year}`
    const nmKey = `${nämndId}|${key}`
    const leverantör = cols[idxLeverantör]?.trim() || ''
    const orgnr = cols[idxOrgnr]?.trim().replace(/[^\d]/g, '') || ''
    const supplierKey = orgnr || leverantör
    const kontotext = cols[idxKontotext]?.trim() || 'Okänt'

    const nyTotal = nämndYear.get(nyKey) || { sumKr: 0, count: 0 }
    nyTotal.sumKr += belopp
    nyTotal.count++
    nämndYear.set(nyKey, nyTotal)

    const supplierMap = nämndYearSupplier.get(nyKey) || new Map<string, SupplierAccumulator>()
    const supplierEntry = supplierMap.get(supplierKey) || { leverantör, orgnr, sumKr: 0, count: 0 }
    supplierEntry.sumKr += belopp
    supplierEntry.count++
    supplierMap.set(supplierKey, supplierEntry)
    nämndYearSupplier.set(nyKey, supplierMap)

    const kategoriMap = nämndYearKategori.get(nyKey) || new Map<string, KategoriAccumulator>()
    const kategoriEntry = kategoriMap.get(kontotext) || { kontotext, sumKr: 0, count: 0 }
    kategoriEntry.sumKr += belopp
    kategoriEntry.count++
    kategoriMap.set(kontotext, kategoriEntry)
    nämndYearKategori.set(nyKey, kategoriMap)

    // Månadsnivå (fakta, inget jämförbart plan finns — staden publicerar
    // bara ett årligt kommunbidrag, ingen månadsvis budget).
    const nmTotal = nämndMonth.get(nmKey) || { sumKr: 0, count: 0 }
    nmTotal.sumKr += belopp
    nmTotal.count++
    nämndMonth.set(nmKey, nmTotal)

    const nmSupplierMap = nämndMonthSupplier.get(nmKey) || new Map<string, SupplierAccumulator>()
    const nmSupplierEntry = nmSupplierMap.get(supplierKey) || {
      leverantör,
      orgnr,
      sumKr: 0,
      count: 0,
    }
    nmSupplierEntry.sumKr += belopp
    nmSupplierEntry.count++
    nmSupplierMap.set(supplierKey, nmSupplierEntry)
    nämndMonthSupplier.set(nmKey, nmSupplierMap)
  }
}

function loadKommunbidrag(): Map<string, number> {
  const map = new Map<string, number>()
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    const path = join(DATA_DIR, `graf/budget-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const n of data.nodes) {
      if (n.typ !== 'organisation' || typeof n.data?.kommunbidragMnkr !== 'number') continue
      const m = n.id.match(/^(nämnd-.+)-(\d{4})$/)
      if (!m) continue
      map.set(`${m[1]}|${m[2]}`, n.data.kommunbidragMnkr)
    }
  }
  return map
}

async function main() {
  console.log('💰 Leverantörsutfall per nämnd/år (psidata)\n')

  const groups = await resolveMonthlyResourceGroups()
  const monthKeys = [...groups.keys()].sort()
  console.log(
    `   ${monthKeys.length} månadsfiler (${monthKeys[0]}…${monthKeys[monthKeys.length - 1]})`,
  )

  const nämndYear = new Map<string, Accumulator>()
  const nämndYearSupplier = new Map<string, Map<string, SupplierAccumulator>>()
  const nämndYearKategori = new Map<string, Map<string, KategoriAccumulator>>()
  const nämndMonth = new Map<string, Accumulator>()
  const nämndMonthSupplier = new Map<string, Map<string, SupplierAccumulator>>()
  const unmapped = new Map<string, number>()

  let processed = 0
  for (const key of monthKeys) {
    const candidates = groups.get(key)!
    await processMonth(
      key,
      candidates,
      nämndYear,
      nämndYearSupplier,
      nämndYearKategori,
      nämndMonth,
      nämndMonthSupplier,
      unmapped,
    )
    processed++
    if (processed % 20 === 0) console.log(`   … ${processed}/${monthKeys.length} månader`)
  }

  if (unmapped.size > 0) {
    console.log('\n   ⚠️  Förvaltning-värden som inte kunde mappas till nämnd (rader, namn):')
    for (const [namn, count] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(count).padStart(8)}  ${namn}`)
    }
  }

  const kommunbidrag = loadKommunbidrag()
  const nodes: Array<{ id: string; typ: string; label: string; data: Record<string, unknown> }> = []
  const edges: Array<{ from: string; to: string; typ: string }> = []

  for (const [key, total] of nämndYear) {
    const [nämndId, yearStr] = key.split('|')
    const year = Number(yearStr)
    const supplierMap = nämndYearSupplier.get(key) || new Map()
    const kategoriMap = nämndYearKategori.get(key) || new Map()

    const topLeverantörer = [...supplierMap.values()]
      .sort((a, b) => b.sumKr - a.sumKr)
      .slice(0, TOP_LEVERANTÖRER)
      .map((s) => ({
        namn: s.leverantör,
        orgnr: s.orgnr || null,
        sumTkr: Math.round(s.sumKr / 1000),
        fakturaAntal: s.count,
      }))

    const utgiftskategorier = [...kategoriMap.values()]
      .sort((a, b) => b.sumKr - a.sumKr)
      .slice(0, TOP_KATEGORIER)
      .map((k) => ({
        kontotext: k.kontotext,
        sumTkr: Math.round(k.sumKr / 1000),
        fakturaAntal: k.count,
      }))

    const kommunbidragMnkr = kommunbidrag.get(`${nämndId}|${year}`) ?? null
    const totalMnkr = total.sumKr / 1_000_000
    const andelAvKommunbidragProcent = kommunbidragMnkr
      ? Math.round((totalMnkr / kommunbidragMnkr) * 1000) / 10
      : null

    const id = `leverantörsutfall-${nämndId}-${year}`
    nodes.push({
      id,
      typ: 'leverantörsutfall',
      label: `Leverantörsutfall ${year}`,
      data: {
        år: year,
        totalTkr: Math.round(total.sumKr / 1000),
        fakturaAntal: total.count,
        kommunbidragMnkr,
        andelAvKommunbidragProcent,
        topLeverantörer,
        utgiftskategorier,
      },
    })
    edges.push({ from: id, to: nämndId, typ: 'avser' })
  }

  // Månadsvis fakta — inget "andelAvKommunbidrag" här: det finns bara ett
  // årligt kommunbidrag att jämföra mot, ingen månadsvis budget publiceras.
  const TOP_LEVERANTÖRER_MÅNAD = 10
  let monthNodeCount = 0
  for (const [key, total] of nämndMonth) {
    const [nämndId, period] = key.split('|')
    const [yearStr, monthStr] = period.split('-')
    const supplierMap = nämndMonthSupplier.get(key) || new Map()

    const topLeverantörer = [...supplierMap.values()]
      .sort((a, b) => b.sumKr - a.sumKr)
      .slice(0, TOP_LEVERANTÖRER_MÅNAD)
      .map((s) => ({
        namn: s.leverantör,
        orgnr: s.orgnr || null,
        sumTkr: Math.round(s.sumKr / 1000),
        fakturaAntal: s.count,
      }))

    const id = `leverantörsutfall-${nämndId}-${period}`
    nodes.push({
      id,
      typ: 'leverantörsutfall-månad',
      label: `Leverantörsutfall ${period}`,
      data: {
        år: Number(yearStr),
        månad: Number(monthStr),
        totalTkr: Math.round(total.sumKr / 1000),
        fakturaAntal: total.count,
        topLeverantörer,
      },
    })
    edges.push({ from: id, to: nämndId, typ: 'avser' })
    monthNodeCount++
  }

  mkdirSync(join(DATA_DIR, 'graf'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify({ nodes, edges }, null, 2))
  console.log(
    `\n✅ ${OUTPUT_PATH} (${nodes.length - monthNodeCount} nämnd/år-noder, ${monthNodeCount} nämnd/månad-noder)`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { normalizeFörvaltning }
