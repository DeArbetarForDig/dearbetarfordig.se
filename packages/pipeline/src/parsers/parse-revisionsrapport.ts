/**
 * Parser: Stadsrevisionens rapportsammandrag/missiv — granskningsfynd
 *
 * Extraherar titel, sammanfattning och rekommendationer ur Stadsrevisionens
 * "rapportsammandrag"/"missiv"-PDF:er (data/revision/). Två observerade
 * mallar delar samma struktur längre ner i dokumentet (titelblock → löpande
 * text → rekommendationssatser), men skiljer sig i hur titelblocket ser ut:
 *   A) "Sammanfattande bedömning"-mall: eget rubrikord skiljer titel från text
 *   B) "Missiv"-mall: ingen rubrik, titelblocket följs direkt av löptext
 * Rekommendationssatser följer två grammatiska former i båda mallarna:
 *   "Stadsrevisionen/Lekmannarevisorerna/Revisionskontoret rekommenderar X att …"
 *   "X rekommenderas att …"
 * Mottagarna (X) i rekommendationerna används som "vilka organisationer
 * berörs" — matchas mot nämnd/bolag-noder i seed.ts (samma nämndMap-mönster
 * som redan används för politiker-uppdrag), inte i denna parser: parsern
 * känner inte till graf-nod-id:n, bara rå text.
 *
 * Avsiktligt utanför scope (annan genre, se docs/ANALYS-2026-07.md):
 *   stadsrevisionens_arsredogorelse_* (årsredogörelse, 38–47 sidor)
 *   revisionsberattelse_* (revisionsberättelse, 3–53 sidor)
 * Filer utan textlager (skannade dokument) hoppas också över, loggat.
 *
 * Användning: npx tsx packages/pipeline/src/parsers/parse-revisionsrapport.ts
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REVISION_DIR = join(import.meta.dirname, '../../../../data/revision')
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')
const OUTPUT_PATH = join(OUTPUT_DIR, 'revisionsrapporter.json')

const SKIP_FILENAME_RE = /^(stadsrevisionens_arsredogorelse_|revisionsberattelse_)/i

interface GraphNode {
  id: string
  typ: string
  label: string
  data: Record<string, unknown>
}

interface Rekommendation {
  mottagare: string
  text: string
}

function pdfToText(pdfPath: string): string {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  })
}

// Slår ihop pdftotext -layout-radbrytningar till löpande text: strippar
// sidfoten ("Stadsrevisionen, <titel>    N (M)", ingen avslutande punkt —
// annars kan den flyta ihop med nästa meningsstart eftersom den inte
// stoppas av `[^.]`-mönstren nedan), läker avstavning
// ("verksamhetsfor-\ndon" → "verksamhetsfordon") och kollapsar kvarvarande
// radbrytningar inom stycket till mellanslag.
function reflow(text: string): string {
  return text
    .replace(/^Stadsrevisionen,.*\d+\s*\(\d+\)\s*$/gm, '')
    .replace(/-\n(?=[a-zäöåA-ZÄÖÅ])/g, '')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// Title blocks are often generic ("Missiv till ansvariga nämnder och
// bolagsstyrelser") — the real topic sits in the opening body sentence
// ("Revisorerna har avslutat granskningen av X." / "Stadsrevisionen har
// granskat X hos Y."). {0,70} bounds the actor→"har" search so it can't
// accidentally jump from the masthead's lone "Stadsrevisionen" all the way
// past the title block to a much later "har" (that gap runs >100 chars in
// every observed document — the real actor+har clause is always short,
// even with insertions like "och de berörda lekmannarevisorerna").
const BODY_ACTOR_RE =
  /(Stadsrevisionen|Revisorerna|Revisionskontoret|Lekmannarevisorerna)\b[^.]{0,70}?\bhar\b\s*/
const TOPIC_RE = /\bgranskat\s+([^.]+?)(?:\shos\s|\.)|\bgranskningen(?:\s+av)?\s+([^.]+?)\./

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const MASTHEAD_RE = /^Rapportsammandrag\s*Stadsrevisionen\s*/

// bodyStart marks where the real content begins (after masthead + generic
// title block) — used by extractSammanfattning so it doesn't have to
// re-locate the (possibly re-capitalized) titel string in the raw text.
function extractTitel(reflowed: string): {
  titel: string
  viaFallback: boolean
  bodyStart: number
} {
  const actorMatch = reflowed.match(BODY_ACTOR_RE)
  if (actorMatch?.index !== undefined) {
    const topicStart = actorMatch.index + actorMatch[0].length
    const topicMatch = reflowed.slice(topicStart, topicStart + 400).match(TOPIC_RE)
    const topic = topicMatch?.[1] ?? topicMatch?.[2]
    if (topic) {
      return {
        titel: capitalize(topic.replace(/\s+/g, ' ').trim()),
        viaFallback: false,
        bodyStart: actorMatch.index,
      }
    }
  }
  // Fallback: title-block text before the actor sentence (or before end of
  // document if even that wasn't found) — logged by the caller as a review flag.
  const mastheadMatch = reflowed.match(MASTHEAD_RE)
  const mastheadLen = mastheadMatch ? mastheadMatch[0].length : 0
  const end = actorMatch?.index !== undefined ? actorMatch.index : reflowed.length
  const titel = reflowed
    .slice(mastheadLen, Math.min(end, mastheadLen + 200))
    .replace(/^Missiv till\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { titel, viaFallback: true, bodyStart: end }
}

// Mottagare-capture excludes ':' as well as '.' — a heading like "Utifrån
// granskningen lämnar revisionskontoret följande rekommendationer:" has no
// period before the real recipient starts, only a colon, so without this
// the match bridges the whole heading into the mottagare group.
const REKOMMENDATION_A_RE =
  /(Stadsrevisionen|Lekmannarevisorerna|Revisionskontoret) rekommenderar ([^.:]+?) att ([^.]+\.)/g
const REKOMMENDATION_B_RE = /([A-ZÅÄÖ][^.:]*?) rekommenderas att ([^.]+\.)/g

// Dedup key ignores hyphens: some documents restate every recommendation
// twice (once narratively via pattern A, once in a closing bulleted-passive
// list via pattern B) and the two copies don't always hyphenate identically
// — a compound word wrapped across a line break in one spot ("va-\ntaxan")
// but not the other ends up as "vataxan" vs "va-taxan" after dehyphenation.
function actionKey(text: string): string {
  return text.toLowerCase().replace(/-/g, '').replace(/\s+/g, ' ').trim()
}

function extractRekommendationer(reflowed: string): {
  rekommendationer: Rekommendation[]
  matchStart: number
} {
  const rekommendationer: Rekommendation[] = []
  const seen = new Set<string>()
  let matchStart = -1
  const record = (mottagare: string, text: string, key: string, index?: number) => {
    // matchStart tracks the earliest occurrence of ANY recommendation
    // sentence regardless of which copy wins the dedup below — a document
    // can restate the same recommendation earlier in one grammatical form
    // and later in the other, and sammanfattning's end boundary needs the
    // true earliest one or it swallows everything up to the later copy.
    if (index !== undefined && (matchStart < 0 || index < matchStart)) matchStart = index
    if (seen.has(key)) return
    seen.add(key)
    rekommendationer.push({ mottagare: mottagare.trim(), text: text.trim() })
  }
  for (const m of reflowed.matchAll(REKOMMENDATION_A_RE)) {
    record(m[2], `${m[1]} rekommenderar ${m[2]} att ${m[3]}`, actionKey(m[3]), m.index)
  }
  for (const m of reflowed.matchAll(REKOMMENDATION_B_RE)) {
    record(m[1], `${m[1]} rekommenderas att ${m[2]}`, actionKey(m[2]), m.index)
  }
  if (rekommendationer.length === 0) {
    const bulletMatch = extractBulletRekommendationer(reflowed)
    if (bulletMatch.rekommendationer.length > 0) return bulletMatch
  }
  return { rekommendationer, matchStart }
}

// Third observed format: a "Rekommendationer" heading, one shared addressee
// stated once ("...rekommendationer till <mottagare>:"), then a bulleted
// list ("• Att …") with no per-item recipient. Bounded by stopping at the
// first bullet that doesn't match "Att …" (end of list).
function extractBulletRekommendationer(reflowed: string): {
  rekommendationer: Rekommendation[]
  matchStart: number
} {
  const headerMatch = reflowed.match(/rekommendationer\s+till\s+([^:]+):/)
  if (!headerMatch || headerMatch.index === undefined)
    return { rekommendationer: [], matchStart: -1 }
  const mottagare = headerMatch[1].replace(/\s+/g, ' ').trim()
  const afterHeader = reflowed.slice(headerMatch.index + headerMatch[0].length)
  const rekommendationer: Rekommendation[] = []
  for (const bullet of afterHeader.split('•').slice(1)) {
    const m = bullet.match(/^\s*(Att [^.]+\.)/)
    if (!m) break
    rekommendationer.push({ mottagare, text: m[1].replace(/\s+/g, ' ').trim() })
  }
  return { rekommendationer, matchStart: headerMatch.index }
}

function extractSammanfattning(
  reflowed: string,
  bodyStart: number,
  rekommendationStart: number,
): string {
  const end =
    rekommendationStart >= 0 ? rekommendationStart : Math.min(reflowed.length, bodyStart + 1200)
  let text = reflowed
    .slice(bodyStart, end)
    .replace(/^Sammanfattande bedömning\s*/, '')
    .replace(/Mot bakgrund av ovanstående[^.]*rekommendationer:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  // The end boundary sometimes lands mid-sentence (e.g. cut at the word
  // "rekommendationer" inside "…lämnar vi följande tre rekommendationer
  // till…" for the bulleted-list format) — back up to the last full stop.
  if (text && !text.endsWith('.')) {
    const lastPeriod = text.lastIndexOf('.')
    if (lastPeriod > 0) text = text.slice(0, lastPeriod + 1)
  }
  return text
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,:;()»«"”'’%]/g, '')
    .replace(/[^a-zäöåé0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseFile(pdfPath: string, filename: string = pdfPath): GraphNode | null {
  const raw = pdfToText(pdfPath)
  if (!raw.trim()) {
    console.warn(`   ⚠️  ${filename}: inget textlager (troligen skannad bild) — hoppar över`)
    return null
  }
  const reflowed = reflow(raw)
  const { titel, viaFallback, bodyStart } = extractTitel(reflowed)
  if (!titel) {
    console.warn(`   ⚠️  ${filename}: kunde inte hitta titel — hoppar över`)
    return null
  }
  if (viaFallback) {
    console.warn(`   ⚠️  ${filename}: titel via fallback (ej ämnesmening) — granska: "${titel}"`)
  }
  const { rekommendationer, matchStart } = extractRekommendationer(reflowed)
  const sammanfattning = extractSammanfattning(reflowed, bodyStart, matchStart)
  if (rekommendationer.length === 0) {
    console.warn(`   ⚠️  ${filename}: inga rekommendationssatser hittade — granska manuellt`)
  }

  return {
    id: `revision-${slugify(titel)}`,
    typ: 'revisionsrapport',
    label: titel,
    data: {
      sammanfattning,
      rekommendationer,
      källa: decodeURIComponent(filename),
      källaUrl: 'https://goteborg.se/stadsrevisionen',
    },
  }
}

async function main() {
  console.log('📋 Parsar Stadsrevisionens rapportsammandrag/missiv...\n')
  const files = readdirSync(REVISION_DIR)
    .filter((f) => f.endsWith('.pdf'))
    .filter((f) => !SKIP_FILENAME_RE.test(f))
  console.log(`   ${files.length} filer (${SKIP_FILENAME_RE} exkluderade — se filhuvud)\n`)

  const nodes: GraphNode[] = []
  const seenIds = new Map<string, number>()
  for (const file of files) {
    const node = parseFile(join(REVISION_DIR, file), file)
    if (!node) continue
    const dupCount = seenIds.get(node.id) || 0
    if (dupCount > 0) node.id = `${node.id}-${dupCount + 1}`
    seenIds.set(node.id, dupCount + 1)
    nodes.push(node)
    console.log(
      `   ✓ ${node.id} (${(node.data.rekommendationer as unknown[]).length} rekommendationer)`,
    )
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify({ nodes, edges: [] }, null, 2))
  console.log(`\n✅ ${OUTPUT_PATH} (${nodes.length}/${files.length} rapporter parsade)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { extractTitel, extractRekommendationer, extractSammanfattning, reflow, slugify, parseFile }
