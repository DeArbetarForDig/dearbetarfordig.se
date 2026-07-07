import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extractWithDocling, isDoclingAvailable } from '../../lib/docling'
import {
  findHelårTjänsteTable,
  findResultatTable,
  findTjänsteTable,
  parseResultatTable,
  parseTjänsteRader,
  parseTjänsteTable,
  validateTjänsteTotalt,
} from '../parse-delarsrapport'

// Golden-file test: verifierar Docling-tabellextraktion + parsning mot kända
// siffror i Intraservice delårsrapport mars 2026 (avläst manuellt från
// `pdftotext -layout`-dumpen av samma PDF, se docs/ANALYS-2026-07.md §2).
// Kräver att Docling-venv:n är installerad (packages/pipeline/python/README.md)
// — en tung ML-beroende (torch m.fl.) som inte provisioneras i CI.
//
// Gated med ett vanligt `if`, inte `describe.skipIf`: skipIf hoppar bara
// över de enskilda `it`-blocken men kör ändå hela suite-kroppen, vilket
// kraschade `extractWithDocling(FIXTURE)`-anropet nedan innan något test
// ens hann skippas (se CI-felet som hittade detta).

const FIXTURE = join(
  import.meta.dirname,
  '../__fixtures__/intraservice-delarsrapport-2026-mars.pdf',
)

if (isDoclingAvailable()) {
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

    it('avstämningen mot period-tabellens Totalt-rad är tyst (den stämmer)', () => {
      const tjänsteTable = findTjänsteTable(tables)
      const varning = vi.spyOn(console, 'warn').mockImplementation(() => {})

      validateTjänsteTotalt(parseTjänsteRader(tjänsteTable!), 'period')

      expect(varning).not.toHaveBeenCalled()
      varning.mockRestore()
    })

    it('fångar det verkliga felet i helår-tabellens Totalt-rad (felvänd Intäkter)', () => {
      const helårTjänsteTable = findHelårTjänsteTable(tables)
      expect(helårTjänsteTable).toBeDefined()

      const varning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      validateTjänsteTotalt(parseTjänsteRader(helårTjänsteTable!), 'helår')

      // Källdokumentets Totalt-rad har fel tecken på Intäkter (kolumn 1) — kostnader,
      // budget, resultat och avvikelse i samma rad stämmer. Se docs/FUTURE.md.
      expect(varning).toHaveBeenCalledTimes(1)
      expect(varning.mock.calls[0][0]).toContain('kolumn 1')
      varning.mockRestore()
    })
  })
} else {
  describe.skip('parse-delarsrapport (Docling-pilot) — Docling-venv saknas, se packages/pipeline/python/README.md', () => {})
}
