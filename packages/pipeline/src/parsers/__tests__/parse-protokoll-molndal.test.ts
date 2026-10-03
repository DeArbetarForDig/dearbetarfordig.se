import { describe, expect, it } from 'vitest'
import {
  diarienummer,
  klassificera,
  parseNärvaro,
  parseOmröstningslistor,
  parseParagrafer,
} from '../parse-protokoll-molndal'

// Utdrag ur Mölndals protokollmall (pdftotext -layout). Innehållsförteckningen
// har diarienumret direkt efter §, brödtexten långt ut till höger.
const PROTOKOLL = `
Beslutande             Ledamöter
                       Per Malm (M), ordförande
                       Emil Forsberg (S) ersätter Elpida Georgitsi (S)
                       Shahla Alamshahi (S) ersätter Kåre Widenqvist (S) §§ 150-160
Ersättare              Anna Andersson (S)

 Innehållsförteckning
            § 81 Dnr 00123/20212.6.
                    Plan för laddinfrastruktur ................................ 35
            § 82 Diarienummer 00322/2026
                    Svar på motion (SD) - ISO-certifiering i arbetsmiljö ....... 21

 § 81                                                 Dnr 00123/20212.6.
 Plan för laddinfrastruktur
 Beslut
 Kommunstyrelsens förslag till kommunfullmäktige
 Kommunfullmäktige beviljar ett näringsbidrag om 1,5 miljoner kronor.
 Ärendet
 Bakgrund.

 § 82                                                 Diarienummer 00322/2026
 Svar på motion (SD) - ISO-certifiering i arbetsmiljö
 Beslut
 Kommunfullmäktige avslår motionen.
 Reservationer
 Ledamöterna från Sverigedemokraterna reserverar sig mot beslutet.
 Omröstning begärs
 Ordföranden meddelar följande omröstningsordning:
 Ja-röst för Lennart Jonssons (SD) förslag,
 Nej-röst för kommunstyrelsens förslag.
 Omröstningsresultat
 5 Ja-röster, 54 Nej-röster och 2 frånvarande ledamöter.
 Ordföranden meddelar följande omröstningsordning:
 Ja-röst för att anta tilläggsförslaget
 Nej-röst för att avslå tilläggsförslaget
 Omröstningsresultat
 Med 25 ja-röster och 36 nej-röster beslutar kommunfullmäktige avslå tilläggsförslaget.

                                                 Omröstningslista nr. 1
                               § 82. Svar på motion (SD) - ISO-certifiering i arbetsmiljö
                           Ledamöter           Parti          Ersättare          Ja   Nej      Avst   Frånv
                     Stefan Gustafsson          (S)                                    X
                       Elpida Georgitsi         (S)         Emil Forsberg              X
                                           Transport:                             0     2       0       0
                                                 Omröstningslista nr. 1
                               § 82. Svar på motion (SD) - ISO-certifiering i arbetsmiljö
                           Ledamöter           Parti          Ersättare          Ja   Nej      Avst   Frånv
                        Lennart Jonsson          (SD)                               X
                        Jan Jacobsson          (SD)                                                    X
                                                 Omröstningslista nr. 2
                               § 82. Svar på motion (SD) - ISO-certifiering i arbetsmiljö
                           Ledamöter           Parti          Ersättare          Ja   Nej      Avst   Frånv
                     Stefan Gustafsson          (S)                                    X
`

describe('parseParagrafer', () => {
  const [p81, p82] = parseParagrafer(PROTOKOLL, 'ks')

  it('hoppar över innehållsförteckningen och läser rubrik och diarienummer', () => {
    expect(parseParagrafer(PROTOKOLL, 'ks').map((p) => p.nr)).toEqual(['81', '82'])
    expect(p81.ärendeNr).toBe('00123/2021')
    expect(p81.rubrik).toBe('Plan för laddinfrastruktur')
  })

  it('tar med KS förslag till KF i beslutet och klassar det som tillstyrkan', () => {
    expect(p81.beslutstext).toMatch(
      /^Kommunstyrelsens förslag till kommunfullmäktige Kommunfullmäktige beviljar/,
    )
    expect(p81.beslut).toBe('tillstyrkan_kf')
  })

  it('läser flera voteringar i samma paragraf, huvudvoteringen först', () => {
    expect(p82.beslut).toBe('avslag')
    expect(p82.reservationer).toHaveLength(1)
    expect(p82.voteringar).toHaveLength(2)
    expect(p82.votering).toEqual({
      ja: 5,
      nej: 54,
      avstår: 0,
      frånvarande: 2,
      jaBetyder: 'Lennart Jonssons (SD) förslag',
      nejBetyder: 'kommunstyrelsens förslag',
      proposition: 'Ja för Lennart Jonssons (SD) förslag, Nej för kommunstyrelsens förslag.',
    })
    expect(p82.voteringar[1]).toMatchObject({ ja: 25, nej: 36 })
  })
})

describe('parseOmröstningslistor', () => {
  it('följer listan över sidbrytning, låter ersättaren rösta och hoppar över lista 2', () => {
    expect(parseOmröstningslistor(PROTOKOLL)).toEqual([
      { paragrafNr: '82', namn: 'Stefan Gustafsson', parti: 'S', röst: 'nej' },
      { paragrafNr: '82', namn: 'Emil Forsberg', parti: 'S', röst: 'nej' },
      { paragrafNr: '82', namn: 'Lennart Jonsson', parti: 'SD', röst: 'ja' },
      { paragrafNr: '82', namn: 'Jan Jacobsson', parti: 'SD', röst: 'frånvarande' },
    ])
  })
})

describe('parseNärvaro', () => {
  it('läser tjänstgörande ledamöter och vem ersättaren ersätter', () => {
    expect(parseNärvaro(PROTOKOLL)).toEqual([
      { namn: 'Per Malm', parti: 'M', roll: 'ordförande', ersätter: undefined },
      { namn: 'Emil Forsberg', parti: 'S', roll: undefined, ersätter: 'Elpida Georgitsi' },
      { namn: 'Shahla Alamshahi', parti: 'S', roll: undefined, ersätter: 'Kåre Widenqvist' },
    ])
  })
})

describe('hjälpfunktioner', () => {
  it('diarienummer tar bort ihopklistrad klassificering', () => {
    expect(diarienummer('00123/20212.6.')).toBe('00123/2021')
    expect(diarienummer('116159')).toBe('116159')
  })

  it('klassificera', () => {
    expect(klassificera('Motionen återremitteras till kommunstyrelsen.', 'kf')).toBe('återremiss')
    expect(klassificera('Frågan anses besvarad.', 'kf')).toBe('beslut')
    expect(klassificera('', 'ks')).toBe('beslut')
    expect(klassificera('Kommunfullmäktige antar planen.', 'kf')).toBe('bifall')
  })
})
