/**
 * Parser: Delårsrapport per nämnd — Docling-pilot
 *
 * Docling-baserad parsning av nämnders delårsrapporter (kvartalsvis ekonomisk
 * uppföljning). Komplement till `pdftotext + regex` för dokument med tabeller
 * regex inte klarar — wrapped headers, nästlade tjänstekategorier, subtotalrader.
 * Se docs/ANALYS-2026-07.md §2.
 *
 * Pilot-dokument: Nämnden för Intraservice, delårsrapport mars 2026.
 *
 * Användning:
 *   npx tsx packages/pipeline/src/parsers/parse-delarsrapport.ts <pdf> <nämndId> <period>
 * Exempel:
 *   npx tsx packages/pipeline/src/parsers/parse-delarsrapport.ts \
 *     data/inbox/intraservice_delarsrapport_mars_2026.pdf nämnd-nämnden-för-intraservice 2026-mars
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DoclingTable, extractWithDocling } from '../lib/docling'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')

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

// Docling korrekt separerar kolumner och celler i den här tabellen, men
// felmärker "Period"/"Helår"-grupperingen i den sammanslagna header-raden
// (verifierat mot `pdftotext -layout`-dumpen av samma tabell — cellvärdena
// ligger rätt, bara den översta grupperingsraden är fel). Kolumnordningen är
// därför hårdkodad från den kända mallen, med en avstämningskontroll
// (se `beräknatResultat` nedan) som säkerhetsnät om ordningen skulle ändras.
const RESULTAT_COLUMNS = [
  'utfallPeriod',
  'budgetPeriod',
  'avvikelsePeriod',
  'utfallFgAr',
  'prognosHelar',
  'fgPrognosHelar',
  'budgetHelar',
  'bokslutFgAr',
] as const

type ResultatKolumn = (typeof RESULTAT_COLUMNS)[number]

interface Post {
  namn: string
  values: Record<ResultatKolumn, number>
}

interface Tjanst {
  tjänst: string
  kategori: string | null
  ärSumma: boolean
  utfallIntakterPeriod: number
  utfallKostnaderPeriod: number
  resultatPeriod: number
  budgetKostnaderPeriod: number
  budgetavvikelse: number
}

interface Rad {
  namn: string
  kategori: string | null
  ärSumma: boolean
  värden: number[]
}

function parseSvNumber(s: string | undefined): number {
  if (!s) return 0
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  const n = Number.parseFloat(cleaned)
  return Number.isNaN(n) ? 0 : n
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zåäö0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function findResultatTable(tables: DoclingTable[]): DoclingTable | undefined {
  return tables.find((t) => {
    const flat = t.rows.flat().join(' ')
    return flat.includes('Kommunbidrag') && flat.includes('Resultat') && flat.includes('Intäkter')
  })
}

export function findTjänsteTable(tables: DoclingTable[]): DoclingTable | undefined {
  return tables.find((t) => {
    const header = t.rows[0]?.join(' ') ?? ''
    return header.includes('Tjänster') && header.includes('Resultat period')
  })
}

// "Resultatuppföljning och förändringsinsatser helår" — samma tjänstestruktur som
// period-tabellen, men prognosticerade helårsbelopp. Används bara för avstämning
// (se validateTjänsteTotalt), inte för att bygga grafnoder i denna pilot.
export function findHelårTjänsteTable(tables: DoclingTable[]): DoclingTable | undefined {
  return tables.find((t) => {
    const header = t.rows[0]?.join(' ') ?? ''
    return header.includes('Tjänster') && header.includes('helår')
  })
}

export function parseResultatTable(table: DoclingTable): Post[] {
  return table.rows.slice(1).map((row) => {
    const [namn, ...cells] = row
    const values = Object.fromEntries(
      RESULTAT_COLUMNS.map((col, i) => [col, parseSvNumber(cells[i])]),
    ) as Record<ResultatKolumn, number>
    return { namn: namn.trim(), values }
  })
}

// Generisk radparsning för tjänstetabeller (period *och* helår har samma struktur:
// kategori-header utan värden, "- Underkategori"-barn, platta tjänsterader,
// "Total …"-delsummor). Kolumnernas betydelse skiljer sig mellan tabellerna, så
// namngivna fält (Tjanst) läggs på ovanpå i parseTjänsteTable — den här funktionen
// håller värdena kolumn-neutrala för att kunna återanvändas i avstämningen.
export function parseTjänsteRader(table: DoclingTable): Rad[] {
  const results: Rad[] = []
  let kategori: string | null = null

  for (const row of table.rows.slice(1)) {
    const [namnRaw, ...celler] = row
    const namn = namnRaw.trim()
    const isEmpty = celler.every((c) => !c?.trim())

    if (isEmpty) {
      kategori = namn
      continue
    }

    const isChild = namn.startsWith('-')
    results.push({
      namn: isChild ? namn.replace(/^-\s*/, '') : namn,
      kategori: isChild ? kategori : null,
      ärSumma: /^total/i.test(namn),
      värden: celler.map(parseSvNumber),
    })

    if (!isChild) kategori = null
  }

  return results
}

export function parseTjänsteTable(table: DoclingTable): Tjanst[] {
  return parseTjänsteRader(table).map((r) => ({
    tjänst: r.namn,
    kategori: r.kategori,
    ärSumma: r.ärSumma,
    utfallIntakterPeriod: r.värden[0] ?? 0,
    utfallKostnaderPeriod: r.värden[1] ?? 0,
    resultatPeriod: r.värden[2] ?? 0,
    budgetKostnaderPeriod: r.värden[3] ?? 0,
    budgetavvikelse: r.värden[4] ?? 0,
  }))
}

// Kontrollerar att "Totalt"-raden stämmer med summan av raderna mellan senaste
// delsumma och Totalt (undviker dubbelräkning av rader som redan ingår i en
// tidigare "Total …"-delsumma). Fångar upp fel i själva källdokumentet — t.ex.
// en felvänd siffra i Totalt-raden, som annars sprids tyst vidare i grafen.
// Se docs/ANALYS-2026-07.md §2 för ett verkligt exempel (Intraservice mars 2026).
export function validateTjänsteTotalt(rader: Rad[], tabellNamn: string): void {
  const totaltIndex = rader.findIndex((r) => r.namn === 'Totalt')
  if (totaltIndex === -1) return

  let startIndex = 0
  for (let i = totaltIndex - 1; i >= 0; i--) {
    if (rader[i].ärSumma) {
      startIndex = i
      break
    }
  }

  const antalKolumner = rader[totaltIndex].värden.length
  for (let kol = 0; kol < antalKolumner; kol++) {
    const beräknat = rader
      .slice(startIndex, totaltIndex)
      .reduce((sum, r) => sum + (r.värden[kol] ?? 0), 0)
    const rapporterat = rader[totaltIndex].värden[kol] ?? 0
    if (Math.abs(beräknat - rapporterat) > 0.2) {
      console.warn(
        `   ⚠️  "${tabellNamn}": Totalt, kolumn ${kol + 1} stämmer inte — beräknat ${beräknat.toFixed(1)} vs rapporterat ${rapporterat.toFixed(1)}. Möjligt fel i källdokumentets tabell.`,
      )
    }
  }
}

function buildGraph(
  poster: Post[],
  tjänster: Tjanst[],
  nämndId: string,
  period: string,
  nämndLabel: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const byNamn = Object.fromEntries(poster.map((p) => [p.namn, p]))
  const resultat = byNamn.Resultat
  if (!resultat) throw new Error('Hittade ingen "Resultat"-rad i resultaträkningen')

  const budgetMnkr = resultat.values.budgetPeriod
  const utfallMnkr = resultat.values.utfallPeriod
  const avvikelseMnkr = resultat.values.avvikelsePeriod
  const avvikelseProcent =
    budgetMnkr !== 0 ? Math.round((avvikelseMnkr / Math.abs(budgetMnkr)) * 1000) / 10 : 0

  const summaryId = `delarsrapport-${nämndId}-${period}`
  nodes.push({
    id: summaryId,
    typ: 'utfall',
    label: `${nämndLabel} — delårsrapport ${period}: ${avvikelseMnkr >= 0 ? '+' : ''}${avvikelseMnkr} mnkr`,
    data: {
      nämnd: nämndLabel,
      period,
      budgetMnkr,
      utfallMnkr,
      avvikelseMnkr,
      avvikelseProcent,
      status:
        avvikelseMnkr < -10 ? 'stort_underskott' : avvikelseMnkr < 0 ? 'underskott' : 'i_balans',
      poster: Object.fromEntries(poster.map((p) => [p.namn, p.values])),
      källa: 'docling',
    },
  })
  edges.push({
    from: summaryId,
    to: nämndId,
    typ: 'utfall_för',
    label: `${avvikelseMnkr >= 0 ? '+' : ''}${avvikelseMnkr} mnkr`,
  })

  for (const t of tjänster) {
    const id = `delarsrapport-tjanst-${nämndId}-${slugify(t.tjänst)}-${period}`
    nodes.push({
      id,
      typ: 'tjänst',
      label: `${t.tjänst}: ${t.resultatPeriod >= 0 ? '+' : ''}${t.resultatPeriod} mnkr`,
      data: { ...t, period },
    })
    edges.push({ from: id, to: summaryId, typ: 'ingår_i' })
  }

  return { nodes, edges }
}

async function main() {
  const [pdfPath, nämndId, period] = process.argv.slice(2)
  if (!pdfPath || !nämndId || !period) {
    console.log('Användning: npx tsx parse-delarsrapport.ts <pdf> <nämndId> <period>')
    console.log(
      'Exempel: npx tsx parse-delarsrapport.ts data/inbox/intraservice_delarsrapport_mars_2026.pdf nämnd-nämnden-för-intraservice 2026-mars',
    )
    process.exit(1)
  }

  console.log(`📊 Docling-parsning av delårsrapport (${period})...\n`)
  const { tables } = extractWithDocling(pdfPath)
  console.log(`   ${tables.length} tabeller extraherade`)

  const resultatTable = findResultatTable(tables)
  if (!resultatTable) {
    console.error(
      '   ✗ Hittade ingen resultaträkningstabell (Intäkter/Kostnader/Kommunbidrag/Resultat)',
    )
    process.exit(1)
  }
  const poster = parseResultatTable(resultatTable)

  const tjänsteTable = findTjänsteTable(tables)
  const tjänster = tjänsteTable ? parseTjänsteTable(tjänsteTable) : []
  console.log(`   ${poster.length} rader i resultaträkning, ${tjänster.length} tjänster`)

  if (tjänsteTable) {
    validateTjänsteTotalt(parseTjänsteRader(tjänsteTable), 'Resultatuppföljning tjänster period')
  }
  const helårTjänsteTable = findHelårTjänsteTable(tables)
  if (helårTjänsteTable) {
    validateTjänsteTotalt(
      parseTjänsteRader(helårTjänsteTable),
      'Resultatuppföljning tjänster helår',
    )
  }

  // Avstämning: Resultat ska vara summan av övriga poster (± avrundning).
  // Fångar upp om kolumnmappningen (se RESULTAT_COLUMNS ovan) någonsin blir fel.
  const byNamn = Object.fromEntries(poster.map((p) => [p.namn, p]))
  const beräknatResultat = ['Intäkter', 'Kostnader', 'Kommunbidrag', 'Kommuninterna bidrag'].reduce(
    (sum, namn) => sum + (byNamn[namn]?.values.utfallPeriod ?? 0),
    0,
  )
  const rapporteratResultat = byNamn.Resultat?.values.utfallPeriod ?? 0
  if (Math.abs(beräknatResultat - rapporteratResultat) > 0.2) {
    console.warn(
      `   ⚠️  Resultat stämmer inte: beräknat ${beräknatResultat.toFixed(1)} vs rapporterat ${rapporteratResultat.toFixed(1)} — kontrollera kolumnmappningen`,
    )
  }

  const GEMENE_ORD = new Set(['för', 'och', 'i', 'på', 'av'])
  const nämndLabel = nämndId
    .replace(/^nämnd-/, '')
    .split('-')
    .map((w, i) => (i > 0 && GEMENE_ORD.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')

  const graph = buildGraph(poster, tjänster, nämndId, period, nämndLabel)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, `delarsrapport-${nämndId}-${period}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
