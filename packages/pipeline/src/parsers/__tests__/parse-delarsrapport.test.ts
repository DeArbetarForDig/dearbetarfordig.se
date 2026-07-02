import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractWithDocling } from '../../lib/docling'
import {
  findResultatTable,
  findTjänsteTable,
  parseResultatTable,
  parseTjänsteTable,
} from '../parse-delarsrapport'

// Golden-file test: verifierar Docling-tabellextraktion + parsning mot kända
// siffror i Intraservice delårsrapport mars 2026 (avläst manuellt från
// `pdftotext -layout`-dumpen av samma PDF, se docs/ANALYS-2026-07.md §2).
// Kräver att Docling-venv:n är installerad (packages/pipeline/python/README.md).

const FIXTURE = join(
  import.meta.dirname,
  '../__fixtures__/intraservice-delarsrapport-2026-mars.pdf',
)

describe('parse-delarsrapport (Docling-pilot)', () => {
  const { tables } = extractWithDocling(FIXTURE)

  it('hittar resultaträkningstabellen och stämmer av mot kända belopp', () => {
    const resultatTable = findResultatTable(tables)
    expect(resultatTable).toBeDefined()

    const poster = parseResultatTable(resultatTable!)
    const byNamn = Object.fromEntries(poster.map((p) => [p.namn, p]))

    expect(byNamn.Intäkter.values.utfallPeriod).toBeCloseTo(373.6)
    expect(byNamn.Kostnader.values.utfallPeriod).toBeCloseTo(-360.5)
    expect(byNamn.Kommunbidrag.values.utfallPeriod).toBeCloseTo(9.4)
    expect(byNamn.Resultat.values.utfallPeriod).toBeCloseTo(22.5)
    expect(byNamn.Resultat.values.budgetPeriod).toBeCloseTo(3.0)
    expect(byNamn.Resultat.values.avvikelsePeriod).toBeCloseTo(19.5)
  })

  it('hittar tjänstetabellen med nästlade kategorier och subtotaler', () => {
    const tjänsteTable = findTjänsteTable(tables)
    expect(tjänsteTable).toBeDefined()

    const tjänster = parseTjänsteTable(tjänsteTable!)
    const namn = tjänster.map((t) => t.tjänst)

    expect(namn).toContain('Digital infrastruktur')
    expect(namn).toContain('Total förvaltning')

    const ekonomi = tjänster.find((t) => t.tjänst === 'Ekonomi')
    expect(ekonomi?.kategori).toBe('Gemensamma tjänster')
    expect(ekonomi?.resultatPeriod).toBeCloseTo(6.8)

    const totalFörvaltning = tjänster.find((t) => t.tjänst === 'Total förvaltning')
    expect(totalFörvaltning?.ärSumma).toBe(true)
    expect(totalFörvaltning?.resultatPeriod).toBeCloseTo(26.4)
  })
})
