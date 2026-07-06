import { describe, expect, it } from 'vitest'
import { type Utterance, detectProcedurella } from '../db/mark-procedurella.js'

let seq = 0
function u(datum: string, ärende: number, talare: string, textLen: number): Utterance {
  return { key: `u${seq++}`, datum, ärende, talare, textLen }
}

describe('detectProcedurella', () => {
  it('markerar mötesledaren som varvar korta inlägg mellan riktiga anföranden', () => {
    // Mönstret från kf-2026-05-28 ärende 29: ordföranden (~50% av inläggen,
    // 23–205 tecken) mellan varje riktigt anförande (300–2000 tecken)
    const inlägg = [
      u('2026-05-28', 29, 'Ordf', 381),
      u('2026-05-28', 29, 'Axel', 1535),
      u('2026-05-28', 29, 'Ordf', 70),
      u('2026-05-28', 29, 'Ann', 1829),
      u('2026-05-28', 29, 'Ordf', 49),
      u('2026-05-28', 29, 'Hans', 1815),
      u('2026-05-28', 29, 'Ordf', 23),
      u('2026-05-28', 29, 'Axel', 958),
      u('2026-05-28', 29, 'Ordf', 40),
      u('2026-05-28', 29, 'Hans', 1052),
    ]
    const marked = detectProcedurella(inlägg)
    const ordfKeys = inlägg.filter((x) => x.talare === 'Ordf').map((x) => x.key)
    expect([...marked].sort()).toEqual(ordfKeys.sort())
  })

  it('markerar INTE ett kort replikskifte mellan två debattörer', () => {
    // Två talare som växlar korta repliker — utan en tredje röst finns ingen
    // mötesledare att detektera, ingen ska markeras
    const inlägg = [
      u('2026-05-28', 12, 'Anna', 156),
      u('2026-05-28', 12, 'Björn', 270),
      u('2026-05-28', 12, 'Anna', 137),
      u('2026-05-28', 12, 'Björn', 210),
      u('2026-05-28', 12, 'Anna', 190),
      u('2026-05-28', 12, 'Björn', 165),
    ]
    expect(detectProcedurella(inlägg).size).toBe(0)
  })

  it('markerar INTE en debattör med långa anföranden även vid hög andel', () => {
    const inlägg = [
      u('2026-05-28', 7, 'Flitig', 1400),
      u('2026-05-28', 7, 'Flitig', 900),
      u('2026-05-28', 7, 'Flitig', 1100),
      u('2026-05-28', 7, 'Annan', 800),
      u('2026-05-28', 7, 'Tredje', 600),
    ]
    expect(detectProcedurella(inlägg).size).toBe(0)
  })

  it('markerar ensam-talare-ärenden (justering, upprop) för en redan detekterad mötesledare', () => {
    const debattärende = [
      u('2026-05-28', 29, 'Ordf', 50),
      u('2026-05-28', 29, 'A', 1000),
      u('2026-05-28', 29, 'Ordf', 60),
      u('2026-05-28', 29, 'B', 1200),
      u('2026-05-28', 29, 'Ordf', 45),
      u('2026-05-28', 29, 'C', 900),
    ]
    const justering = [u('2026-05-28', 1, 'Ordf', 229)]
    const eget = [u('2026-05-28', 2, 'Ledamot', 400)]
    const marked = detectProcedurella([...debattärende, ...justering, ...eget])
    expect(marked.has(justering[0].key)).toBe(true)
    expect(marked.has(eget[0].key)).toBe(false)
  })

  it('markerar INTE ensam-talare-ärenden med långa texter (interpellationssvar)', () => {
    const debattärende = [
      u('2026-05-28', 29, 'Ordf', 50),
      u('2026-05-28', 29, 'A', 1000),
      u('2026-05-28', 29, 'Ordf', 60),
      u('2026-05-28', 29, 'B', 1200),
      u('2026-05-28', 29, 'Ordf', 45),
      u('2026-05-28', 29, 'C', 900),
    ]
    const långtSolo = [u('2026-05-28', 3, 'Ordf', 2400)]
    const marked = detectProcedurella([...debattärende, ...långtSolo])
    expect(marked.has(långtSolo[0].key)).toBe(false)
  })

  it('detekterar mötesledare per datum — inte över datumgränser', () => {
    // Ordf leder 2026-05-28 men är vanlig debattör 2026-06-11: solo-regeln
    // får inte spilla över till andra datum
    const dag1 = [
      u('2026-05-28', 29, 'Ordf', 50),
      u('2026-05-28', 29, 'A', 1000),
      u('2026-05-28', 29, 'Ordf', 60),
      u('2026-05-28', 29, 'B', 1200),
      u('2026-05-28', 29, 'Ordf', 45),
      u('2026-05-28', 29, 'C', 900),
    ]
    const dag2Solo = [u('2026-06-11', 1, 'Ordf', 300)]
    const marked = detectProcedurella([...dag1, ...dag2Solo])
    expect(marked.has(dag2Solo[0].key)).toBe(false)
  })

  it('hanterar ordföranderotation i maratonärenden — ingen ledare når 35% men var och en dominerar', () => {
    // Mönstret från budgetdebatten 2025-11-06 ärende 8: 690 inlägg, Akbas 30%
    // (median 90), Eriksson 22% (median 77), flitigaste riktiga debattör 19
    // inlägg (median 939). Här nedskalat: två roterande ledare på ~25% var,
    // debattörer med max 2 långa inlägg.
    const inlägg = [
      u('2026-05-28', 30, 'Ordf1', 50),
      u('2026-05-28', 30, 'A', 1000),
      u('2026-05-28', 30, 'Ordf1', 60),
      u('2026-05-28', 30, 'B', 1200),
      u('2026-05-28', 30, 'Ordf1', 45),
      u('2026-05-28', 30, 'A', 950),
      u('2026-05-28', 30, 'Ordf1', 30),
      u('2026-05-28', 30, 'C', 700),
      u('2026-05-28', 30, 'Ordf1', 80),
      u('2026-05-28', 30, 'Ordf2', 55),
      u('2026-05-28', 30, 'C', 900),
      u('2026-05-28', 30, 'Ordf2', 40),
      u('2026-05-28', 30, 'D', 800),
      u('2026-05-28', 30, 'Ordf2', 70),
      u('2026-05-28', 30, 'B', 1100),
      u('2026-05-28', 30, 'Ordf2', 35),
      u('2026-05-28', 30, 'D', 850),
      u('2026-05-28', 30, 'Ordf2', 90),
    ]
    const marked = detectProcedurella(inlägg)
    const ledarKeys = inlägg.filter((x) => x.talare.startsWith('Ordf')).map((x) => x.key)
    expect([...marked].sort()).toEqual(ledarKeys.sort())
  })
})
