/**
 * PDF Protocol Parser — извлекает структурированные данные из KF-протоколов
 *
 * Из каждого протокола извлекаем:
 * - Paragrafer (§) с ärendenummer, rubrik, beslut
 * - Ссылки на законы (kommunallagen, etc.)
 * - Ссылки на другие §§ (bordlagt, uppdrag)
 * - Ссылки на organisationer (nämnder, bolag)
 * - Voteringar (om det finns)
 *
 * Результат — граф узлов и рёбер (nodes + edges)
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

// --- Graph types ---

export interface GraphNode {
  id: string
  typ: 'paragraf' | 'lag' | 'organisation' | 'politiker' | 'möte' | 'dokument'
  label: string
  data: Record<string, unknown>
}

export interface GraphEdge {
  from: string
  to: string
  typ: 'beslut_av' | 'hänvisar_till' | 'bordlagd_från' | 'uppdrag_till' | 'regleras_av' | 'inlämnad_av' | 'votering'
  label?: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- Regex patterns ---

const PARAGRAF_RE = /§\s*(\d+)\s*Ärendenummer\s*(SLK-\d{4}-\d+(?::\d+)?)/g
const LAG_REF_RE = /(\d+)\s*kap\.?\s*(\d+)\s*§\s*([\wäöåÅÄÖ-]+lagen|miljöbalken|[\wäöåÅÄÖ-]+förordningen)(?:\s*\((\d{4}:\d+)\))?/gi
const SFS_RE = /\((\d{4}:\d+)\)/g
const NÄMND_RE = /((?:socialnämnden|grundskolenämnden|exploateringsnämnden|kulturnämnden|stadsmiljönämnden|idrotts- och föreningsnämnden|inköps- och upphandlingsnämnden|kommunstyrelsen|stadsfastighetsnämnden|kretslopp och vattennämnden|miljö- och klimatnämnden|förskolenämnden|utbildningsnämnden|stadsbyggnadsnämnden)(?:\s+\w+)?)/gi
const BORDLAGD_RE = /[Bb]ordlag[dt]\s+(?:den\s+)?\d+\s+\w+\s+\d{4},?\s*§\s*(\d+)/g
const UPPDRAG_RE = /(?:får i uppdrag|uppdrag\s+\d{4}-\d{2}-\d{2}\s*§\s*(\d+))/gi

function pdfToText(pdfPath: string): string {
  return execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

function parseParagrafer(text: string, möteDatum: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Split text into paragraphs
  const sections = text.split(/(?=§\s*\d+\s*Ärendenummer)/)

  for (const section of sections) {
    const headerMatch = section.match(/§\s*(\d+)\s*Ärendenummer\s*(SLK-\d{4}-\d+(?::\d+)?)/)
    if (!headerMatch) continue

    const paragrafNr = headerMatch[1]
    const ärendeNr = headerMatch[2]
    const paragrafId = `kf-${möteDatum}-§${paragrafNr}`

    // Extract rubrik (first line after ärendenummer)
    const lines = section.split('\n').filter(l => l.trim())
    const rubrik = lines[1]?.trim() || ''

    // Detect beslut type
    let beslut: string | undefined
    if (section.match(/har bifallits|bifall till kommunstyrelsens/i)) beslut = 'bifall'
    else if (section.match(/avslag|avslagits/i)) beslut = 'avslag'
    else if (section.match(/bordlägg/i)) beslut = 'bordläggning'
    else if (section.match(/återremiss/i)) beslut = 'återremiss'

    // Extract votering results from main text
    const voteMatch = section.match(/(\d+)\s*Ja\s*mot\s*(\d+)\s*Nej/)
    const votering = voteMatch ? { ja: parseInt(voteMatch[1]), nej: parseInt(voteMatch[2]) } : undefined

    // Extract reservationer
    const reservationer: string[] = []
    const resMatch = section.match(/Reservation\s*\n\s*\n\s*(.+?)(?:\n\s*\n|\nProtokollsutdrag)/s)
    if (resMatch) reservationer.push(resMatch[1].trim())

    // Extract yrkanden
    const yrkanden: Array<{ namn: string; parti: string; typ: string }> = []
    const yrkRe = /([\wÅÄÖåäö\s-]+?)\s*\((\w+)\)\s*(?:yrkar bifall till|yrkar)\s*(.{10,80})/g
    let yrkMatch
    while ((yrkMatch = yrkRe.exec(section)) !== null) {
      yrkanden.push({ namn: yrkMatch[1].trim(), parti: yrkMatch[2], typ: yrkMatch[3].trim() })
    }

    // Create paragraf node
    nodes.push({
      id: paragrafId,
      typ: 'paragraf',
      label: `§ ${paragrafNr} ${rubrik}`,
      data: { paragrafNr, ärendeNr, rubrik, datum: möteDatum, beslut, votering, yrkanden, reservationer },
    })

    // Find law references
    let match: RegExpExecArray | null
    const lagRe = new RegExp(LAG_REF_RE.source, 'gi')
    while ((match = lagRe.exec(section)) !== null) {
      const [, kap, paragraf, lagNamn, sfs] = match
      const lagId = sfs ? `sfs-${sfs}` : `lag-${lagNamn.toLowerCase()}`
      const lagLabel = sfs ? `${lagNamn} (${sfs})` : lagNamn

      if (!nodes.find(n => n.id === lagId)) {
        nodes.push({ id: lagId, typ: 'lag', label: lagLabel, data: { sfs, kap, paragraf } })
      }
      edges.push({ from: paragrafId, to: lagId, typ: 'regleras_av', label: `${kap} kap. ${paragraf} §` })
    }

    // Find references to other paragraphs (bordlagd)
    const bordRe = new RegExp(BORDLAGD_RE.source, 'g')
    while ((match = bordRe.exec(section)) !== null) {
      const refParagraf = match[1]
      edges.push({ from: paragrafId, to: `kf-*-§${refParagraf}`, typ: 'bordlagd_från', label: `Bordlagd från § ${refParagraf}` })
    }

    // Find nämnd references (uppdrag)
    const nämndRe = new RegExp(NÄMND_RE.source, 'gi')
    while ((match = nämndRe.exec(section)) !== null) {
      const nämndNamn = match[1].trim()
      const nämndId = `org-${nämndNamn.toLowerCase().replace(/\s+/g, '-')}`

      if (!nodes.find(n => n.id === nämndId)) {
        nodes.push({ id: nämndId, typ: 'organisation', label: nämndNamn, data: {} })
      }

      if (section.toLowerCase().includes('får i uppdrag')) {
        edges.push({ from: paragrafId, to: nämndId, typ: 'uppdrag_till' })
      } else {
        edges.push({ from: paragrafId, to: nämndId, typ: 'hänvisar_till' })
      }
    }
  }

  return { nodes, edges }
}

// Parse voting bilagor (appendices with individual votes)
function parseVoteringar(text: string, möteDatum: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Split on "Bilaga N" headers
  const bilagor = text.split(/(?=Bilaga \d+\n)/)

  for (const bilaga of bilagor) {
    // More flexible matching for header
    const ärendeMatch = bilaga.match(/Ärende:\s*(\d+)/)
    const meningMatch = bilaga.match(/Ärendemening:\s*(.+?)(?=\nAntal)/s)
    const jaMatch = bilaga.match(/Antal Ja:\s*(\d+)/)
    const nejMatch = bilaga.match(/Antal Nej:\s*(\d+)/)
    const avståMatch = bilaga.match(/Antal Avstår:\s*(\d+)/)
    const frånvMatch = bilaga.match(/Antal Frånv:\s*(\d+)/)

    if (!ärendeMatch || !jaMatch) continue

    const ärendeNr = ärendeMatch[1]
    const ärendemening = meningMatch ? meningMatch[1].replace(/\n/g, ' ').trim() : `Ärende ${ärendeNr}`
    const ja = parseInt(jaMatch[1])
    const nej = parseInt(nejMatch?.[1] || '0')
    const avstår = parseInt(avståMatch?.[1] || '0')
    const frånv = parseInt(frånvMatch?.[1] || '0')

    // Find matching § for this ärende
    const paragrafId = `votering-${möteDatum}-ärende-${ärendeNr}`

    // Parse individual votes
    const voteSection = bilaga.slice(bilaga.indexOf('Resultat') + 8)
    const lines = voteSection.split('\n').map(l => l.trim()).filter(Boolean)

    const röster: Array<{ namn: string; parti: string; röst: string }> = []

    for (let i = 0; i < lines.length - 4; i++) {
      const namn = lines[i]
      const parti = lines[i + 1]
      const plats = lines[i + 2]
      const funktion = lines[i + 3]
      const resultat = lines[i + 4]

      if (parti?.match(/^(S|M|V|SD|L|MP|D|KD|C)$/) && resultat?.match(/^(Ja|Nej|Avstår|Frånvarande)$/)) {
        röster.push({ namn, parti, röst: resultat.toLowerCase() })
        i += 4
      }
    }

    if (röster.length > 0) {
      nodes.push({
        id: paragrafId,
        typ: 'paragraf',
        label: ärendemening,
        data: {
          ärendeNr,
          datum: möteDatum,
          votering: { ja, nej, avstår, frånvarande: frånv },
          röster,
        },
      })
    }
  }

  return { nodes, edges }
}

async function main() {
  const pdfUrl = process.argv[2]
  const datum = process.argv[3] || '2025-01-01'

  if (!pdfUrl) {
    console.error('Usage: tsx parse-protokoll.ts <pdf-url-or-path> <datum>')
    console.error('  tsx parse-protokoll.ts https://...pdf 2025-11-27')
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Download or use local file
  let pdfPath: string
  if (pdfUrl.startsWith('http')) {
    pdfPath = join(TMP_DIR, `protokoll-${datum}.pdf`)
    if (!existsSync(pdfPath)) {
      console.log(`⬇️  Laddar ner: ${pdfUrl.slice(0, 60)}...`)
      execSync(`curl -sL "${pdfUrl}" -o "${pdfPath}"`)
    }
  } else {
    pdfPath = pdfUrl
  }

  console.log(`📄 Parsear protokoll ${datum}...`)
  const text = pdfToText(pdfPath)
  console.log(`   ${text.split('\n').length} rader text`)

  const { nodes, edges } = parseParagrafer(text, datum)

  // Parse voteringar from bilagor
  const voteringar = parseVoteringar(text, datum)
  const totalRöster = voteringar.nodes.reduce((sum, n) => sum + ((n.data.röster as any[])?.length || 0), 0)

  // Merge votering data into paragraf nodes where possible
  for (const vNode of voteringar.nodes) {
    const ärendemening = (vNode.label || '').toLowerCase()
    const existing = nodes.find(n => n.typ === 'paragraf' && n.label.toLowerCase().includes(ärendemening.slice(0, 20)))
    if (existing) {
      existing.data.röster = vNode.data.röster
      existing.data.votering = vNode.data.votering
    } else {
      nodes.push(vNode)
    }
  }

  // Add meeting node
  const möteId = `möte-kf-${datum}`
  nodes.unshift({ id: möteId, typ: 'möte', label: `KF Sammanträde ${datum}`, data: { datum, organisation: 'Kommunfullmäktige' } })

  // Connect all paragrafer to the meeting
  for (const node of nodes) {
    if (node.typ === 'paragraf') {
      edges.push({ from: möteId, to: node.id, typ: 'beslut_av' })
    }
  }

  const graph: KnowledgeGraph = { nodes, edges }

  console.log(`\n   Nodes: ${nodes.length} (${nodes.filter(n => n.typ === 'paragraf').length} §, ${nodes.filter(n => n.typ === 'lag').length} lagar, ${nodes.filter(n => n.typ === 'organisation').length} org)`)
  console.log(`   Edges: ${edges.length}`)
  console.log(`   Voteringar: ${voteringar.nodes.length} (${totalRöster} individuella röster)`)

  const outPath = join(OUTPUT_DIR, `kf-${datum}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

main().catch(console.error)
