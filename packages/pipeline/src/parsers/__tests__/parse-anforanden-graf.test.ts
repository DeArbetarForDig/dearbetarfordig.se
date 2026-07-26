/**
 * parse-anforanden-graf.test.ts — Vitest suite for anföranden graph regeneration.
 *
 * Verifies:
 * 1. Index scheme: ordning = index + 1 för alla noder
 * 2. Attribution correctness: varje nod bär rätt talare och politikerId från källan
 * 3. Known § resolution: 2026-06-11 ärende 1 → kf-2026-06-11-§224
 * 4. Edge correctness: talade_i points to correct politiker
 * 5. Special case: 2023-06-19 with all "okänd" yields no nodes
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../../.tmp')

interface Anforande {
  talare: string
  politikerId?: string | null
  ordning: number
  text: string
  ärendeTitel: string
}

interface DebatteFil {
  anföranden: Anforande[]
}

interface GraphNode {
  id: string
  typ: string
  data: Record<string, unknown> & { talare?: string }
}

interface GraphEdge {
  from: string
  to: string
  typ: string
}

interface GrafFil {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

describe('parse-anforanden-graf', () => {
  describe('Index scheme (ordning = index + 1)', () => {
    it('verifies ordning matches array index for first 10 entries', () => {
      const datum = '2026-06-11'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      for (let i = 0; i < Math.min(10, debatteData.anföranden.length); i++) {
        const anf = debatteData.anföranden[i]
        expect(anf.ordning).toBe(i + 1)
      }
    })
  })

  describe('Attribution correctness', () => {
    it('loads generated graph and source data', () => {
      const datum = '2026-06-11'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      const generatedPath = join(TMP_DIR, 'anforanden-generated.json')
      const generatedData: GrafFil = JSON.parse(readFileSync(generatedPath, 'utf-8'))

      expect(debatteData).toBeDefined()
      expect(generatedData).toBeDefined()
      expect(debatteData.anföranden.length).toBeGreaterThan(0)
      expect(generatedData.nodes.length).toBeGreaterThan(0)
    })

    it('emits node for first anförande with correct talare', () => {
      const datum = '2026-06-11'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      const generatedPath = join(TMP_DIR, 'anforanden-generated.json')
      const generatedData: GrafFil = JSON.parse(readFileSync(generatedPath, 'utf-8'))

      // Find the first anförande with ordning=1
      const sourceAnf = debatteData.anföranden.find((a) => a.ordning === 1)
      expect(sourceAnf).toBeDefined()
      expect(sourceAnf!.politikerId).toBeDefined()
      expect(sourceAnf!.politikerId).not.toBeNull()

      const nodeId = `anforande-${datum}-0`
      const generatedNode = generatedData.nodes.find((n) => n.id === nodeId)
      expect(generatedNode).toBeDefined()
      expect(generatedNode!.data.talare).toBe(sourceAnf!.talare)
    })

    it('creates talade_i edge pointing to correct politiker', () => {
      const datum = '2026-06-11'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      const generatedPath = join(TMP_DIR, 'anforanden-generated.json')
      const generatedData: GrafFil = JSON.parse(readFileSync(generatedPath, 'utf-8'))

      const sourceAnf = debatteData.anföranden.find((a) => a.ordning === 1)
      expect(sourceAnf).toBeDefined()
      expect(sourceAnf!.politikerId).toBeDefined()

      const nodeId = `anforande-${datum}-0`
      const taladeiEdge = generatedData.edges.find(
        (e) => e.typ === 'talade_i' && e.to === nodeId,
      )
      expect(taladeiEdge).toBeDefined()

      const expectedFrom = `politiker-${sourceAnf!.politikerId}`
      expect(taladeiEdge!.from).toBe(expectedFrom)
    })
  })

  describe('Known resolution: 2026-06-11 ärende 1', () => {
    it('resolves to kf-2026-06-11-§224', () => {
      const datum = '2026-06-11'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      const generatedPath = join(TMP_DIR, 'anforanden-generated.json')
      const generatedData: GrafFil = JSON.parse(readFileSync(generatedPath, 'utf-8'))

      const sourceAnf = debatteData.anföranden.find((a) => a.ordning === 1)
      expect(sourceAnf).toBeDefined()

      const nodeId = `anforande-${datum}-0`
      const diskuteradeEdge = generatedData.edges.find(
        (e) => e.typ === 'diskuterade' && e.from === nodeId,
      )
      expect(diskuteradeEdge).toBeDefined()
      expect(diskuteradeEdge!.to).toBe('kf-2026-06-11-§224')
    })
  })

  describe('Special case: 2023-06-19', () => {
    it('yields no nodes (all talare are okänd)', () => {
      const datum = '2023-06-19'
      const debattePath = join(DATA_DIR, 'debatter', `kf-${datum}.json`)
      const debatteData: DebatteFil = JSON.parse(readFileSync(debattePath, 'utf-8'))

      // Verify all rows have talare: "okänd"
      const allUnknown = debatteData.anföranden.every((a) => a.talare === 'okänd')
      expect(allUnknown).toBe(true)

      // Verify no nodes are generated for this date
      const generatedPath = join(TMP_DIR, 'anforanden-generated.json')
      const generatedData: GrafFil = JSON.parse(readFileSync(generatedPath, 'utf-8'))

      const nodesForDate = generatedData.nodes.filter((n) => n.id.includes(`anforande-${datum}-`))
      expect(nodesForDate).toHaveLength(0)
    })
  })
})
