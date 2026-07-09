/**
 * Kolada (api.kolada.se/v3) — Göteborgs egna trender över tid, parat mot
 * motsvarande nämnds kommunbidrag där en rimlig koppling finns. Syftet är
 * att synliggöra frågor typ "skolans budget ökar men resultaten sjunker" —
 * INTE att jämföra Göteborg mot andra kommuner (borttaget efter feedback:
 * det är inte vad det här ska visa).
 *
 * Kolada publicerar dessa nyckeltal årsvis, inte månadsvis — det finns ingen
 * "budget vs utfall per månad"-vy att bygga här, bara år-för-år-trend.
 *
 * Kommunbidrag hämtas ur redan befintliga data/graf/budget-ÅR.json
 * (2022–2026) — Kolada-nyckeltalen går längre tillbaka (2020–) men
 * kommunbudgeten finns bara från 2022 i det här projektets data, så
 * budget-serien är kortare än utfalls-serien för samma nyckeltal.
 *
 * Användning: npx tsx packages/pipeline/src/scrapers/kolada.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const OUTPUT_PATH = join(DATA_DIR, 'kolada/kpi-trender.json')

const API_BASE = 'https://api.kolada.se/v3'
const GÖTEBORG = '1480'
const ÅR_FRÅN = 2020
const ÅR_TILL = 2025
const BUDGET_ÅR = [2022, 2023, 2024, 2025, 2026]

interface KpiDef {
  id: string
  namn: string
  kategori: string
  enhet: string
  // Kopplad nämnd i data/graf/budget-ÅR.json (nämnd-<slug>) — bara satt när
  // en tydlig, direkt koppling finns (skola→grundskolenämnden, inte
  // t.ex. arbetslöshet som är makroekonomiskt och inte styrs av en nämnds
  // budget på samma sätt).
  nämndId?: string
  nämndNamn?: string
}

const KPIER: KpiDef[] = [
  {
    id: 'N15504',
    namn: 'Meritvärde åk 9 (genomsnitt, 17 ämnen)',
    kategori: 'Skola',
    enhet: 'poäng',
    nämndId: 'nämnd-grundskolenämnden',
    nämndNamn: 'Grundskolenämnden',
  },
  {
    id: 'N00531',
    namn: 'Medborgarundersökning: grundskolan fungerar bra',
    kategori: 'Skola',
    enhet: '%',
    nämndId: 'nämnd-grundskolenämnden',
    nämndNamn: 'Grundskolenämnden',
  },
  {
    id: 'U23463',
    namn: 'Brukarbedömning särskilt boende: alltid bra bemötande',
    kategori: 'Äldreomsorg',
    enhet: '%',
    nämndId: 'nämnd-äldre-samt-vård-och-omsorgsnämnden',
    nämndNamn: 'Äldre samt vård- och omsorgsnämnden',
  },
  {
    id: 'N00401',
    namn: 'Utsläpp växthusgaser per invånare',
    kategori: 'Miljö',
    enhet: 'ton CO2-ekv/inv',
    nämndId: 'nämnd-miljö-och-klimatnämnden',
    nämndNamn: 'Miljö- och klimatnämnden',
  },
  {
    id: 'N01720',
    namn: 'Arbetslösa eller i åtgärd, 16–64 år',
    kategori: 'Arbetsmarknad',
    enhet: '%',
    nämndId: 'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
    nämndNamn: 'Nämnden för arbetsmarknad och vuxenutbildning',
  },
  // Ingen nämnd-koppling: skattesats sätts av KF för hela kommunen (inte en
  // enskild nämnds budget), sjukfrånvaro är en kommunövergripande
  // personalsiffra — båda visas som ren Göteborgs-trend utan budgetserie.
  { id: 'N00901', namn: 'Skattesats till kommun', kategori: 'Ekonomi', enhet: '%' },
  { id: 'N00090', namn: 'Sjukfrånvaro bland anställda', kategori: 'Personal', enhet: '%' },
]

interface DataPoint {
  år: number
  värde: number | null
}

async function fetchKpiData(kpiId: string): Promise<DataPoint[]> {
  const years = Array.from({ length: ÅR_TILL - ÅR_FRÅN + 1 }, (_, i) => ÅR_FRÅN + i)
  const url = `${API_BASE}/data/kpi/${kpiId}/municipality/${GÖTEBORG}/year/${years.join(',')}`
  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`   ⚠️  ${kpiId}: HTTP ${res.status}`)
    return []
  }
  const data = (await res.json()) as {
    values: Array<{ period: number; values: Array<{ gender: string; value: number | null }> }>
  }
  return data.values
    .map((row) => {
      const total = row.values.find((v) => v.gender === 'T')
      return { år: row.period, värde: total?.value ?? null }
    })
    .sort((a, b) => a.år - b.år)
}

function loadKommunbidrag(nämndId: string): DataPoint[] {
  const points: DataPoint[] = []
  for (const år of BUDGET_ÅR) {
    const path = join(DATA_DIR, `graf/budget-${år}.json`)
    if (!existsSync(path)) continue
    const budget = JSON.parse(readFileSync(path, 'utf-8'))
    const node = budget.nodes.find((n: any) => n.id === `${nämndId}-${år}`)
    if (node?.data?.kommunbidragMnkr != null) {
      points.push({ år, värde: node.data.kommunbidragMnkr })
    }
  }
  return points
}

// Procentuell förändring första → sista datapunkt med icke-null värde — den
// enkla "gick upp eller ner, och hur mycket"-siffran som gör det möjligt att
// direkt jämföra två serier (budget kr vs. betygspoäng, olika enheter) utan
// att behöva en delad y-axel.
function förändring(serie: DataPoint[]): { från: number; till: number; procent: number } | null {
  const med = serie.filter((p) => p.värde !== null)
  if (med.length < 2) return null
  const första = med[0].värde as number
  const sista = med[med.length - 1].värde as number
  if (första === 0) return null
  return { från: första, till: sista, procent: Math.round(((sista - första) / första) * 1000) / 10 }
}

async function main() {
  console.log('📊 Kolada — Göteborgs trender, parat mot nämndbudget\n')

  const kpis = []
  for (const kpi of KPIER) {
    const göteborg = await fetchKpiData(kpi.id)
    const budget = kpi.nämndId ? loadKommunbidrag(kpi.nämndId) : []
    const utfallÄndring = förändring(göteborg)
    const budgetÄndring = förändring(budget)
    console.log(
      `   ✓ ${kpi.id} ${kpi.namn}${
        utfallÄndring
          ? ` — utfall ${utfallÄndring.procent >= 0 ? '+' : ''}${utfallÄndring.procent}%`
          : ' — ingen data'
      }${
        budgetÄndring
          ? `, kommunbidrag ${budgetÄndring.procent >= 0 ? '+' : ''}${budgetÄndring.procent}%`
          : ''
      }`,
    )
    kpis.push({
      ...kpi,
      göteborg,
      utfallÄndring,
      budget: kpi.nämndId ? budget : undefined,
      budgetÄndring: kpi.nämndId ? budgetÄndring : undefined,
    })
  }

  mkdirSync(join(DATA_DIR, 'kolada'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify({ kpis }, null, 2))
  console.log(`\n✅ ${OUTPUT_PATH} (${kpis.length} nyckeltal)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { KPIER, fetchKpiData, loadKommunbidrag, förändring }
