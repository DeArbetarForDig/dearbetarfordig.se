/**
 * Golden-tester för voteringsbilaga-parsern (docs/ANALYS-2026-07.md,
 * punkt 5/18/19). Fixturerna speglar de tre verkliga tabellformaten och
 * §-matchningsfallen som knäckte den gamla versionen.
 */

import { describe, expect, it } from 'vitest'
import { findParagraf, parseBilagorText, syntetisktId } from '../parse-voteringar.js'

const NYTT_FORMAT = `Göteborgs Stad kommunfullmäktige protokoll

Bilaga 2
Ärende: 8:1
Ärendemening: Redovisning av uppdrag om modell för lekvärdesfaktorer
Antal Ja: 2
Antal Nej: 1
Antal Avstår: 0
Antal Frånv: 0
Resultat
Aslan Akbas                       S                1        Ordförande         Ja
Robert Andersson                  S               22        Ledamot            Ja
Hammarstrand
Jörgen Fogelklou                  SD              72        Ledamot            Nej

Bilaga 3
Ärende: 9
Ärendemening: Testärende med tvåradigt namn
Antal Ja: 1
Antal Nej: 0
Antal Avstår: 0
Antal Frånv: 0
Resultat
Robert Andersson
Hammarstrand                      S               22        Ledamot            Ja
`

const GAMMALT_FORMAT = `Göteborgs Stad kommunfullmäktige Protokoll (nr 2)

                                                                                    BILAGA 2
Ärende: 14
Ärendemening: Genomförandeavtal avseende detaljplan för bostäder,
Antal Ja: 2
Antal Nej: 1
Antal Avstår: 0
Antal Frånv: 0
Resultat
               Aslan Akbas                      S                         1 Ordförande          Ja
               Robert Andersson Hammarstrand S                           22 Ledamot             Ja
               Sanda Anton Henriksson           SD                       72 Ersättare           Nej
`

describe('parseBilagorText — nytt format (radstart "Bilaga N", flerspaltiga kolumner)', () => {
  const bilagor = parseBilagorText(NYTT_FORMAT)

  it('splittar per bilaga och läser tally', () => {
    expect(bilagor).toHaveLength(2)
    expect(bilagor[0].ärende).toBe('8:1')
    expect(bilagor[0].bas).toBe('8')
    expect(bilagor[0].antal).toEqual({ ja: 2, nej: 1, avstår: 0, frånvarande: 0 })
  })

  it('efternamn radbrutet EFTER sin röstrad förorenar inte nästa person ("bara"-nyckeln)', () => {
    const jörgen = bilagor[0].röster[2]
    expect(jörgen.namn).toBe('Hammarstrand Jörgen Fogelklou') // rå ihopklistring
    expect(jörgen.bara).toBe('Jörgen Fogelklou') // rätt nyckel
    expect(jörgen.röst).toBe('nej')
  })

  it('tvåradigt namn FÖRE röstraden sätts ihop', () => {
    expect(bilagor[1].röster[0].namn).toBe('Robert Andersson Hammarstrand')
  })
})

describe('parseBilagorText — gammalt format (indenterad VERSAL "BILAGA", enkelspaltseparatorer)', () => {
  const bilagor = parseBilagorText(GAMMALT_FORMAT)

  it('hittar bilagan trots versal indenterad rubrik', () => {
    expect(bilagor).toHaveLength(1)
    expect(bilagor[0].ärende).toBe('14')
  })

  it('parsar rader med enkla mellanslag och namn hopklämt mot partikolumnen', () => {
    const namn = bilagor[0].röster.map((r) => r.namn)
    expect(namn).toContain('Aslan Akbas')
    expect(namn).toContain('Robert Andersson Hammarstrand')
    expect(namn).toContain('Sanda Anton Henriksson')
  })
})

describe('parseBilagorText — skyddsräcken', () => {
  it('vägrar (throw) när rösträderna överstiger bilagans egen tally — hopklistrade tabeller', () => {
    const trasig = GAMMALT_FORMAT.replace('Antal Ja: 2', 'Antal Ja: 1')
    expect(() => parseBilagorText(trasig)).toThrow(/rösträder men tally/)
  })
})

describe('findParagraf — bilaga-ärendemening → §-nod', () => {
  const antal = { ja: 43, nej: 38, avstår: 0, frånvarande: 0 }

  it('skiljer ärenden med lång gemensam prefix (full överlapp, inte fast cap)', () => {
    const paragrafer = [
      {
        id: '§332',
        rubrik: 'Motion av Axel Darvik (L) och Eva Flyborg (L) om att skydda barn från våld',
        fulltext: '',
      },
      {
        id: '§348',
        rubrik:
          'Motion av Axel Darvik (L) och Eva Flyborg (L) om att införa ett detekteringssystem',
        fulltext: '',
      },
    ]
    const träff = findParagraf(
      'Motion av Axel Darvik (L) och Eva Flyborg (L) om att skydda barn',
      antal,
      paragrafer,
    )
    expect(träff?.id).toBe('§332')
  })

  it('accepterar kort rubrik via exakt likhet ("Frågestund")', () => {
    const träff = findParagraf('Frågestund', antal, [
      { id: '§2', rubrik: 'Frågestund', fulltext: '' },
      { id: '§3', rubrik: 'Interpellation om testfråga', fulltext: '' },
    ])
    expect(träff?.id).toBe('§2')
  })

  it('överlever pdftotext-tappade bindestreck (Sundén-Andersson → SundénAndersson)', () => {
    const träff = findParagraf(
      'Motion av Mariette Höij Risberg (D), Lisbeth Sundén-Andersso',
      antal,
      [
        {
          id: '§393',
          rubrik: 'Motion av Mariette Höij Risberg (D), Lisbeth SundénAndersson om test',
          fulltext: '',
        },
      ],
    )
    expect(träff?.id).toBe('§393')
  })

  it('faller tillbaka på unikt fulltext-innehåll när rubriken är tom (procedur-§§)', () => {
    const paragrafer = [
      {
        id: '§13',
        rubrik: '',
        fulltext: 'Handlingsplan för att inga områden ska vara särskilt utsatta behandlas.',
      },
      { id: '§8', rubrik: 'Annat ärende', fulltext: 'Något helt annat.' },
    ]
    const träff = findParagraf(
      'Handlingsplan för att inga områden ska vara särskilt utsatta',
      antal,
      paragrafer,
    )
    expect(träff?.id).toBe('§13')
  })

  it('ger upp (null) hellre än att gissa när fulltext-fallbacken inte är unik', () => {
    const paragrafer = [
      { id: '§1', rubrik: '', fulltext: 'Gemensam text om handlingsplan för områden.' },
      { id: '§2', rubrik: '', fulltext: 'Gemensam text om handlingsplan för områden igen.' },
    ]
    expect(findParagraf('handlingsplan för områden', antal, paragrafer)).toBeNull()
  })

  it('disambiguerar samma rubrik på flera §§ via bilagans exakta tally i §-texten', () => {
    const paragrafer = [
      {
        id: '§26',
        rubrik: 'Hemställan från nämnden om testfråga',
        fulltext: 'Omröstningen utfaller med 32 Ja mot 35 Nej.',
      },
      {
        id: '§27',
        rubrik: 'Hemställan från nämnden om testfråga',
        fulltext: 'Omröstningen utfaller med 43 Ja mot 38 Nej.',
      },
    ]
    const träff = findParagraf('Hemställan från nämnden om testfråga', antal, paragrafer)
    expect(träff?.id).toBe('§27')
    expect(träff?.ambiguous).toBe(false)
  })
})

describe('syntetisktId — deterministiska uuid för syntetiserade historiska personer', () => {
  it('samma namn ger samma id över körningar, olika namn olika', () => {
    expect(syntetisktId('Linnea Wikström')).toBe(syntetisktId('Linnea Wikström'))
    expect(syntetisktId('Linnea Wikström')).toBe(syntetisktId('linnea wikström'))
    expect(syntetisktId('Linnea Wikström')).not.toBe(syntetisktId('Alfred Johansson'))
  })

  it('formatet är ett giltigt uuid (Postgres UUID-kolumn)', () => {
    expect(syntetisktId('Test Person')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
