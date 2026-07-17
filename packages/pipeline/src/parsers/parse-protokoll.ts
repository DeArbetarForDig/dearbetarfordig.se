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
    | 'närvarade'
  label?: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- Regex patterns ---
// Paragraph header formats (all at line start):
// 2025+: "§ 491 Ärendenummer SLK-2025-00364"
// 2023-2024: "§ 5 1339/22" — and procedural §§ as bare "§5"/"§ 14" on
// their own line (interpellationer, frågestund, val, anmälningar)
const LAG_REF_RE =
  /(\d+)\s*kap\.?\s*(\d+)\s*§\s*([\wäöåÅÄÖ-]+lagen|miljöbalken|[\wäöåÅÄÖ-]+förordningen)(?:\s*\((\d{4}:\d+)\))?/gi
const SFS_RE = /\((\d{4}:\d+)\)/g
const NÄMND_RE =
  /((?:socialnämnden|grundskolenämnden|exploateringsnämnden|kulturnämnden|stadsmiljönämnden|idrotts- och föreningsnämnden|inköps- och upphandlingsnämnden|kommunstyrelsen|stadsfastighetsnämnden|kretslopp och vattennämnden|miljö- och klimatnämnden|förskolenämnden|utbildningsnämnden|stadsbyggnadsnämnden)(?:\s+\w+)?)/gi
const BORDLAGD_RE = /[Bb]ordlag[dt]\s+(?:den\s+)?(\d+)\s+(\w+)\s+(\d{4}),?\s*§\s*(\d+)/g
const MÅNADER: Record<string, string> = {
  januari: '01',
  februari: '02',
  mars: '03',
  april: '04',
  maj: '05',
  juni: '06',
  juli: '07',
  augusti: '08',
  september: '09',
  oktober: '10',
  november: '11',
  december: '12',
}
const UPPDRAG_RE = /(?:får i uppdrag|uppdrag\s+\d{4}-\d{2}-\d{2}\s*§\s*(\d+))/gi

function pdfToText(pdfPath: string): string {
  return execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
}

export function parseParagrafer(
  text: string,
  möteDatum: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Page-break continuations ("§ 16 1379/22 forts.") are not new paragraphs —
  // drop the header line so the content merges into the section it continues.
  const cleanedText = text.replace(/^§\s*\d+[^\n]*?forts\.?\s*$/gm, '')

  // Split on every paragraph header form at line start. All forms must split
  // simultaneously: old-format protocols mix "§ 15 1435/22" with bare "§ 14"
  // for procedural items — a format-wide choice glued every run of bare §§
  // into one section, so only the first survived (§2–14 used to vanish).
  const sections = cleanedText.split(
    /(?=^§\s*\d+\s*$)|(?=^§\s*\d+\s+\d{3,4}\/\d{2})|(?=^§\s*\d+\s+Ärendenummer)/m,
  )

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
      if (line.match(/^(Enligt|I ärendet|Under överläggningen|BILAGA|Antal Ja|Anförandet)/)) break
      if (line.match(/Göteborgs\s+Stad\s+[Kk]ommunfullmäktige\s+protokoll/i)) break
      rubrikLines.push(line)
    }
    const rubrik = rubrikLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200)

    // For known types, use only the first meaningful line as rubrik
    let cleanRubrik = rubrik
    if (rubrik.startsWith('Frågestund')) cleanRubrik = 'Frågestund'
    else if (rubrik.startsWith('Parentation')) cleanRubrik = rubrikLines[0]?.trim() || 'Parentation'
    else if (rubrik.startsWith('Anmälan'))
      cleanRubrik = rubrikLines[0]?.trim().slice(0, 120) || 'Anmälan'
    else if (rubrik.startsWith('Anförande') && rubrik.includes('rdföranden'))
      cleanRubrik = 'Ordförandens avslutningsanförande'

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
    const yrkLineRe = /^([\wÅÄÖåäö\s,()-]+?)\s+(?:yrkar bifall till|yrkar)\s*(.{10,80})/gm
    let yrkMatch
    while ((yrkMatch = yrkLineRe.exec(section)) !== null) {
      const rawNames = yrkMatch[1].trim()
      const typ = yrkMatch[2].trim().replace(/\.$/, '')
      // Extract all "(Parti)" from the names string — use last one as group parti
      const partiMatches = [...rawNames.matchAll(/\((\w+)\)/g)]
      const parti = partiMatches.length > 0 ? partiMatches[partiMatches.length - 1][1] : ''
      const namn = rawNames
        .replace(/\s*\(\w+\)/g, '')
        .replace(/^Yrkanden\s*/i, '')
        .trim()
      if (namn && parti && !namn.match(/^(Ordföranden|Propositioner)/))
        yrkanden.push({ namn, parti, typ })
    }

    // Extract jävsanmälan
    const jäv: Array<{ namn: string; parti: string }> = []
    const jävRe = /^([\wÅÄÖåäö][\wÅÄÖåäö -]+?)\s*\((\w+)\)\s*deltar inte/gm
    let jävMatch
    while ((jävMatch = jävRe.exec(section)) !== null) {
      jäv.push({ namn: jävMatch[1].trim(), parti: jävMatch[2] })
    }

    // Create paragraf node — trim bilagor from fulltext.
    // BILAGA-headers are all-caps and stand alone on their own line
    // ("BILAGA 1") — matching case-insensitively also caught inline mentions
    // like "framgår av bilaga 5." mid-sentence, truncating fulltext right
    // after the huvudvotering result and dropping Reservation/Protokolls-
    // utdrag that follows in the same paragraf.
    const bilagaIdx = section.search(/^BILAGA\s+\d+\s*$/m)
    const cleanSection = bilagaIdx > 0 ? section.slice(0, bilagaIdx) : section
    const fulltext = cleanSection
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/Göteborgs\s+Stad\s+[Kk]ommunfullmäktige\s+protokoll[^\n]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    const existing = nodes.find((n) => n.id === paragrafId)
    if (existing) {
      // Repeated header without "forts."-marker (page break) — merge into the
      // first section instead of emitting a duplicate node: at seed time the
      // last duplicate wins, so a short justering stub used to overwrite the
      // real paragraph.
      existing.data.fulltext = `${existing.data.fulltext}\n\n${fulltext}`
      if (!existing.data.beslut && beslut) {
        existing.data.beslut = beslut
        existing.data.bordläggningsorsak = bordläggningsorsak
      }
      if (!existing.data.votering && votering) existing.data.votering = votering
      ;(existing.data.yrkanden as unknown[]).push(...yrkanden)
      ;(existing.data.reservationer as unknown[]).push(...reservationer)
      ;(existing.data.jäv as unknown[]).push(...jäv)
    } else {
      nodes.push({
        id: paragrafId,
        typ: 'paragraf',
        label: `§ ${paragrafNr} ${cleanRubrik}`,
        data: {
          paragrafNr,
          ärendeNr,
          rubrik: cleanRubrik,
          fulltext,
          datum: möteDatum,
          beslut,
          bordläggningsorsak,
          votering,
          yrkanden,
          reservationer,
          jäv,
        },
      })
    }

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

    // Find references to other paragraphs (bordlagd). The protocol names the
    // meeting date ("bordlagt den 26 januari 2023, § 29") — resolve it to an
    // exact node id; a wildcard "kf-*-§N" target can never be seeded.
    const bordRe = new RegExp(BORDLAGD_RE.source, 'g')
    while ((match = bordRe.exec(section)) !== null) {
      const [, dag, månadNamn, år, refParagraf] = match
      const månad = MÅNADER[månadNamn.toLowerCase()]
      if (!månad) continue
      const refDatum = `${år}-${månad}-${dag.padStart(2, '0')}`
      edges.push({
        from: paragrafId,
        to: `kf-${refDatum}-§${refParagraf}`,
        typ: 'bordlagd_från',
        label: `Bordlagd från ${refDatum} § ${refParagraf}`,
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

// Parse Bilaga 1 — närvarolista (attendance table)
function parseNärvarolista(text: string, möteDatum: string, möteId: string): GraphEdge[] {
  const edges: GraphEdge[] = []

  // Load politiker for name→id resolution
  const polPath = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')
  const nameToId = new Map<string, string>()
  let politikerList: Array<{ id: string; förnamn: string; efternamn: string }> = []
  if (existsSync(polPath)) {
    const polData = JSON.parse(readFileSync(polPath, 'utf-8'))
    politikerList = polData.politiker
    // Först skrivna vinner vid kollision — levande poster står tidigare i
    // filen än syntetiserade historisk-poster, så en historisk dubblett med
    // längre efternamn ("Höij Risberg") kan inte kapa en levande politikers
    // exakta nyckel ("höij", "ternegren") via sin part-nyckel.
    const set = (key: string, id: string) => {
      if (!nameToId.has(key)) nameToId.set(key, id)
    }
    for (const p of polData.politiker) {
      // Exact matches
      set(`${p.efternamn}, ${p.förnamn}`.toLowerCase(), p.id)
      set(`${p.förnamn} ${p.efternamn}`.toLowerCase(), p.id)
      // Parts of double surnames: "Andersson Broang" → also match "Broang"
      const parts = p.efternamn.split(/\s+/)
      if (parts.length > 1) {
        for (const part of parts) {
          set(`${part}, ${p.förnamn}`.toLowerCase(), p.id)
          set(`${p.förnamn} ${part}`.toLowerCase(), p.id)
        }
      }
    }
  }

  function resolvePolitiker(rawNamn: string): string | undefined {
    // Direct lookup
    const direct = nameToId.get(rawNamn.toLowerCase())
    if (direct) return direct
    // "Efternamn, Förnamn" → "Förnamn Efternamn"
    const flipped = rawNamn
      .split(',')
      .reverse()
      .map((s) => s.trim())
      .join(' ')
    const flippedMatch = nameToId.get(flipped.toLowerCase())
    if (flippedMatch) return flippedMatch
    // Try matching by förnamn only (for short names in protocol)
    const parts = flipped.toLowerCase().split(/\s+/)
    for (const p of politikerList) {
      const pParts = `${p.förnamn} ${p.efternamn}`.toLowerCase().split(/\s+/)
      // Either direction: raw is an abbreviation of the roster name ("Andersson"
      // ⊂ "Andersson Broang"), OR the roster name is an abbreviation of raw
      // (roster "Mariette Höij" ⊂ protocol's "Mariette Höij Risberg" — some
      // years' närvarolista spell the full name, roster only holds the short form).
      if (
        parts.every((part) => pParts.includes(part)) ||
        pParts.every((part) => parts.includes(part))
      )
        return p.id
    }
    return undefined
  }

  // Find Bilaga 1 section with attendance data
  const bilagaMatch = text.match(/BILAGA\s+1[\s\S]*?(?:Plats\s+Ledamot|Ledamot\s+\d)/i)
  if (!bilagaMatch) return edges

  const startIdx = text.indexOf(bilagaMatch[0])
  const bilagaText = text.slice(startIdx)

  // Parse attendance rows: "Akbas, Aslan    S    14:44    21:43"
  const rowRe =
    /^([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö ,\-]+?)\s{2,}(S|M|V|SD|L|MP|D|KD|C|FP)\s{2,}(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/gm
  let match: RegExpExecArray | null

  while ((match = rowRe.exec(bilagaText)) !== null) {
    const rawNamn = match[1].trim()
    const parti = match[2]
    const ankom = match[3]
    const utgick = match[4]

    // Try to resolve to UUID
    const id = resolvePolitiker(rawNamn)

    if (!id) {
      // Skip unresolvable — don't create broken edges
      continue
    }

    const politikerId = `politiker-${id}`

    edges.push({
      from: politikerId,
      to: möteId,
      typ: 'närvarade',
      label: `${ankom}–${utgick}`,
    })
  }

  return edges
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

  // Parse närvarolista (Bilaga 1)
  const närvaroEdges = parseNärvarolista(text, datum, möteId)
  edges.push(...närvaroEdges)

  const graph: KnowledgeGraph = { nodes, edges }

  console.log(
    `\n   Nodes: ${nodes.length} (${nodes.filter((n) => n.typ === 'paragraf').length} §, ${nodes.filter((n) => n.typ === 'lag').length} lagar, ${nodes.filter((n) => n.typ === 'organisation').length} org)`,
  )
  console.log(`   Edges: ${edges.length}`)
  console.log(`   Voteringar: ${voteringar.nodes.length} (${totalRöster} individuella röster)`)
  console.log(`   Närvaro: ${närvaroEdges.length} registreringar (Bilaga 1)`)

  const outPath = join(OUTPUT_DIR, `kf-${datum}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
