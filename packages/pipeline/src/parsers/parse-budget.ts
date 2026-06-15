/**
 * Budget Graph — структурирует бюджет Göteborg как knowledge graph
 *
 * Узлы: бюджетные посты (nämnder, tjänsteområden, leverantörer)
 * Рёбра: finansierar, köper_av, ingår_i
 *
 * Данные из: budget 2026 (S+V+MP), Intraservice årsrapport 2025
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')

interface GraphNode {
  id: string
  typ: 'budget' | 'nämnd' | 'tjänsteområde' | 'leverantör' | 'post'
  label: string
  data: Record<string, unknown>
}

interface GraphEdge {
  from: string
  to: string
  typ: 'finansierar' | 'köper_av' | 'ingår_i' | 'levererar_till'
  label?: string
  data?: Record<string, unknown>
}

// --- Budget data 2026 (from budget_graf.md) ---

const TOTAL = 43_292 // mnkr

const NÄMNDER: Array<{ id: string; namn: string; belopp: number; andel: number }> = [
  { id: 'grundskola', namn: 'Grundskolenämnden', belopp: 10_547, andel: 24.4 },
  { id: 'aldre-vard', namn: 'Äldre + vård/omsorg', belopp: 7_219, andel: 16.7 },
  { id: 'funktionsstod', namn: 'Nämnden för funktionsstöd', belopp: 5_977, andel: 13.8 },
  { id: 'forskola', namn: 'Förskolenämnden', belopp: 5_361, andel: 12.4 },
  { id: 'utbildning', namn: 'Utbildningsnämnden', belopp: 2_928, andel: 6.8 },
  { id: 'stadsmiljo', namn: 'Stadsmiljönämnden', belopp: 1_733, andel: 4.0 },
  { id: 'social-nordost', namn: 'Socialnämnden Nordost', belopp: 1_931, andel: 4.5 },
  { id: 'social-centrum', namn: 'Socialnämnden Centrum', belopp: 1_470, andel: 3.4 },
  { id: 'social-hisingen', namn: 'Socialnämnden Hisingen', belopp: 1_367, andel: 3.2 },
  { id: 'social-sydvast', namn: 'Socialnämnden Sydväst', belopp: 899, andel: 2.1 },
  { id: 'arbetsmarknad', namn: 'Nämnden för arbetsmarknad och vuxenutbildning', belopp: 847, andel: 2.0 },
  { id: 'kultur', namn: 'Kulturnämnden', belopp: 772, andel: 1.8 },
  { id: 'miljo-klimat', namn: 'Miljö- och klimatnämnden', belopp: 644, andel: 1.5 },
  { id: 'idrott', namn: 'Idrotts- och föreningsnämnden', belopp: 417, andel: 1.0 },
  { id: 'stadsbyggnad', namn: 'Stadsbyggnadsnämnden', belopp: 283, andel: 0.7 },
  { id: 'demokrati', namn: 'Nämnden för demokrati och medborgarservice', belopp: 155, andel: 0.4 },
  { id: 'kommunledning', namn: 'Kommunledningen', belopp: 145, andel: 0.3 },
  { id: 'intraservice', namn: 'Nämnden för Intraservice', belopp: 142, andel: 0.3 },
  { id: 'valnamnden', namn: 'Valnämnden', belopp: 36, andel: 0.1 },
  { id: 'inkop', namn: 'Inköps- och upphandlingsnämnden', belopp: 10, andel: 0.0 },
]

// Intraservice actual cost breakdown
const INTRASERVICE_KOSTNADER: Array<{ id: string; namn: string; belopp: number; andel: number }> = [
  { id: 'it-personal', namn: 'Personal (734 årsarbetare)', belopp: 552, andel: 37 },
  { id: 'it-licenser', namn: 'IT-program/licenser', belopp: 439, andel: 29 },
  { id: 'it-leasing', namn: 'Leasing IT-utrustning (77 000 enheter)', belopp: 239, andel: 16 },
  { id: 'it-ovriga', namn: 'Övriga kostnader', belopp: 146, andel: 10 },
  { id: 'it-konsulter', namn: 'Konsulter', belopp: 111, andel: 7 },
]

// Known suppliers
const LEVERANTÖRER: Array<{ id: string; namn: string; belopp: number; tjänst: string; avtalUtgår?: string }> = [
  { id: 'cgi', namn: 'CGI Sverige AB', belopp: 7.5, tjänst: 'BankID/Legitimering', avtalUtgår: '2026-12-31' },
  { id: 'cloud-networks', namn: 'The Cloud Networks', belopp: 2.5, tjänst: 'Publikt WiFi', avtalUtgår: '2027-04-30' },
  { id: 'dataklimat', namn: 'Dataklimat i Sverige', belopp: 2.4, tjänst: 'Serviceavtal datahall' },
  { id: 'telia', namn: 'Telia Sverige', belopp: 1.8, tjänst: 'Internetförbindelse', avtalUtgår: '2027-07-06' },
  { id: 'telia-cygate', namn: 'Telia Cygate', belopp: 1.7, tjänst: 'SSL-certifikat', avtalUtgår: '2027-05-31' },
  { id: 'tele2', namn: 'Tele2 Sverige', belopp: 1.0, tjänst: 'Internetförbindelse', avtalUtgår: '2027-07-06' },
  { id: 'excedo', namn: 'Excedo Networks', belopp: 0.7, tjänst: 'Domännamn', avtalUtgår: '2027-10-14' },
  { id: 'firesafe', namn: 'Firesafe Sverige', belopp: 0.7, tjänst: 'Brandlarm datahall' },
  { id: 'microsoft', namn: 'Microsoft', belopp: 200, tjänst: 'M365, Windows, Azure (uppskattning)' },
]

function buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Root node
  nodes.push({
    id: 'budget-2026',
    typ: 'budget',
    label: 'Göteborgs Stad Kommunbudget 2026',
    data: { år: 2026, totalMnkr: TOTAL, styre: 'S+V+MP' },
  })

  // Nämnd nodes + edges
  for (const n of NÄMNDER) {
    nodes.push({
      id: `nämnd-${n.id}`,
      typ: 'nämnd',
      label: n.namn,
      data: { kommunbidragMnkr: n.belopp, andelProcent: n.andel },
    })
    edges.push({
      from: 'budget-2026',
      to: `nämnd-${n.id}`,
      typ: 'finansierar',
      data: { mnkr: n.belopp, andel: n.andel },
    })
  }

  // Intraservice real costs (1493 mnkr total, not just 142)
  nodes.push({
    id: 'it-verklig-kostnad',
    typ: 'tjänsteområde',
    label: 'IT verklig kostnad (Intraservice total)',
    data: { totalMnkr: 1_493, kommunbidragMnkr: 142, internfaktureringMnkr: 1_351, perInvånareKr: 2_489 },
  })
  edges.push({ from: 'nämnd-intraservice', to: 'it-verklig-kostnad', typ: 'ingår_i' })

  // IT cost breakdown
  for (const k of INTRASERVICE_KOSTNADER) {
    nodes.push({
      id: `it-${k.id}`,
      typ: 'post',
      label: k.namn,
      data: { mnkr: k.belopp, andelProcent: k.andel },
    })
    edges.push({ from: 'it-verklig-kostnad', to: `it-${k.id}`, typ: 'finansierar', data: { mnkr: k.belopp } })
  }

  // Suppliers
  for (const l of LEVERANTÖRER) {
    nodes.push({
      id: `leverantör-${l.id}`,
      typ: 'leverantör',
      label: l.namn,
      data: { mnkr: l.belopp, tjänst: l.tjänst, avtalUtgår: l.avtalUtgår },
    })
    edges.push({
      from: 'nämnd-intraservice',
      to: `leverantör-${l.id}`,
      typ: 'köper_av',
      data: { mnkr: l.belopp, tjänst: l.tjänst },
    })
  }

  return { nodes, edges }
}

function main() {
  console.log('💰 Bygger budgetgraf 2026...\n')

  const graph = buildGraph()

  console.log(`   Nodes: ${graph.nodes.length}`)
  console.log(`   Edges: ${graph.edges.length}`)
  console.log(`   Nämnder: ${NÄMNDER.length}`)
  console.log(`   Leverantörer: ${LEVERANTÖRER.length}`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, 'budget-2026.json')
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

main()
