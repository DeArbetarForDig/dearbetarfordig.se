import { describe, expect, it } from 'vitest'
import { parseDriftredovisning, parseKommunbidrag, slug } from '../parse-ekonomi-molndal'

// Utdrag ur Mölndals budget 2025–2027 (pdftotext -layout): fotnotssiffror
// sitter ihop med talen ("471,51", "4 981,12"), högerspalt med brödtext.
const BUDGET = `
  Totalt kommunbidrag per nämnd, tabell 4
  Mnkr                                             2024          2025        procent
  Byggnadsnämnden                                   24,9          26,8            7,6
                                                                                          fem åren och har ha
  Kommunfullmäktige och kommunstyrelsen           384,8         471,51           22,5     Under åren 2022 oc
  Skolnämnden                                   1 742,2        1 833,3            5,2
  Summa                                         2 151,9       2 331,62            6,0     lägre investeringst
`

// Utdrag ur årsredovisning 2025, "Driftredovisning kommun"
const DRIFT = `
Driftredovisning kommun
                                                        Intäkter Kostnader             Utfall       Intäkter Kostnader              Utfall      Budget       Resultat       Resultat
Mnkr                                                       2024       2024             2024            2025       2025              2025          2025          2025          andel
Byggnadsnämnden                                            24,5           -54,8        -30,3            27,1          -53,9        -26,8           25,7           -1,1         -4,3%
Skolnämnden                                               243,3        -1 992,4     -1 749,1           260,7       -2 037,3     -1 776,6        1 775,7           -0,9         -0,1%
Summa nämndverksamhet                                     267,8        -2 047,2     -1 779,4           287,8       -2 091,2     -1 803,4        1 801,4           -2,0         -0,1%
`

describe('parseKommunbidrag', () => {
  it('läser budgetårets kolumn och ignorerar fotnotssiffror', () => {
    expect(parseKommunbidrag(BUDGET)).toEqual({
      rader: [
        { namn: 'Byggnadsnämnden', föregående: 24.9, budget: 26.8 },
        { namn: 'Kommunfullmäktige och kommunstyrelsen', föregående: 384.8, budget: 471.5 },
        { namn: 'Skolnämnden', föregående: 1742.2, budget: 1833.3 },
      ],
      summa: 2331.6,
    })
  })
})

describe('parseDriftredovisning', () => {
  it('läser redovisningsårets intäkter, kostnader, budget och resultat', () => {
    expect(parseDriftredovisning(DRIFT)).toEqual([
      {
        nämnd: 'Byggnadsnämnden',
        intäkter: 27.1,
        kostnader: -53.9,
        utfall: -26.8,
        budget: 25.7,
        resultat: -1.1,
      },
      {
        nämnd: 'Skolnämnden',
        intäkter: 260.7,
        kostnader: -2037.3,
        utfall: -1776.6,
        budget: 1775.7,
        resultat: -0.9,
      },
    ])
  })

  it('kastar när raderna inte summerar till Summa-raden', () => {
    expect(() => parseDriftredovisning(DRIFT.replace('-2,0  ', '-9,0  '))).toThrow(/summerar/)
  })
})

describe('slug', () => {
  it('ger samma id-form som Göteborgs budgetgraf', () => {
    expect(slug('Kultur- och fritidsnämnden')).toBe('kultur-och-fritidsnämnden')
  })
})
