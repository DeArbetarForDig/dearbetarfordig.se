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
  typ:
    | 'beslut_av'
    | 'hänvisar_till'
    | 'bordlagd_från'
    | 'uppdrag_till'
    | 'regleras_av'
    | 'inlämnad_av'
    | 'votering'
  label?: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- Regex patterns ---
// Two protocol formats:
// 2025+: "§ 491 Ärendenummer SLK-2025-00364"
// 2023-2024: "§ 5 1339/22" or "§5" (without ärendenummer)
const PARAGRAF_RE_NEW = /§\s*(\d+)\s*Ärendenummer\s*(SLK-\d{4}-\d+(?::\d+)?)/g
const PARAGRAF_RE_OLD = /§\s*(\d+)\s+(\d{3,4}\/\d{2})/g
const PARAGRAF_RE_BARE = /^§\s*(\d+)\s*$/gm // Just "§1" on its own line
const LAG_REF_RE =
  /(\d+)\s*kap\.?\s*(\d+)\s*§\s*([\wäöåÅÄÖ-]+lagen|miljöbalken|[\wäöåÅÄÖ-]+förordningen)(?:\s*\((\d{4}:\d+)\))?/gi
const SFS_RE = /\((\d{4}:\d+)\)/g
const NÄMND_RE =
  /((?:socialnämnden|grundskolenämnden|exploateringsnämnden|kulturnämnden|stadsmiljönämnden|idrotts- och föreningsnämnden|inköps- och upphandlingsnämnden|kommunstyrelsen|stadsfastighetsnämnden|kretslopp och vattennämnden|miljö- och klimatnämnden|förskolenämnden|utbildningsnämnden|stadsbyggnadsnämnden)(?:\s+\w+)?)/gi
const BORDLAGD_RE = /[Bb]ordlag[dt]\s+(?:den\s+)?\d+\s+\w+\s+\d{4},?\s*§\s*(\d+)/g
const UPPDRAG_RE = /(?:får i uppdrag|uppdrag\s+\d{4}-\d{2}-\d{2}\s*§\s*(\d+))/gi

function pdfToText(pdfPath: string): string {
  return execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

function parseParagrafer(
  text: string,
  möteDatum: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Detect protocol format by checking which pattern matches more
  const newFormatCount = (text.match(/§\s*\d+\s*Ärendenummer\s*SLK-/g) || []).length
  const oldFormatCount = (text.match(/^§\s*\d+\s+\d{3,4}\/\d{2}/gm) || []).length
  const bareFormatCount = (text.match(/^§\s*\d+\s*$/gm) || []).length

  // Choose splitting strategy based on format
  let sections: string[]
  if (newFormatCount > 0) {
    // 2025+ format: "§ 491 Ärendenummer SLK-2025-00364"
    sections = text.split(/(?=§\s*\d+\s*Ärendenummer)/)
  } else if (oldFormatCount > 0) {
    // 2023-2024 format: "§ 5 1339/22"
    sections = text.split(/(?=§\s*\d+\s+\d{3,4}\/\d{2})/)
  } else {
    // Bare format: "§1" or "§ 5" on own line — split on § at start of line
    sections = text.split(/(?=^§\s*\d+)/m)
  }

  for (const section of sections) {
    // Try all header formats
    let paragrafNr: string | undefined
    let ärendeNr: string | undefined

    const newMatch = section.match(/§\s*(\d+)\s*Ärendenummer\s*(SLK-\d{4}-\d+(?::\d+)?)/)
    const oldMatch = section.match(/§\s*(\d+)\s+(\d{3,4}\/\d{2})/)
    const bareMatch = section.match(/^§\s*(\d+)/m)

    if (newMatch) {
      paragrafNr = newMatch[1]
      ärendeNr = newMatch[2]
    } else if (oldMatch) {
      paragrafNr = oldMatch[1]
      ärendeNr = oldMatch[2]
    } else if (bareMatch) {
      paragrafNr = bareMatch[1]
      ärendeNr = undefined
    } else {
      continue
    }

    const paragrafId = `kf-${möteDatum}-§${paragrafNr}`

    // Extract rubrik (lines after ärendenummer until beslut/handling keyword)
    const lines = section.split('\n').filter((l) => l.trim())
    const rubrikLines: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.match(/^(Beslut|Handling|Information|Protokollsutdrag|Yrkande)/)) break
      if (line.match(/^(Enligt|I ärendet|Under överläggningen)/)) break
      rubrikLines.push(line)
    }
    const rubrik = rubrikLines.join(' ').replace(/\s+/g, ' ').trim()

    // Detect beslut type and reason
    let beslut: string | undefined
    let bordläggningsorsak: string | undefined
    if (section.match(/har bifallits|bifall till kommunstyrelsens/i)) beslut = 'bifall'
    else if (section.match(/avslag|avslagits/i)) beslut = 'avslag'
    else if (section.match(/bordlägg/i)) {
      beslut = 'bordläggning'
      // Classify reason
      if (section.match(/klockan\s+är|återstående\s+ärenden\s+ska\s+bordläggas/i)) {
        bordläggningsorsak = 'tid' // Time ran out
      } else if (section.match(/[Tt]idigare behandling.*[Bb]ordlagt/s)) {
        bordläggningsorsak = 'tidigare_bordlagd' // Already postponed before
      } else if (section.match(/[Ii]nterpellation.*bordlägg/i)) {
        bordläggningsorsak = 'interpellation_väntar' // Waiting for response
      } else {
        bordläggningsorsak = 'övrigt'
      }
    } else if (section.match(/återremiss/i)) beslut = 'återremiss'

    // Extract votering results from main text
    const voteMatch = section.match(/(\d+)\s*Ja\s*mot\s*(\d+)\s*Nej/)
    const votering = voteMatch
      ? { ja: Number.parseInt(voteMatch[1]), nej: Number.parseInt(voteMatch[2]) }
      : undefined

    // Extract reservationer
    const reservationer: string[] = []
    const resMatch = section.match(/Reservation\s*\n\s*\n\s*(.+?)(?:\n\s*\n|\nProtokollsutdrag)/s)
    if (resMatch) reservationer.push(resMatch[1].trim())

    // Extract yrkanden (who proposed what)
    const yrkanden: Array<{ namn: string; parti: string; typ: string }> = []
    const yrkRe = /([\wÅÄÖåäö\s-]+?)\s*\((\w+)\)\s*(?:yrkar bifall till|yrkar)\s*(.{10,80})/g
    let yrkMatch
    while ((yrkMatch = yrkRe.exec(section)) !== null) {
      yrkanden.push({ namn: yrkMatch[1].trim(), parti: yrkMatch[2], typ: yrkMatch[3].trim() })
    }

    // Extract jävsanmälan
    const jäv: Array<{ namn: string; parti: string }> = []
    const jävRe = /^([\wÅÄÖåäö][\wÅÄÖåäö -]+?)\s*\((\w+)\)\s*deltar inte/gm
    let jävMatch
    while ((jävMatch = jävRe.exec(section)) !== null) {
      jäv.push({ namn: jävMatch[1].trim(), parti: jävMatch[2] })
    }

    // Create paragraf node
    nodes.push({
      id: paragrafId,
      typ: 'paragraf',
      label: `§ ${paragrafNr} ${rubrik}`,
      data: {
        paragrafNr,
        ärendeNr,
        rubrik,
        fulltext: section.trim(),
        datum: möteDatum,
        beslut,
        bordläggningsorsak,
        votering,
        yrkanden,
        reservationer,
        jäv,
      },
    })

    // Find law references
    let match: RegExpExecArray | null
    const lagRe = new RegExp(LAG_REF_RE.source, 'gi')
    while ((match = lagRe.exec(section)) !== null) {
      const [, kap, paragraf, lagNamn, sfs] = match
      const lagId = sfs ? `sfs-${sfs}` : `lag-${lagNamn.toLowerCase()}`
      const lagLabel = sfs ? `${lagNamn} (${sfs})` : lagNamn

      if (!nodes.find((n) => n.id === lagId)) {
        nodes.push({ id: lagId, typ: 'lag', label: lagLabel, data: { sfs, kap, paragraf } })
      }
      edges.push({
        from: paragrafId,
        to: lagId,
        typ: 'regleras_av',
        label: `${kap} kap. ${paragraf} §`,
      })
    }

    // Find references to other paragraphs (bordlagd)
    const bordRe = new RegExp(BORDLAGD_RE.source, 'g')
    while ((match = bordRe.exec(section)) !== null) {
      const refParagraf = match[1]
      edges.push({
        from: paragrafId,
        to: `kf-*-§${refParagraf}`,
        typ: 'bordlagd_från',
        label: `Bordlagd från § ${refParagraf}`,
      })
    }

    // Find nämnd references (uppdrag)
    const nämndRe = new RegExp(NÄMND_RE.source, 'gi')
    while ((match = nämndRe.exec(section)) !== null) {
      const nämndNamn = match[1].trim()
      const nämndId = `org-${nämndNamn.toLowerCase().replace(/\s+/g, '-')}`

      if (!nodes.find((n) => n.id === nämndId)) {
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
function parseVoteringar(
  text: string,
  möteDatum: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Split on "Bilaga N" headers (can appear after page break or newline)
  const bilagor = text.split(/(?=\n?Bilaga \d+\s*\n)/)

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
    const ärendemening = meningMatch
      ? meningMatch[1].replace(/\n/g, ' ').trim()
      : `Ärende ${ärendeNr}`
    const ja = Number.parseInt(jaMatch[1])
    const nej = Number.parseInt(nejMatch?.[1] || '0')
    const avstår = Number.parseInt(avståMatch?.[1] || '0')
    const frånv = Number.parseInt(frånvMatch?.[1] || '0')

    // Find matching § for this ärende
    const paragrafId = `votering-${möteDatum}-ärende-${ärendeNr}`

    // Parse individual votes — column layout with spaces:
    // "Aslan Akbas                       S                1        Ordförande         Ja"
    // Some names span two lines: "Robert Andersson\nHammarstrand"
    const resultatIdx = bilaga.indexOf('Resultat')
    if (resultatIdx === -1) continue
    const voteSection = bilaga.slice(resultatIdx)
    const lines = voteSection.split('\n').slice(1) // skip header line

    const röster: Array<{ namn: string; parti: string; röst: string }> = []
    const voteLineRe =
      /^(.{20,40}?)\s{2,}(S|M|V|SD|L|MP|D|KD|C)\s{2,}\d+\s{2,}\S+\s{2,}(Ja|Nej|Avstår|Frånvarande)\s*$/

    let pendingName = ''
    for (const line of lines) {
      const m = line.match(voteLineRe)
      if (m) {
        const namn = `${pendingName} ${m[1]}`.trim()
        pendingName = ''
        röster.push({ namn, parti: m[2], röst: m[3].toLowerCase() })
      } else if (
        line.trim() &&
        !line.match(/^\s*(Namn|Bilaga|\f|Göteborgs|Kommunfullmäktige|Protokoll|Sammanträdes)/)
      ) {
        pendingName += ` ${line.trim()}`
      } else {
        pendingName = ''
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

  // Post-process: detect bulk bordläggning due to time
  // Pattern: one § says "klockan är X, §NNN-NNN bordläggs"
  const tidParagrafer = new Set<string>()
  for (const node of nodes) {
    if (node.typ !== 'paragraf') continue
    const section = text.slice(text.indexOf(`§ ${node.data.paragrafNr} Ärendenummer`) || 0)
    const bulkMatch = section.match(/klockan\s+är.*?paragraferna\s+(\d+)[–-](\d+)\s+bordläggs/s)
    if (bulkMatch) {
      const from = Number.parseInt(bulkMatch[1])
      const to = Number.parseInt(bulkMatch[2])
      for (let i = from; i <= to; i++) tidParagrafer.add(String(i))
    }
    // Also: "Motionerna under paragraferna NNN–NNN bordläggs"
    const motionMatch = section.match(
      /[Mm]otionerna\s+under\s+paragraferna\s+(\d+)[–-](\d+)\s+bordläggs/s,
    )
    if (motionMatch) {
      const from = Number.parseInt(motionMatch[1])
      const to = Number.parseInt(motionMatch[2])
      for (let i = from; i <= to; i++) tidParagrafer.add(String(i))
    }
  }
  // Apply "tid" to detected paragraphs
  for (const node of nodes) {
    if (node.typ === 'paragraf' && tidParagrafer.has(node.data.paragrafNr as string)) {
      if (node.data.beslut === 'bordläggning' && node.data.bordläggningsorsak !== 'tid') {
        node.data.bordläggningsorsak = 'tid'
      }
    }
  }

  // Parse voteringar from bilagor
  const voteringar = parseVoteringar(text, datum)
  const totalRöster = voteringar.nodes.reduce(
    (sum, n) => sum + ((n.data.röster as any[])?.length || 0),
    0,
  )

  // Merge votering data into paragraf nodes where possible
  for (const vNode of voteringar.nodes) {
    const ärendemening = (vNode.label || '').toLowerCase()
    const existing = nodes.find(
      (n) => n.typ === 'paragraf' && n.label.toLowerCase().includes(ärendemening.slice(0, 20)),
    )
    if (existing) {
      existing.data.röster = vNode.data.röster
      existing.data.votering = vNode.data.votering
    } else {
      nodes.push(vNode)
    }
  }

  // Add meeting node
  const möteId = `möte-kf-${datum}`
  nodes.unshift({
    id: möteId,
    typ: 'möte',
    label: `KF Sammanträde ${datum}`,
    data: { datum, organisation: 'Kommunfullmäktige' },
  })

  // Connect all paragrafer to the meeting
  for (const node of nodes) {
    if (node.typ === 'paragraf') {
      edges.push({ from: möteId, to: node.id, typ: 'beslut_av' })
    }
  }

  const graph: KnowledgeGraph = { nodes, edges }

  console.log(
    `\n   Nodes: ${nodes.length} (${nodes.filter((n) => n.typ === 'paragraf').length} §, ${nodes.filter((n) => n.typ === 'lag').length} lagar, ${nodes.filter((n) => n.typ === 'organisation').length} org)`,
  )
  console.log(`   Edges: ${edges.length}`)
  console.log(`   Voteringar: ${voteringar.nodes.length} (${totalRöster} individuella röster)`)

  const outPath = join(OUTPUT_DIR, `kf-${datum}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

main().catch(console.error)
