import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFile } from '../parse-revisionsrapport'

// Golden-file test: Stadsrevisionens rapportsammandrag "Användning av
// verksamhetsfordon samt inköp av drivmedel" (data/revision/) — den
// "Sammanfattande bedömning"-mallen, med två rekommendationer i den
// grammatiska formen "X rekommenderar Y att …". Förväntade värden avlästa
// manuellt från `pdftotext -layout`-dumpen av samma PDF.
const FIXTURE = join(import.meta.dirname, '../__fixtures__/revision-verksamhetsfordon.pdf')

describe('parse-revisionsrapport', () => {
  const node = parseFile(FIXTURE, 'Stadsrevisionens_rapportsammandrag_Anvandning.pdf')

  it('extraherar ämnesmeningen som titel, inte det generiska titelblocket', () => {
    expect(node).not.toBeNull()
    expect(node!.label).toBe('Användning av verksamhetsfordon samt inköp av drivmedel')
    expect(node!.id).toBe('revision-användning-av-verksamhetsfordon-samt-inköp-av-drivmedel')
  })

  it('extraherar sammanfattningen utan titelblock/sidfot-skräp', () => {
    const sammanfattning = node!.data.sammanfattning as string
    expect(sammanfattning.startsWith('Stadsrevisionen har granskat användning')).toBe(true)
    expect(sammanfattning).not.toContain('Rapportsammandrag')
    expect(sammanfattning).not.toContain('Sammanfattande bedömning')
    expect(sammanfattning.endsWith('.')).toBe(true)
  })

  it('extraherar båda rekommendationerna med korrekt mottagare', () => {
    const rekommendationer = node!.data.rekommendationer as Array<{
      mottagare: string
      text: string
    }>
    expect(rekommendationer).toHaveLength(2)
    expect(rekommendationer[0].mottagare).toBe('socialnämnd Sydväst')
    expect(rekommendationer[0].text).toContain('förvaltningsövergripande rutiner')
    expect(rekommendationer[1].mottagare).toBe('Göteborg Energi AB')
    expect(rekommendationer[1].text).toContain('koncernövergripande rutiner')
  })

  it('sätter källa till det ursprungliga filnamnet', () => {
    expect(node!.data.källa).toBe('Stadsrevisionens_rapportsammandrag_Anvandning.pdf')
  })
})
