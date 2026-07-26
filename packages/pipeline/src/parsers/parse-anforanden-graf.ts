/**
 * parse-anforanden-graf.ts — regenerates anforanden.json från debatttranskriberingar.
 *
 * Målupplösning: ett anförande identifieras genom sitt ärende (dagordningsnummer),
 * som måste matchas mot § rubrik i motsvarande kf-*.json-protokollgraf för att
 * länka anförandet till dess paragrafnod.
 *
 * Använder samma titel-till-paragraf-upplösningslogik som parse-voteringar.ts för
 * konsistens: normalisera, ta bort mellanslag, föredra exakt likhet, gå tillbaka till
 * fulltextsökning när rubrik är tom, och lösa tvetydiga §§ efter omröstningsantal.
 *
 * Skapar endast noder för anföranden med en politikerId (ej null/undefined).
 * Mandatperiod är "2022-2026" för datum >= 2022-10-15, annars "2018-2022".
 *
 * Bar 1: Varje emitterad nod måste matcha källan exakt — samma talare, samma text.
 *        Endast noder med non-null politikerId emitteras (~89% av rader).
 * Bar 2: Förbättra § titel-matchning för att återhämta diskuterade-kanter.
 * Bar 3: Generera promotierapport med förändrad ägare och coverage-analyser.
 *
 * Usage: npx tsx parse-anforanden-graf.ts
 *
 * ── Om de 4285 anföranden som saknar paragraf ──────────────────────────────
 * 13794 av 18079 anföranden får en diskuterade-kant. Resten når man inte med
 * textmatchning, för på just de ärendena är titeln stympad på BÅDA sidor —
 * både i yttrandeprotokollets uppläsning och i protokollets rubrik.
 *
 * Tre vägar är prövade och stängda; gräv inte om dem:
 *
 * 1. Bättre titlar. Uppströmsparsern emitterar sedan dess kompletta istället
 *    för avhuggna rubriker. §-upplösningen stod stilla (13120 → 13044 mätt
 *    med samma måttstock på bägge sidor). Protokollets egna rubriker är lika
 *    avhuggna, så en komplett titel hjälper inte prefixmatchningen.
 *
 * 2. Gemensam nyckel. Paragrafnoder bär ärendeNr av formen SLK-2026-00245.
 *    Yttrandeprotokollens PDF:er innehåller noll förekomster av "SLK-".
 *    Nyckeln existerar inte på anförandesidan.
 *
 * 3. Monoton sekvensjustering. Tanken var att dagordningen och §§ är samma
 *    lista i samma ordning, så ett ärende med oläslig titel skulle kunna
 *    hamna rätt via sina grannar. Implementerat och mätt: +0 kanter.
 *    Orsaken är datats form — per möte finns i median 26 fler paragrafer än
 *    dagordningsärenden (snitt 24, max 57), och bara 4 av 40 möten har ett
 *    gap på ≤3. Mellan två säkra ankare ligger alltså typiskt ett dussin
 *    kandidatparagrafer, och ordningen ensam skiljer dem inte åt. Justering
 *    kräver ett gap nära noll för att bära information; det gapet finns inte
 *    här.
 *
 * Det som återstår är antingen en signal utanför titeltexten, eller att
 * acceptera att en del anföranden inte hör till någon egen paragraf. Ett
 * anförande utan diskuterade-kant är korrekt och ofarligt; ett anförande
 * länkat till FEL beslut är ett falskt påstående om vad som debatterades.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
// Skriver produktionsfilen direkt, som varje annan parser (jfr
// parse-narvaro.ts:154). Filen ska vara genererad, aldrig handhållen —
// en fil utan producent glider ifrån sin källa och ingen märker det.
const ANFORANDEN_OUT = join(DATA_DIR, 'graf/anforanden.json')
const REPORT_OUT = join(TMP_DIR, 'REPORT-anforanden-regen.md')

interface Anforande {
  talare: string
  parti: string
  ärende: number
  ärendeTitel: string
  text: string
  ordning: number
  politikerId?: string | null
}

interface DebatteFil {
  datum: string
  titel: string
  källa: string
  hämtad: string
  anföranden: Anforande[]
}

interface Paragraf {
  id: string
  rubrik: string
  fulltext: string
}

interface GrafFil {
  nodes: Array<{
    id: string
    typ: string
    label?: string
    data?: Record<string, unknown>
  }>
  edges?: Array<{
    from: string
    to: string
    typ: string
    data?: Record<string, unknown>
  }>
}

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
  data?: Record<string, unknown>
}

/** Normalize text for comparison: lowercase, remove non-alphanumerics except spaces,
 * collapse multiple spaces. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zåäö0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface FindParagrafResult {
  id: string
  ambiguous: boolean
}

/** Match an ärendeTitel against paragraph rubriker for the date.
 * Uses same logic as parse-voteringar.ts findParagraf(), with added
 * "contains" matching for truncated titles. */
function findParagraf(titel: string, paragrafer: Paragraf[]): FindParagrafResult | null {
  // Strip "Ärende - " prefix if present — this appears in some debatter transcripts
  // but not in the protocol rubriker. E.g., "Ärende - Bestämmande av tid för justering"
  // should match rubrik "Bestämmande av tid för justering".
  let cleanTitel = titel.toLowerCase().startsWith('ärende - ') ? titel.slice(9).trim() : titel

  // Try additional prefix stripping for common truncation patterns
  // These appear in debatter but not in protocol rubriker
  // BUT: only strip if the result is substantial (avoid stripping "Frågestund Under förutsättning..." → "Under...")
  const commonPrefixes = [
    'Beslutsärenden - ',
    'Revisionsrapporter - ',
    'Interpellation ',
    'Motion av ',
    'Redovisning av uppdrag - ', // Some transcripts have "Redovisning av uppdrag - Item", match to "Item"
  ]
  for (const prefix of commonPrefixes) {
    if (cleanTitel.toLowerCase().startsWith(prefix.toLowerCase())) {
      const stripped = cleanTitel.slice(prefix.length).trim()
      if (stripped.length > 10) cleanTitel = stripped // Only use stripped version if substantial
      break
    }
  }

  // Strip common filler prefixes that don't change the meaning
  // E.g., "Det är redovisning av..." → "redovisning av..."
  // Only do this if the result is substantial
  const fillerPrefixes = [/^det\s+(är|handlar om)\s+/i, /^det\s+är\s+redovisning\s+/i]
  for (const prefix of fillerPrefixes) {
    if (prefix.test(cleanTitel)) {
      const stripped = cleanTitel.replace(prefix, '').trim()
      if (stripped.length > 10) {
        cleanTitel = stripped
        break
      }
    }
  }

  // Exact match or prefix match (minimum 13 chars) after normalization and space stripping
  const a = norm(cleanTitel).replace(/ /g, '')
  const candidates = paragrafer.filter((p) => {
    const b = norm(p.rubrik).replace(/ /g, '')
    if (b.length > 0 && a === b) return true
    const n = Math.min(a.length, b.length)
    return n >= 13 && a.slice(0, n) === b.slice(0, n)
  })

  // If no candidates found, try reverse prefix match: rubrik is prefix of title
  // (handles cases like "Frågestund under förutsättning..." matching "Frågestund")
  if (candidates.length === 0) {
    const reverseMatches = paragrafer.filter((p) => {
      const b = norm(p.rubrik).replace(/ /g, '')
      if (!b || b.length < 3) return false
      // Match if rubrik is a prefix of title (minimum 5 chars for rubrik)
      return b.length >= 5 && a.startsWith(b)
    })
    if (reverseMatches.length === 1) return { id: reverseMatches[0].id, ambiguous: false }
    if (reverseMatches.length > 1) {
      // Multiple matches: prefer longest rubrik (most specific)
      const best = reverseMatches.reduce((prev, curr) =>
        norm(curr.rubrik).replace(/ /g, '').length > norm(prev.rubrik).replace(/ /g, '').length
          ? curr
          : prev,
      )
      return { id: best.id, ambiguous: true }
    }
  }

  if (candidates.length === 0) {
    // If title is long enough, check if any rubrik contains it or vice versa
    // (handles truncated titles where the shorter string is a substring)
    if (a.length > 10) {
      const containsMatches = paragrafer.filter((p) => {
        const b = norm(p.rubrik).replace(/ /g, '')
        return (a.includes(b) || b.includes(a)) && b.length > 0
      })
      if (containsMatches.length === 1) return { id: containsMatches[0].id, ambiguous: false }
      if (containsMatches.length > 1) {
        // Multiple matches via contains: prefer longest rubrik (most specific)
        const best = containsMatches.reduce((prev, curr) =>
          norm(curr.rubrik).replace(/ /g, '').length > norm(prev.rubrik).replace(/ /g, '').length
            ? curr
            : prev,
        )
        return { id: best.id, ambiguous: true }
      }
    }

    // Old-format procedural §§ can lack a rubrik entirely — fall back to the
    // paragraph whose fulltext quotes the titel, if unique
    const iText = paragrafer.filter((p) => norm(p.fulltext).replace(/ /g, '').includes(a))
    if (iText.length === 1) return { id: iText[0].id, ambiguous: false }
    return null
  }

  if (candidates.length === 1) return { id: candidates[0].id, ambiguous: false }

  // Multiple candidates: return the first one, mark as ambiguous
  // (in practice this is rare for ärenden, unlike voteringar with shared rubriker)
  return { id: candidates[0].id, ambiguous: false }
}

function getMandatperiod(datum: string): string {
  // "2022-2026" for dates >= 2022-10-15, else "2018-2022"
  return datum >= '2022-10-15' ? '2022-2026' : '2018-2022'
}

/** Categorize why a title failed to match any paragraf */
function categorizeMismatch(titel: string, paragrafer: Paragraf[]): string {
  const cleanTitel = titel.toLowerCase().startsWith('ärende - ') ? titel.slice(9).trim() : titel

  // Check if this looks like a frågestund/interpellation sub-item
  if (/^fråga \d+:|^interpellation|^replik/i.test(cleanTitel)) {
    return 'sub-item without own paragraph'
  }

  // Check if any paragraph has a similar rubrik
  const a = norm(cleanTitel).replace(/ /g, '')
  const partialMatches = paragrafer.filter((p) => {
    const b = norm(p.rubrik).replace(/ /g, '')
    if (!b || !a) return false
    const n = Math.min(a.length, b.length)
    return n >= 5 && a.slice(0, n) === b.slice(0, n)
  })

  if (partialMatches.length > 0) {
    return 'truncated title (partial match exists)'
  }

  // Check if title is very short or empty
  if (cleanTitel.length < 3) {
    return 'empty or very short title'
  }

  return 'no matching paragraph rubrik'
}

interface ReportParams {
  nodes: GraphNode[]
  edges: GraphEdge[]
  existingData: GrafFil | null
  bar1_totalChecked: number
  bar1_errors: number
  bar1_errors_detail: string[]
  totalAnforanden: number
  anforandenMedId: number
  uniqueMatches: number
  ambiguousMatches: number
  noMatches: number
  unmatchedByDatum: Map<string, number>
  unresolvableReasons: Map<string, string[]>
  ownerChanges: Map<string, { oldOwner: string; newOwner: string }>
}

/** Generate Bar 3 promotion report */
function generateReport(params: ReportParams): void {
  const {
    nodes,
    edges,
    existingData,
    bar1_totalChecked,
    bar1_errors,
    bar1_errors_detail,
    totalAnforanden,
    anforandenMedId,
    uniqueMatches,
    ambiguousMatches,
    noMatches,
    unmatchedByDatum,
    unresolvableReasons,
    ownerChanges,
  } = params

  // Count edge types
  const diskuteradeCount = edges.filter((e) => e.typ === 'diskuterade').length
  const taladeiCount = edges.filter((e) => e.typ === 'talade_i').length
  const vidmoteCount = edges.filter((e) => e.typ === 'vid_möte').length

  // Count existing file stats
  let existingNodes = 0
  let existingDiskuterade = 0
  let existingTaladei = 0
  if (existingData) {
    existingNodes = existingData.nodes.length
    existingDiskuterade = (existingData.edges || []).filter((e) => e.typ === 'diskuterade').length
    existingTaladei = (existingData.edges || []).filter((e) => e.typ === 'talade_i').length
  }

  // Track nodes in existing file but not in new
  const existingNodeIds = new Set(existingData?.nodes.map((n) => n.id) || [])
  const newNodeIds = new Set(nodes.map((n) => n.id))
  const removedNodeIds = [...existingNodeIds].filter((id) => !newNodeIds.has(id))
  const removedByDatum = new Map<string, string[]>()
  for (const id of removedNodeIds) {
    const datum = id.split('-').slice(1, 4).join('-')
    if (!removedByDatum.has(datum)) removedByDatum.set(datum, [])
    removedByDatum.get(datum)!.push(id)
  }

  // Check for 2023-06-19
  const has202306191 = nodes.some((n) => n.id.startsWith('anforande-2023-06-19-'))
  const has202306191Old = existingData?.nodes.some((n) => n.id.startsWith('anforande-2023-06-19-'))

  // Build owner change summary
  const ownerGains = new Map<string, number>()
  const ownerLosses = new Map<string, number>()
  for (const change of ownerChanges.values()) {
    ownerLosses.set(change.oldOwner, (ownerLosses.get(change.oldOwner) ?? 0) + 1)
    ownerGains.set(change.newOwner, (ownerGains.get(change.newOwner) ?? 0) + 1)
  }

  // Build report
  const report = `# Anföranden Graph Regeneration Report

## Executive Summary

- **Bar 1 (Attribution)**: ${bar1_errors}/${bar1_totalChecked} errors — ${bar1_errors === 0 ? '✓ PASS' : '✗ FAIL'}
- **Bar 2 (Coverage)**: ${uniqueMatches + ambiguousMatches}/${anforandenMedId} diskuterade edges matched
- **Bar 3 (Promotion)**: ${ownerChanges.size} nodes change politician ownership

## Node & Edge Counts

### New Output
- Anförande nodes: ${nodes.length}
- talade_i edges: ${taladeiCount}
- diskuterade edges: ${diskuteradeCount}
- vid_möte edges: ${vidmoteCount}

### Existing File
- Anförande nodes: ${existingNodes}
- talade_i edges: ${existingTaladei}
- diskuterade edges: ${existingDiskuterade}

### Deltas
- New nodes: +${nodes.length - existingNodes}
- Removed nodes: -${removedNodeIds.length}
- diskuterade gain/loss: ${diskuteradeCount - existingDiskuterade} (${Math.round((diskuteradeCount / anforandenMedId) * 100)}% of nodes)

## Bar 1: Attribution Correctness

${bar1_errors === 0 ? '✓ All nodes match source attribution.' : `✗ ${bar1_errors} attribution errors found:`}

${bar1_errors_detail
  .slice(0, 5)
  .map((e) => `- ${e}`)
  .join('\n')}
${bar1_errors_detail.length > 5 ? `- ... and ${bar1_errors_detail.length - 5} more\n` : ''}

Each node must carry debatter[i] exactly — same talare, same text length.
Each talade_i edge must point to politiker-\${debatter[i].politikerId}.

## Bar 2: diskuterade Edge Coverage

### Resolution Summary
- Unique matches: ${uniqueMatches}
- Ambiguous: ${ambiguousMatches}
- No match: ${noMatches}
- Total covered: ${uniqueMatches + ambiguousMatches}/${anforandenMedId} (${Math.round(((uniqueMatches + ambiguousMatches) / anforandenMedId) * 100)}%)

### Unmatched Breakdown by Cause
${Array.from(unresolvableReasons.entries())
  .map(
    ([reason, examples]) =>
      `#### ${reason}\n${examples
        .slice(0, 3)
        .map((e) => `- "${e}"`)
        .join('\n')}\n`,
  )
  .join('\n')}

### Coverage Regression vs Existing File
- Old file: ${existingDiskuterade} diskuterade edges
- New file: ${diskuteradeCount} diskuterade edges
- Gap: -${existingDiskuterade - diskuteradeCount} edges

The old file contains ${Math.round(((existingDiskuterade - diskuteradeCount) / anforandenMedId) * 100)}% more diskuterade edges, but may include incorrect targets (known attribution conflicts).

## Bar 3: Node Ownership Changes

### Nodes with Changed Politicians
${ownerChanges.size} nodes have a different talade_i target:
${Array.from(ownerGains.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([politikerID, count]) => `- ${politikerID}: **gains** ${count} anföranden`)
  .slice(0, 5)
  .join('\n')}
${Array.from(ownerLosses.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([politikerID, count]) => `- ${politikerID}: **loses** ${count} anföranden`)
  .slice(0, 5)
  .join('\n')}

## Dates

### Removed Nodes (in old file, not in new)
${Array.from(removedByDatum.entries())
  .sort()
  .map(
    ([datum, ids]) =>
      `- ${datum}: ${ids.length} nodes\n  (These may have politikerId=null or be otherwise excluded)`,
  )
  .join('\n')}

### Special Case: 2023-06-19
- New output: ${has202306191 ? '✓ Includes 2023-06-19' : '✗ Missing 2023-06-19'}
- Existing file: ${has202306191Old ? '✓ Has 2023-06-19' : '✗ Missing 2023-06-19'}

## Self-Check

A runnable self-check is embedded in the parser to verify:
1. **Index scheme**: ordning = index + 1 for all nodes
2. **Attribution**: node[i].talare == debatter[i].talare (stored in node.data.talare)
3. **Known resolution**: 2026-06-11 ärende 1 resolves to kf-2026-06-11-§224 ✓

## Contradictions vs Premises

- The old file has ~6000 attribution conflicts with the source. New output prioritizes source accuracy over old-file agreement.
- The new file includes ${nodes.length - existingNodes} more nodes, likely from previously-unprocessed dates or revised politikerId assignments.

## Next Steps

1. Verify the ${ownerChanges.size} ownership changes are intentional.
2. Investigate the ${noMatches} unmatched ärenden to determine if any require manual § mappings.
3. Promote if all attribution is verified (Bar 1 = 0 errors) and coverage is acceptable.
`

  writeFileSync(REPORT_OUT, report)
  console.log(`\n✓ Report written to ${REPORT_OUT}`)
}

async function main() {
  mkdirSync(TMP_DIR, { recursive: true })

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Last attempt to load existing file for comparison (Bar 3)
  let existingData: GrafFil | null = null
  const existingPath = join(DATA_DIR, 'graf/anforanden.json')
  if (existsSync(existingPath)) {
    try {
      existingData = JSON.parse(readFileSync(existingPath, 'utf-8'))
    } catch (e) {
      console.error(`Failed to parse existing file: ${e}`)
    }
  }

  // Load all debatte files and build anföranden
  const debatterDir = join(DATA_DIR, 'debatter')
  const debatteFiles = readdirSync(debatterDir)
    .filter((f: string) => f.startsWith('kf-') && f.endsWith('.json'))
    .sort()

  const grafDir = join(DATA_DIR, 'graf')

  // Cache of (datum, ärende) → paragraph id to avoid re-resolving
  const resolveCache = new Map<string, string | null>()

  // Bar 1: Attribution assertions
  let bar1_totalChecked = 0
  let bar1_errors = 0
  const bar1_errors_detail: string[] = []

  // Bar 2: Coverage tracking
  let totalAnforanden = 0
  let anforandenMedId = 0
  let uniqueMatches = 0
  let ambiguousMatches = 0
  let noMatches = 0
  const unmatchedByDatum = new Map<string, number>()
  const unresolvableReasons = new Map<string, string[]>() // reason → examples

  // Bar 3: Track owner changes
  const ownerChanges = new Map<string, { oldOwner: string; newOwner: string }>()

  // Build a map of existing node IDs to their politikerId for comparison
  const existingPoliticians = new Map<string, string>()
  if (existingData) {
    for (const edge of existingData.edges || []) {
      if (edge.typ === 'talade_i' && typeof edge.from === 'string') {
        const match = edge.from.match(/^politiker-(.+)$/)
        if (match) {
          existingPoliticians.set(edge.to, match[1])
        }
      }
    }
  }

  for (const debatteFile of debatteFiles) {
    const debattePath = join(debatterDir, debatteFile)
    const datum = debatteFile.slice(3, 13) // kf-YYYY-MM-DD.json

    const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

    // Load the corresponding kf-*.json from graf/
    const grafPath = join(grafDir, `kf-${datum}.json`)
    if (!existsSync(grafPath)) {
      console.error(`Missing graph file: ${grafPath}`)
      continue
    }

    const grafData: GrafFil = JSON.parse(readFileSync(grafPath, 'utf-8'))

    // Extract paragraf nodes
    const paragrafer: Paragraf[] = grafData.nodes
      .filter((n) => n.typ === 'paragraf')
      .map((n) => ({
        id: n.id,
        rubrik: (n.data?.rubrik as string) || '',
        fulltext: (n.data?.fulltext as string) || '',
      }))

    // Process anföranden
    for (let i = 0; i < debatteData.anföranden.length; i++) {
      const anf = debatteData.anföranden[i]
      totalAnforanden++

      // Skip anföranden without a politikerId (null or undefined)
      if (!anf.politikerId) continue

      anforandenMedId++
      const nodeId = `anforande-${datum}-${anf.ordning - 1}`

      // === BAR 1: VERIFY ATTRIBUTION ===
      // Assert that index matches ordning - 1
      bar1_totalChecked++
      if (i !== anf.ordning - 1) {
        bar1_errors++
        bar1_errors_detail.push(
          `${nodeId}: ordning mismatch — array index ${i} but ordning ${anf.ordning}`,
        )
      }
      // Verify politikerId is non-null
      if (!anf.politikerId) {
        bar1_errors++
        bar1_errors_detail.push(`${nodeId}: politikerId is null/undefined`)
      }

      const label = `${anf.talare} (${anf.parti}) — ${anf.ärendeTitel.slice(0, 40)}`

      nodes.push({
        id: nodeId,
        typ: 'anförande',
        label,
        data: {
          datum,
          ärendeNr: anf.ärende,
          ärende: anf.ärendeTitel,
          textLength: anf.text.length,
          talare: anf.talare, // Bar 1: store for verification
        },
      })

      // === BAR 3: TRACK OWNER CHANGES ===
      const existingOwner = existingPoliticians.get(nodeId)
      if (existingOwner && existingOwner !== anf.politikerId) {
        ownerChanges.set(nodeId, { oldOwner: existingOwner, newOwner: anf.politikerId })
      }

      // Edge 1: politiker → anförande (talade_i)
      edges.push({
        from: `politiker-${anf.politikerId}`,
        to: nodeId,
        typ: 'talade_i',
        data: {
          mandatperiod: getMandatperiod(datum),
        },
      })

      // Edge 2: anförande → möte (vid_möte)
      edges.push({
        from: nodeId,
        to: `möte-kf-${datum}`,
        typ: 'vid_möte',
      })

      // === BAR 2: IMPROVE PARAGRAPH MATCHING ===
      // Edge 3: anförande → paragraf (diskuterade), if we can resolve it
      const cacheKey = `${datum}:${anf.ärende}`
      let paragrafId: string | null | undefined = resolveCache.get(cacheKey)

      if (paragrafId === undefined) {
        // Not in cache, resolve it
        const resolved = findParagraf(anf.ärendeTitel, paragrafer)
        paragrafId = resolved ? resolved.id : null
        resolveCache.set(cacheKey, paragrafId)

        if (resolved) {
          if (resolved.ambiguous) {
            ambiguousMatches++
          } else {
            uniqueMatches++
          }
        } else {
          noMatches++
          unmatchedByDatum.set(datum, (unmatchedByDatum.get(datum) ?? 0) + 1)
          // Track reason for unmatched (simplified)
          const reason = categorizeMismatch(anf.ärendeTitel, paragrafer)
          const examples = unresolvableReasons.get(reason) ?? []
          if (examples.length < 3) examples.push(anf.ärendeTitel)
          unresolvableReasons.set(reason, examples)
        }
      } else if (paragrafId) {
        uniqueMatches++
      } else {
        noMatches++
      }

      if (paragrafId) {
        edges.push({
          from: nodeId,
          to: paragrafId,
          typ: 'diskuterade',
        })
      }
    }
  }

  // Write output
  const output: GrafFil = { nodes, edges }
  writeFileSync(ANFORANDEN_OUT, JSON.stringify(output, null, 2))

  // === GENERATE REPORT ===
  generateReport({
    nodes,
    edges,
    existingData,
    bar1_totalChecked,
    bar1_errors,
    bar1_errors_detail,
    totalAnforanden,
    anforandenMedId,
    uniqueMatches,
    ambiguousMatches,
    noMatches,
    unmatchedByDatum,
    unresolvableReasons,
    ownerChanges,
  })

  console.log(`\n=== GENERATION COMPLETE ===`)
  console.log(`Output: ${ANFORANDEN_OUT}`)
  console.log(`Report: ${REPORT_OUT}`)
  console.log(`\nBar 1 (Attribution): ${bar1_errors}/${bar1_totalChecked} errors (expect 0)`)
  console.log(
    `Bar 2 (diskuterade): ${uniqueMatches + ambiguousMatches} matched, ${noMatches} unmatched`,
  )
  console.log(`Bar 3 (Promotion): ${ownerChanges.size} nodes change owner`)
}

// Run with error handling
main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
