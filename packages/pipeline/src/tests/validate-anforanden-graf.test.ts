/**
 * Validation suite for data/graf/anforanden.json — ensures speaker attribution
 * stays synchronized with its source data/debatter/kf-*.json and all edge targets exist.
 *
 * The committed anforanden.json has 6800+ nodes with drifted attribution; this suite
 * must FAIL on the corrupt file and PASS on the regenerated version in .tmp/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

interface AnforandeNode {
  id: string
  typ: string
  label: string
  data: {
    datum: string
    ärendeNr: number
    ärende: string
    textLength: number
  }
}

interface Edge {
  from: string
  to: string
  typ: string
  data?: Record<string, unknown>
}

interface GrafFile {
  nodes: AnforandeNode[]
  edges: Edge[]
}

interface Anforande {
  talare: string
  parti: string
  ärende: number
  ärendeTitel: string
  text: string
  ordning: number
  politikerId: string | null
}

interface DebatteFile {
  anföranden: Anforande[]
  voteringar?: unknown[]
}

/**
 * Load a single debatte file and index its anföranden by their zero-based ordinal.
 * Returns { anföranden, nullPolikerIdIndexes } for the date.
 */
function loadDebatteFile(
  datum: string,
): { anföranden: (Anforande | undefined)[]; nullPolitikerIdIndexes: Set<number> } {
  const path = join(DATA_DIR, `debatter/kf-${datum}.json`)
  if (!existsSync(path)) {
    return { anföranden: [], nullPolitikerIdIndexes: new Set() }
  }

  const data = JSON.parse(readFileSync(path, 'utf-8')) as DebatteFile
  const nullIndexes = new Set<number>()

  for (const anf of data.anföranden) {
    if (!anf.politikerId) {
      nullIndexes.add(anf.ordning - 1) // convert 1-based to 0-based
    }
  }

  return {
    anföranden: data.anföranden.map((a) => a),
    nullPolitikerIdIndexes: nullIndexes,
  }
}

/**
 * Load all unique debatte dates from the anföranden nodes.
 */
function getUniqueDatumFromNodes(graf: GrafFile): string[] {
  const datums = new Set<string>()
  for (const node of graf.nodes) {
    const match = node.id.match(/^anforande-(\d{4}-\d{2}-\d{2})-/)
    if (match) {
      datums.add(match[1])
    }
  }
  return Array.from(datums).sort()
}

/**
 * Describe a node-source mismatch for diagnostics.
 */
function describeMismatch(
  nodeId: string,
  sourceText: string | undefined,
  sourcePolitikerId: string | null | undefined,
  nodeTextLength: number,
  nodeEdgeFrom: string | undefined,
): string {
  return (
    `${nodeId} — ` +
    `graph says textLen=${nodeTextLength} from=${nodeEdgeFrom}, ` +
    `source says textLen=${sourceText?.length || 'N/A'} politikerId=${sourcePolitikerId || '(null)'}`
  )
}

/**
 * Run a full validation suite against a single graf/anforanden.json file.
 * Returns results for reporting.
 */
function validateAnforandenGraf(grafPath: string): {
  attributionMismatches: number
  attributionExamples: string[]
  nullNodeCount: number
  nullExamples: string[]
  edgeTargetMismatches: number
  deadEdgeExamples: string[]
  datesByMismatchCount: Map<string, number>
} {
  const grafContent = readFileSync(grafPath, 'utf-8')
  const graf = JSON.parse(grafContent) as GrafFile

  const attributionMismatches = { count: 0, examples: [] as string[], byDate: new Map<string, number>() }
  const nullNodes = { count: 0, examples: [] as string[] }
  const edgeTargetMismatches = { count: 0, examples: [] as string[] }

  // === Check 1: Attribution matches the source ===
  const debatteCache = new Map<string, ReturnType<typeof loadDebatteFile>>()
  const dates = getUniqueDatumFromNodes(graf)

  for (const datum of dates) {
    if (!debatteCache.has(datum)) {
      debatteCache.set(datum, loadDebatteFile(datum))
    }
  }

  for (const node of graf.nodes) {
    const match = node.id.match(/^anforande-(\d{4}-\d{2}-\d{2})-(\d+)$/)
    if (!match) continue

    const [, datum, idxStr] = match
    const idx = parseInt(idxStr)
    const debatte = debatteCache.get(datum)

    if (!debatte) {
      if (attributionMismatches.examples.length < 5) {
        attributionMismatches.examples.push(`${node.id} — no debatte file for ${datum}`)
      }
      attributionMismatches.count++
      continue
    }

    const sourceRow = debatte.anföranden[idx]
    const expectedPolitikerId = sourceRow?.politikerId

    if (!sourceRow) {
      if (attributionMismatches.examples.length < 5) {
        attributionMismatches.examples.push(`${node.id} — no source row at index ${idx}`)
      }
      attributionMismatches.count++
      continue
    }

    // Text length must match
    if (sourceRow.text.length !== node.data.textLength) {
      attributionMismatches.count++
      attributionMismatches.byDate.set(datum, (attributionMismatches.byDate.get(datum) || 0) + 1)

      if (attributionMismatches.examples.length < 5) {
        const taladIEdge = graf.edges.find((e) => e.to === node.id && e.typ === 'talade_i')
        attributionMismatches.examples.push(
          describeMismatch(node.id, sourceRow.text, sourceRow.politikerId, node.data.textLength, taladIEdge?.from),
        )
      }
      continue
    }

    // talade_i edge must point to the correct politiker
    const taladIEdge = graf.edges.find((e) => e.to === node.id && e.typ === 'talade_i')
    const expectedEdgeTarget = expectedPolitikerId ? `politiker-${expectedPolitikerId}` : null

    if (expectedEdgeTarget && taladIEdge?.from !== expectedEdgeTarget) {
      attributionMismatches.count++
      attributionMismatches.byDate.set(datum, (attributionMismatches.byDate.get(datum) || 0) + 1)

      if (attributionMismatches.examples.length < 5) {
        attributionMismatches.examples.push(
          `${node.id} — talade_i points to ${taladIEdge?.from}, should be ${expectedEdgeTarget}`,
        )
      }
    }
  }

  // === Check 2: No nodes for null politikerId ===
  for (const node of graf.nodes) {
    const match = node.id.match(/^anforande-(\d{4}-\d{2}-\d{2})-(\d+)$/)
    if (!match) continue

    const [, datum, idxStr] = match
    const idx = parseInt(idxStr)
    const debatte = debatteCache.get(datum)

    if (!debatte) continue

    const sourceRow = debatte.anföranden[idx]
    if (sourceRow && !sourceRow.politikerId) {
      nullNodes.count++
      if (nullNodes.examples.length < 5) {
        nullNodes.examples.push(`${node.id} — node exists but source politikerId is null`)
      }
    }
  }

  // === Check 3: All edge targets exist ===
  // Build set of valid target nodes
  const validNodeIds = new Set(graf.nodes.map((n) => n.id))

  // Also load politiker-komplett to verify politiker targets
  const politikerPath = join(DATA_DIR, 'graf/politiker-komplett.json')
  const validPolitiker = new Set<string>()
  const validMoten = new Set<string>()
  if (existsSync(politikerPath)) {
    const pk = JSON.parse(readFileSync(politikerPath, 'utf-8')) as GrafFile
    for (const node of pk.nodes) {
      if (node.typ === 'politiker') {
        validPolitiker.add(node.id)
      }
    }
  }

  // Build set of valid möte nodes (möte-kf-YYYY-MM-DD)
  for (const datum of dates) {
    validMoten.add(`möte-kf-${datum}`)
  }

  // Load kf-*.json files to get valid diskuterade targets
  const validKfNodes = new Map<string, Set<string>>()
  for (const datum of dates) {
    const kfPath = join(DATA_DIR, `graf/kf-${datum}.json`)
    if (existsSync(kfPath)) {
      const kf = JSON.parse(readFileSync(kfPath, 'utf-8')) as GrafFile
      const nodeIds = new Set(kf.nodes.map((n) => n.id))
      validKfNodes.set(datum, nodeIds)
    }
  }

  for (const edge of graf.edges) {
    const target = edge.to

    if (edge.typ === 'talade_i') {
      // talade_i targets should be anforande nodes in this file
      if (!validNodeIds.has(target)) {
        edgeTargetMismatches.count++
        if (edgeTargetMismatches.examples.length < 5) {
          edgeTargetMismatches.examples.push(`talade_i edge from ${edge.from} to ${target} — target anforande node not found`)
        }
      }
    } else if (edge.typ === 'vid_möte') {
      // vid_möte should target møte-kf-YYYY-MM-DD
      if (!validMoten.has(target)) {
        edgeTargetMismatches.count++
        if (edgeTargetMismatches.examples.length < 5) {
          edgeTargetMismatches.examples.push(`vid_møte edge from ${edge.from} to ${target} — invalid møte target`)
        }
      }
    } else if (edge.typ === 'diskuterade') {
      // diskuterade should target paragraph nodes in kf-*.json
      const match = target.match(/^kf-(\d{4}-\d{2}-\d{2})-/)
      if (match) {
        const datum = match[1]
        const validIds = validKfNodes.get(datum)
        if (!validIds || !validIds.has(target)) {
          edgeTargetMismatches.count++
          if (edgeTargetMismatches.examples.length < 5) {
            edgeTargetMismatches.examples.push(`diskuterade edge from ${edge.from} to ${target} — target not found in kf-${datum}.json`)
          }
        }
      } else if (target.startsWith('votering-')) {
        // These are dead targets — votering nodes don't exist anywhere
        edgeTargetMismatches.count++
        if (edgeTargetMismatches.examples.length < 5) {
          edgeTargetMismatches.examples.push(`diskuterade edge from ${edge.from} to ${target} — votering target does not exist`)
        }
      } else {
        // Unknown diskuterade target format
        edgeTargetMismatches.count++
        if (edgeTargetMismatches.examples.length < 5) {
          edgeTargetMismatches.examples.push(`diskuterade edge from ${edge.from} to ${target} — unknown target format`)
        }
      }
    }
  }

  return {
    attributionMismatches: attributionMismatches.count,
    attributionExamples: attributionMismatches.examples,
    nullNodeCount: nullNodes.count,
    nullExamples: nullNodes.examples,
    edgeTargetMismatches: edgeTargetMismatches.count,
    deadEdgeExamples: edgeTargetMismatches.examples,
    datesByMismatchCount: attributionMismatches.byDate,
  }
}

/**
 * Test against the committed data/graf/anforanden.json.
 * This WILL FAIL because the committed file is corrupt.
 */
describe('data/graf/anforanden.json validation', () => {
  const grafPath = join(DATA_DIR, 'graf/anforanden.json')

  if (!existsSync(grafPath)) {
    it.skip('file not found', () => {})
  } else {
    const results = validateAnforandenGraf(grafPath)

    it('no anföranden nodes with null politikerId', () => {
      if (results.nullNodeCount > 0) {
        const msg = `Found ${results.nullNodeCount} nodes for sources with null politikerId:\n${results.nullExamples.join('\n')}`
        expect.fail(msg)
      }
    })

    it('attribution matches source text and politiker', () => {
      if (results.attributionMismatches > 0) {
        const worstDates = Array.from(results.datesByMismatchCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([d, count]) => `${d} (${count} mismatches)`)
          .join(', ')

        const msg =
          `${results.attributionMismatches} nodes have mismatched attribution (text length or politikerId).\n` +
          `Worst affected dates: ${worstDates}\n` +
          `Examples:\n` +
          results.attributionExamples.join('\n')
        expect.fail(msg)
      }
    })

    it('all edge targets exist', () => {
      if (results.edgeTargetMismatches > 0) {
        const msg =
          `${results.edgeTargetMismatches} edges point to nonexistent targets.\n` +
          `Examples:\n` +
          results.deadEdgeExamples.join('\n')
        expect.fail(msg)
      }
    })
  }
})

/**
 * Test against the regenerated .tmp/anforanden-generated.json.
 * This MUST PASS to prove the suite is measuring the real thing.
 */
describe('.tmp/anforanden-generated.json validation (regenerated file)', () => {
  const grafPath = join(TMP_DIR, 'anforanden-generated.json')

  if (!existsSync(grafPath)) {
    it.skip('regenerated file not found', () => {})
  } else {
    const results = validateAnforandenGraf(grafPath)

    it('no anföranden nodes with null politikerId', () => {
      if (results.nullNodeCount > 0) {
        expect.fail(`Found ${results.nullNodeCount} invalid null-politikerId nodes (should all be clean in regenerated)`)
      }
    })

    it('attribution matches source text and politiker', () => {
      if (results.attributionMismatches > 0) {
        expect.fail(
          `Found ${results.attributionMismatches} mismatched nodes in regenerated file (should be 0):\n${results.attributionExamples.join('\n')}`,
        )
      }
    })

    it('all edge targets exist', () => {
      if (results.edgeTargetMismatches > 0) {
        expect.fail(
          `Found ${results.edgeTargetMismatches} dead edge targets in regenerated file (should be 0):\n${results.deadEdgeExamples.join('\n')}`,
        )
      }
    })
  }
})
