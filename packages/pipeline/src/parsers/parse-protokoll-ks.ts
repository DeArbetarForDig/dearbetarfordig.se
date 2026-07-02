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

export interface VoteRecord {
  namn: string
  parti: string
  röst: 'ja' | 'nej' | 'avstår'
}

export interface Omröstning {
  ja: number
  nej: number
  avstår: number
  proposition: string
  jaBetyder: string | null
  nejBetyder: string | null
  verified: boolean
  röster: VoteRecord[]
}

// Prefix som föregår ett namn men inte är del av det — "tjänstgörande
// ersättaren/ersättarna" gäller bara närmast följande namn i uppräkningen
// (splitten på , / och / samt isolerar det redan), "ordföranden"/
// "tjänstgörande ordföranden" (en ersättare som leder mötet) likaså.
const NAMN_PREFIX_RE =
  /^(tjänstgörande ersättarna|tjänstgörande ersättaren|tjänstgörande ordföranden|ordföranden)\s+/i
// Partibeteckningen i parentes saknas ibland i källdokumentet (t.ex.
// "samt ordföranden Jonas Attenius röstar Ja" utan "(S)") — göra den valfri
// så att namnet ändå fångas och kan matchas mot politiker-id via namn.
const NAMN_RE = /^(.+?)(?:\s*\((\w+)\))?$/

function parseNamnlista(blob: string): Array<{ namn: string; parti: string }> {
  const collapsed = blob
    .replace(/\s+/g, ' ')
    // Källdokumentet saknar ibland en explicit avgränsare (komma/och/samt)
    // före "tjänstgörande ersättaren/ersättarna"/"ordföranden" när det följer
    // direkt efter föregående namns "(Parti)" på en ny rad — infoga komma så
    // att split-steget nedan inte glömmer bort namnet.
    .replace(
      /\)\s+(tjänstgörande ersättarna|tjänstgörande ersättaren|tjänstgörande ordföranden|ordföranden)\b/g,
      '), $1',
    )
    .trim()
  const delar = collapsed
    .split(/,|\s+och\s+|\s+samt\s+/)
    .map((d) => d.trim())
    .filter(Boolean)

  const resultat: Array<{ namn: string; parti: string }> = []
  for (const del of delar) {
    const utanPrefix = del.replace(NAMN_PREFIX_RE, '').trim()
    if (!utanPrefix) continue
    const m = utanPrefix.match(NAMN_RE)
    if (m) resultat.push({ namn: m[1].trim(), parti: m[2] || '' })
  }
  return resultat
}

// Tolkar semantiken i "Godkänd voteringsproposition" — Ja betyder INTE alltid
// bifall (se docs/SPEC-KS-VOTERINGAR.md, variation 2). Dueller mellan två
// yrkanden ("Ja för bifall till X... Nej för bifall till Y") kollas separat
// FÖRE den generella avslag/bifall-tolkningen, annars matchar båda "bifall".
function parsePropositionBetydelse(proposition: string): { ja: string; nej: string } | null {
  const duel = proposition.match(/Ja för bifall till (.+?) och Nej för bifall till (.+)/i)
  if (duel) {
    return {
      ja: `bifall: ${duel[1].trim()}`,
      nej: `bifall: ${duel[2].trim().replace(/\.$/, '')}`,
    }
  }
  const simple = proposition.match(/Ja för (avslag|bifall)[\s\S]*?Nej för (avslag|bifall)/i)
  if (simple) return { ja: simple[1].toLowerCase(), nej: simple[2].toLowerCase() }
  // Återremiss-omröstning: "Ja för ärendets återremiss och Nej för ärendets
  // avgörande idag" (eller omvänt) — förekommer återkommande i korpusen.
  const återremiss = proposition.match(
    /Ja för ärendets (återremiss|avgörande idag)[\s\S]*?Nej för ärendets (återremiss|avgörande idag)/i,
  )
  if (återremiss) return { ja: återremiss[1].toLowerCase(), nej: återremiss[2].toLowerCase() }
  return null
}

// Extraherar EN Omröstning-sektion ur ett fönster [restStart, restEnd) i det
// redan städade paragraf-fulltextet — anropas per hittad proposition av
// parseOmröstningar nedan (en paragraf kan innehålla flera Omröstningar,
// t.ex. två närliggande tilläggsyrkanden som röstas separat).
function parseEttVoteringsblock(
  fulltext: string,
  proposition: string,
  restStart: number,
  restEnd: number,
  paragrafRef: string,
): Omröstning {
  const betydelse = parsePropositionBetydelse(proposition)
  if (!betydelse) {
    console.warn(`   ⚠️  Kunde inte tolka voteringsproposition (${paragrafRef}): "${proposition}"`)
  }

  // Citatets avslutande skiljetecken hamnar ibland UTANFÖR citattecknet
  // (”...förslag”. istället för ”...förslag.”) — en kvarbliven punkt direkt
  // efter propositionen skulle annars smälta ihop med nästa namn.
  const rest = fulltext.slice(restStart, restEnd).replace(/^\s*\.\s*/, ' ')
  // \s+ (inte bokstavligt mellanslag) mellan orden — källdokumentet radbryter
  // ibland mitt i frasen ("röstar\nJa (7).").
  const segmentRe =
    /([\s\S]+?)(röstar\s+Ja|röstar\s+Nej|avstår\s+från\s+att\s+rösta)\s*\((\d+)\)\./g
  const röster: VoteRecord[] = []
  let ja = 0
  let nej = 0
  let avstår = 0
  let ok = true
  let m: RegExpExecArray | null
  while ((m = segmentRe.exec(rest)) !== null) {
    const [, namesBlob, verb, countStr] = m
    const count = Number.parseInt(countStr, 10)
    const röst: VoteRecord['röst'] = verb.includes('Ja')
      ? 'ja'
      : verb.includes('Nej')
        ? 'nej'
        : 'avstår'
    const namn = parseNamnlista(namesBlob)
    if (namn.length !== count) {
      ok = false
      console.warn(
        `   ⚠️  Votering (${paragrafRef}): ${namn.length} namn hittade men ${count} förväntade för "${röst}"`,
      )
    }
    for (const n of namn) röster.push({ ...n, röst })
    if (röst === 'ja') ja = count
    else if (röst === 'nej') nej = count
    else avstår = count
  }

  return {
    ja,
    nej,
    avstår,
    proposition,
    jaBetyder: betydelse?.ja ?? null,
    nejBetyder: betydelse?.nej ?? null,
    verified: ok && betydelse !== null,
    röster,
  }
}

// Hittar ALLA Omröstningar i ett redan städat paragraf-fulltext (oftast en,
// men vissa paragrafer röstar om flera närliggande tilläggsyrkanden var för
// sig — se t.ex. KS 2024-04-10 § 307). Ankrar på "Godkänd
// voteringsproposition:" istället för rubriken "Omröstning" själv —
// sidhuvud-skräp (Protokoll nr/Sammanträdesdatum) kan hamna MELLAN
// "Omröstning" och propositionen (variation 11), men frasen "Godkänd
// voteringsproposition:" är unik och alltid direkt intill citatet.
// Varje blocks slut sätts vid det tidigaste av: nästa kända rubrik
// (Reservation/Protokollsanteckning/...) ELLER nästa Omröstnings egen
// proposition — annars läcker segment-parsern in i nästa votering.
export function parseOmröstningar(fulltext: string, paragrafRef: string): Omröstning[] {
  const propRe = /Godkänd voteringsproposition:\s*[”"]([\s\S]+?)[”"]/g
  const matches: RegExpExecArray[] = []
  let propMatch: RegExpExecArray | null
  while ((propMatch = propRe.exec(fulltext)) !== null) matches.push(propMatch)

  return matches.map((match, i) => {
    const proposition = match[1].replace(/\s+/g, ' ').trim()
    const restStart = match.index + match[0].length

    const stopMatch = fulltext
      .slice(restStart)
      .match(/Reservation|Protokollsanteckning|Protokollsutdrag|Göteborgs\s+Stad/)
    const candidates = [fulltext.length]
    if (stopMatch && stopMatch.index !== undefined) candidates.push(restStart + stopMatch.index)
    if (i + 1 < matches.length) candidates.push(matches[i + 1].index)
    const restEnd = Math.min(...candidates)

    return parseEttVoteringsblock(fulltext, proposition, restStart, restEnd, paragrafRef)
  })
}

function parseNärvarande(text: string): Array<{ namn: string; parti: string; roll: string }> {
  const närvarande: Array<{ namn: string; parti: string; roll: string }> = []
  const section = text.match(/Närvarande\n([\s\S]*?)(?=\nJusteringsdag|\nUnderskrifter)/)?.[1] || ''

  let currentRoll = 'Ledamot'
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === 'Ledamöter') {
      currentRoll = 'Ledamot'
      continue
    }
    if (trimmed.startsWith('Tjänstgörande ersättare')) {
      currentRoll = 'Tjänstgörande ersättare'
      continue
    }
    if (trimmed.startsWith('Övriga ersättare')) {
      currentRoll = 'Övriga ersättare'
      continue
    }
    if (trimmed.startsWith('Övriga närvarande') || trimmed.startsWith('Via Teams')) continue

    const m = trimmed.match(/^([\wÅÄÖåäö][\wÅÄÖåäö \-]+?)\s*\((\w+)\)/)
    if (m) {
      närvarande.push({ namn: m[1].trim(), parti: m[2], roll: currentRoll })
    }
  }
  return närvarande
}

function parseParagrafer(text: string, datum: string, nameToId: Map<string, string>) {
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
      if (!line) {
        if (started) continue
        else continue
      }
      if (
        line.match(/^(Beslut|Handling|Yrkanden|Protokollsutdrag|Propositionsordning)$/) ||
        line === 'Beslut'
      )
        break
      if (line.match(/^Göteborgs Stad [Kk]ommunstyrelsen protokoll/i)) break
      if (line.match(/^\d+\s*\(\d+\)$/)) continue // page number "45 (60)"
      if (
        line.match(/^Kommunstyrelsen$/) ||
        line.match(/^Protokoll nr \d+/) ||
        line.match(/^Sammanträdesdatum:/)
      )
        continue
      rubrikLines.push(line)
      started = true
    }
    const rubrik = rubrikLines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200)

    // Detect beslut type
    let beslut: string | undefined
    const hasBeslutText = section.match(/Enligt beslutssats|fastställs|tillstyrker.*föreslår/i)
    if (section.match(/tillstyrker.*föreslår att\s*kommunfullmäktige/i)) beslut = 'tillstyrkan_kf'
    else if (hasBeslutText && section.match(/bordlägg/i))
      beslut = 'bifall' // partial bordläggning = still beslut
    else if (section.match(/bordlägg/i) && !hasBeslutText) beslut = 'bordläggning'
    else if (section.match(/avslås/i)) beslut = 'avslag'
    else if (section.match(/bifallits|bifall/i)) beslut = 'bifall'
    else if (section.match(/Beslut\s*\n/)) beslut = 'beslut'

    // Extract yrkanden
    const yrkanden: Array<{ namn: string; parti: string; typ: string }> = []
    const yrkLineRe =
      /^([\wÅÄÖåäö\s,()-]+?)\s+(?:yrkar bifall till|yrkar avslag|yrkar)\s*(.{10,100})/gm
    let yrkMatch
    while ((yrkMatch = yrkLineRe.exec(section)) !== null) {
      const rawNames = yrkMatch[1].trim()
      const typ = yrkMatch[2].trim().replace(/\.$/, '')
      const partiMatches = [...rawNames.matchAll(/\((\w+)\)/g)]
      const parti = partiMatches.length > 0 ? partiMatches[partiMatches.length - 1][1] : ''
      const namn = rawNames
        .replace(/\s*\(\w+\)/g, '')
        .replace(/^Yrkanden\s*/i, '')
        .trim()
      if (namn && parti && !namn.match(/^(Ordföranden|Propositioner)/)) {
        yrkanden.push({ namn, parti, typ })
      }
    }

    // Extract reservationer
    const reservationer: string[] = []
    const resMatch = section.match(
      /Reservation\s*\n\s*\n?\s*(.+?)(?:\n\s*\n|\nProtokollsutdrag|\nGöteborgs)/s,
    )
    if (resMatch) reservationer.push(resMatch[1].trim())

    // Clean fulltext — remove page headers/footers
    const fulltext = section
      .replace(/Göteborgs\s+Stad\s+[Kk]ommunstyrelsen\s+protokoll[^\n]*/gi, '')
      .replace(/\d+\s*\(\d+\)/g, '')
      .replace(/\f/g, '')
      .replace(/\nKommunstyrelsen\s*\nProtokoll nr \d+\s*\nSammanträdesdatum:.*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // Roll-call votes — "Omröstning" section(s) in prose form, see
    // docs/SPEC-KS-VOTERINGAR.md. A paragraf usually has 0 or 1, occasionally
    // 2 (separate votes on closely related tilläggsyrkanden in one §).
    const voteringar = parseOmröstningar(fulltext, paragrafId)
    const [huvudVotering] = voteringar

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
        ...(huvudVotering
          ? {
              votering: {
                ja: huvudVotering.ja,
                nej: huvudVotering.nej,
                avstår: huvudVotering.avstår,
                proposition: huvudVotering.proposition,
                jaBetyder: huvudVotering.jaBetyder,
                nejBetyder: huvudVotering.nejBetyder,
                verified: huvudVotering.verified,
              },
            }
          : {}),
      },
    })

    // Edges byggs för ALLA hittade voteringar (inte bara huvudvoteringen ovan)
    // så att ingen röst tappas — men deduplicerade, eftersom två separata
    // voteringar i samma § ibland ger samma person samma röst till samma
    // paragraf-nod (skulle annars bli en falsk dubblett-edge).
    const sedda = new Set<string>()
    for (const votering of voteringar) {
      for (const röst of votering.röster) {
        const pid = nameToId.get(röst.namn.toLowerCase())
        if (!pid) {
          console.warn(`   ⚠️  Votering (${paragrafId}): ingen matchning för "${röst.namn}"`)
          continue
        }
        const typ = `röstade_${röst.röst}`
        const nyckel = `${pid}|${typ}`
        if (sedda.has(nyckel)) continue
        sedda.add(nyckel)
        edges.push({ from: `politiker-${pid}`, to: paragrafId, typ })
      }
    }

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
    const nämndRe =
      /(?:till|från)\s+([\wÅÄÖåäö][\wÅÄÖåäö -]*(?:nämnden|nämnd|bolaget|AB|styrelsen))/gi
    let nämndMatch
    while ((nämndMatch = nämndRe.exec(section)) !== null) {
      const nämndNamn = nämndMatch[1].trim()
      const nämndId = `org-${nämndNamn.toLowerCase().replace(/\s+/g, '-')}`
      if (!nodes.find((n) => n.id === nämndId)) {
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

  // Load politician name→id map first — needed both for närvarande-edges and
  // for votering-edges (röstade_ja/nej/avstår) built inside parseParagrafer.
  const polPath = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')
  const nameToId = new Map<string, string>()
  if (existsSync(polPath)) {
    const polData = JSON.parse(readFileSync(polPath, 'utf-8'))
    for (const p of polData.politiker) {
      nameToId.set(`${p.förnamn} ${p.efternamn}`.toLowerCase(), p.id)
      const parts = p.efternamn.split(/\s+/)
      if (parts.length > 1) {
        for (const part of parts) {
          nameToId.set(`${p.förnamn} ${part}`.toLowerCase(), p.id)
        }
      }
    }
  }

  const närvarande = parseNärvarande(text)
  const { nodes, edges } = parseParagrafer(text, datum, nameToId)

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
  for (const n of närvarande) {
    const id = nameToId.get(n.namn.toLowerCase())
    if (id) {
      edges.push({ from: `politiker-${id}`, to: möteId, typ: 'närvarade' })
    }
  }

  const graph = { nodes, edges }

  console.log(
    `\n   Nodes: ${nodes.length} (${nodes.filter((n) => n.typ === 'paragraf').length} §, ${nodes.filter((n) => n.typ === 'organisation').length} org)`,
  )
  console.log(`   Edges: ${edges.length}`)
  console.log(`   Närvarande: ${närvarande.length}`)

  const outPath = join(OUTPUT_DIR, `ks-${datum}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
