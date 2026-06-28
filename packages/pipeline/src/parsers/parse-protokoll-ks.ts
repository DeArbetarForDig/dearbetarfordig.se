/**
 * KS Protocol Parser — extracts structured data from Kommunstyrelsen protocols.
 *
 * Usage: npx tsx parse-protokoll-ks.ts <pdf-url-or-path> <datum>
 *
 * Output: data/graf/ks-{datum}.json
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

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
}

function pdfToText(pdfPath: string): string {
  return execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

function parseNärvarande(text: string): Array<{ namn: string; parti: string; roll: string }> {
  const närvarande: Array<{ namn: string; parti: string; roll: string }> = []
  const section = text.match(/Närvarande\n([\s\S]*?)(?=\nJusteringsdag|\nUnderskrifter)/)?.[1] || ''

  let currentRoll = 'Ledamot'
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === 'Ledamöter') { currentRoll = 'Ledamot'; continue }
    if (trimmed.startsWith('Tjänstgörande ersättare')) { currentRoll = 'Tjänstgörande ersättare'; continue }
    if (trimmed.startsWith('Övriga ersättare')) { currentRoll = 'Övriga ersättare'; continue }
    if (trimmed.startsWith('Övriga närvarande') || trimmed.startsWith('Via Teams')) continue

    const m = trimmed.match(/^([\wÅÄÖåäö][\wÅÄÖåäö \-]+?)\s*\((\w+)\)/)
    if (m) {
      närvarande.push({ namn: m[1].trim(), parti: m[2], roll: currentRoll })
    }
  }
  return närvarande
}

function parseParagrafer(text: string, datum: string) {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Split on § headers
  const sections = text.split(/(?=§\s*\d+\s*Ärendenummer)/)

  for (const section of sections) {
    const headerMatch = section.match(/§\s*(\d+)\s*Ärendenummer\s*(SLK-\d{4}-\d+(?::\d+)?)/)
    if (!headerMatch) continue

    const paragrafNr = headerMatch[1]
    const ärendeNr = headerMatch[2]
    const paragrafId = `ks-${datum}-§${paragrafNr}`

    // Extract rubrik
    const lines = section.split('\n')
    const rubrikLines: string[] = []
    let started = false
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.trim()
      if (!line) { if (started) continue; else continue }
      if (line.match(/^(Beslut|Handling|Yrkanden|Protokollsutdrag|Propositionsordning)$/) || line === 'Beslut') break
      if (line.match(/^Göteborgs Stad [Kk]ommunstyrelsen protokoll/i)) break
      if (line.match(/^\d+\s*\(\d+\)$/)) continue // page number "45 (60)"
      if (line.match(/^Kommunstyrelsen$/) || line.match(/^Protokoll nr \d+/) || line.match(/^Sammanträdesdatum:/)) continue
      rubrikLines.push(line)
      started = true
    }
    const rubrik = rubrikLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200)

    // Detect beslut type
    let beslut: string | undefined
    if (section.match(/tillstyrker.*föreslår att\s*kommunfullmäktige/i)) beslut = 'tillstyrkan_kf'
    else if (section.match(/bordlägg/i)) beslut = 'bordläggning'
    else if (section.match(/avslås/i)) beslut = 'avslag'
    else if (section.match(/bifallits|bifall/i)) beslut = 'bifall'
    else if (section.match(/Beslut\s*\n/)) beslut = 'beslut'

    // Extract yrkanden
    const yrkanden: Array<{ namn: string; parti: string; typ: string }> = []
    const yrkLineRe = /^([\wÅÄÖåäö\s,()-]+?)\s+(?:yrkar bifall till|yrkar avslag|yrkar)\s*(.{10,100})/gm
    let yrkMatch
    while ((yrkMatch = yrkLineRe.exec(section)) !== null) {
      const rawNames = yrkMatch[1].trim()
      const typ = yrkMatch[2].trim().replace(/\.$/, '')
      const partiMatches = [...rawNames.matchAll(/\((\w+)\)/g)]
      const parti = partiMatches.length > 0 ? partiMatches[partiMatches.length - 1][1] : ''
      const namn = rawNames.replace(/\s*\(\w+\)/g, '').replace(/^Yrkanden\s*/i, '').trim()
      if (namn && parti && !namn.match(/^(Ordföranden|Propositioner)/)) {
        yrkanden.push({ namn, parti, typ })
      }
    }

    // Extract reservationer
    const reservationer: string[] = []
    const resMatch = section.match(/Reservation\s*\n\s*\n?\s*(.+?)(?:\n\s*\n|\nProtokollsutdrag|\nGöteborgs)/s)
    if (resMatch) reservationer.push(resMatch[1].trim())

    // Clean fulltext — remove page headers/footers
    const fulltext = section
      .replace(/Göteborgs\s+Stad\s+[Kk]ommunstyrelsen\s+protokoll[^\n]*/gi, '')
      .replace(/\d+\s*\(\d+\)/g, '')
      .replace(/\f/g, '')
      .replace(/\nKommunstyrelsen\s*\nProtokoll nr \d+\s*\nSammanträdesdatum:.*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    nodes.push({
      id: paragrafId,
      typ: 'paragraf',
      label: `§ ${paragrafNr} ${rubrik}`,
      data: {
        paragrafNr,
        ärendeNr,
        rubrik,
        fulltext,
        datum,
        organ: 'Kommunstyrelsen',
        beslut,
        yrkanden,
        reservationer,
      },
    })

    // Extract references to KF (tillstyrkan)
    if (beslut === 'tillstyrkan_kf') {
      const kfHandling = section.match(/KF Handling (\d{4}) nr (\d+)/)
      if (kfHandling) {
        edges.push({
          from: paragrafId,
          to: `kf-handling-${kfHandling[1]}-${kfHandling[2]}`,
          typ: 'hänvisar_till',
          label: `KF Handling ${kfHandling[1]} nr ${kfHandling[2]}`,
        })
      }
    }

    // Extract nämnd references
    const nämndRe = /(?:till|från)\s+([\wÅÄÖåäö][\wÅÄÖåäö -]*(?:nämnden|nämnd|bolaget|AB|styrelsen))/gi
    let nämndMatch
    while ((nämndMatch = nämndRe.exec(section)) !== null) {
      const nämndNamn = nämndMatch[1].trim()
      const nämndId = `org-${nämndNamn.toLowerCase().replace(/\s+/g, '-')}`
      if (!nodes.find(n => n.id === nämndId)) {
        nodes.push({ id: nämndId, typ: 'organisation', label: nämndNamn, data: {} })
      }
      edges.push({ from: paragrafId, to: nämndId, typ: 'hänvisar_till' })
    }
  }

  return { nodes, edges }
}

async function main() {
  const pdfUrl = process.argv[2]
  const datum = process.argv[3] || '2025-01-01'

  if (!pdfUrl) {
    console.error('Usage: npx tsx parse-protokoll-ks.ts <pdf-url-or-path> <datum>')
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  let pdfPath: string
  if (pdfUrl.startsWith('http')) {
    pdfPath = join(TMP_DIR, `ks-protokoll-${datum}.pdf`)
    if (!existsSync(pdfPath)) {
      console.log(`⬇️  Laddar ner: ${pdfUrl.slice(0, 60)}...`)
      execSync(`curl -sL '${pdfUrl}' -o "${pdfPath}"`)
    }
  } else {
    pdfPath = pdfUrl
  }

  console.log(`📄 Parsear KS-protokoll ${datum}...`)
  const text = pdfToText(pdfPath)
  console.log(`   ${text.split('\n').length} rader text`)

  const närvarande = parseNärvarande(text)
  const { nodes, edges } = parseParagrafer(text, datum)

  // Add meeting node
  const möteId = `möte-ks-${datum}`
  nodes.unshift({
    id: möteId,
    typ: 'möte',
    label: `KS Sammanträde ${datum}`,
    data: { datum, organisation: 'Kommunstyrelsen', närvarande },
  })

  // Connect paragrafer to meeting
  for (const node of nodes) {
    if (node.typ === 'paragraf') {
      edges.push({ from: möteId, to: node.id, typ: 'beslut_av' })
    }
  }

  // Resolve närvarande to politician UUIDs for edges
  const polPath = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')
  if (existsSync(polPath)) {
    const polData = JSON.parse(readFileSync(polPath, 'utf-8'))
    const nameToId = new Map<string, string>()
    for (const p of polData.politiker) {
      nameToId.set(`${p.förnamn} ${p.efternamn}`.toLowerCase(), p.id)
      const parts = p.efternamn.split(/\s+/)
      if (parts.length > 1) {
        for (const part of parts) {
          nameToId.set(`${p.förnamn} ${part}`.toLowerCase(), p.id)
        }
      }
    }
    for (const n of närvarande) {
      const id = nameToId.get(n.namn.toLowerCase())
      if (id) {
        edges.push({ from: `politiker-${id}`, to: möteId, typ: 'närvarade' })
      }
    }
  }

  const graph = { nodes, edges }

  console.log(`\n   Nodes: ${nodes.length} (${nodes.filter(n => n.typ === 'paragraf').length} §, ${nodes.filter(n => n.typ === 'organisation').length} org)`)
  console.log(`   Edges: ${edges.length}`)
  console.log(`   Närvarande: ${närvarande.length}`)

  const outPath = join(OUTPUT_DIR, `ks-${datum}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

main().catch(console.error)
