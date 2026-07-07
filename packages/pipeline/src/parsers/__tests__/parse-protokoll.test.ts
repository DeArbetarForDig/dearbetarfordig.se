/**
 * Golden-tester för KF-protokollparsern (docs/ANALYS-2026-07.md, punkt 5).
 * Fixturerna speglar de verkliga formaten som knäckte parsern i punkt 18:
 * gamla protokoll blandar "§ 15 1435/22" med nakna "§ 14" för procedur-
 * punkter, sidbrytningar ger "forts."-huvuden och upprepade §-huvuden.
 */

import { describe, expect, it } from 'vitest'
import { parseParagrafer } from '../parse-protokoll.js'

const GAMMALT_FORMAT = `Göteborgs Stad kommunfullmäktige protokoll
§1
Upprop
Kommunfullmäktige genomför upprop.

§ 2
Bestämmande av tid för justering
Beslut
Protokollet justeras den 9 mars 2023.

§ 14
Avsägelse av Julia Lundell (S)
Beslut
Avsägelsen godkänns och har bifallits.

§ 15 1435/22
Genomförandeavtal avseende detaljplan för bostäder
Beslut
Enligt kommunstyrelsens förslag har bifallits.

§ 16 1379/22
Antagande av detaljplan för bostäder, verksamheter
Tidigare behandling
Bordlagd den 26 januari 2023, § 29.
Beslut
Kommunfullmäktige beslutar om ärendets återremiss.
Omröstningen utfaller med 65 Ja mot 9 Nej.

§ 16 1379/22 forts.
Justering
Protokollet under denna paragraf förklaras omedelbart justerat.

§ 17 1317/22
Motion av Testperson (X) om testning
Beslut
har avslagits.

§ 17 1317/22
Reservation
Ledamöterna i (X) reserverar sig mot beslutet.
`

const NYTT_FORMAT = `Göteborgs Stad kommunfullmäktige protokoll
§ 169 Ärendenummer SLK-2026-00015
Avsägelse av testledamot
Beslut
Avsägelsen har bifallits.
Hänvisning till tidigare § 121.
§ 121.
är sedan tidigare avgjord.
§ 170 Ärendenummer SLK-2026-00001
Fråga om testärende
Beslut
har bifallits.
`

describe('parseParagrafer — gammalt format (2023–2024)', () => {
  const { nodes, edges } = parseParagrafer(GAMMALT_FORMAT, '2023-02-23')
  const paragrafer = nodes.filter((n) => n.typ === 'paragraf')
  const byId = new Map(paragrafer.map((n) => [n.id, n]))

  it('emitterar ALLA §§ — även nakna procedurpunkter utan ärendenummer', () => {
    const nummer = paragrafer.map((n) => String(n.data.paragrafNr)).sort((a, b) => +a - +b)
    expect(nummer).toEqual(['1', '2', '14', '15', '16', '17'])
  })

  it('skapar inga dubbla noder för upprepade §-huvuden', () => {
    const ids = paragrafer.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('mergear forts.-innehåll in i huvudparagrafen i stället för att tappa det', () => {
    const p16 = byId.get('kf-2023-02-23-§16')
    expect(p16).toBeDefined()
    expect(p16?.data.rubrik).toContain('Antagande av detaljplan')
    expect(p16?.data.fulltext).toContain('omedelbart justerat')
  })

  it('mergear upprepat §-huvud utan forts.-markör (§17 två gånger)', () => {
    const p17 = byId.get('kf-2023-02-23-§17')
    expect(p17?.data.rubrik).toContain('Motion av Testperson')
    expect(p17?.data.fulltext).toContain('reserverar sig')
  })

  it('resolvar bordlagd_från till exakt datum-id, inte kf-*-wildcard', () => {
    const bord = edges.filter((e) => e.typ === 'bordlagd_från')
    expect(bord).toHaveLength(1)
    expect(bord[0].from).toBe('kf-2023-02-23-§16')
    expect(bord[0].to).toBe('kf-2023-01-26-§29')
  })

  it('extraherar votering och beslut', () => {
    const p16 = byId.get('kf-2023-02-23-§16')
    expect(p16?.data.votering).toEqual({ ja: 65, nej: 9 })
    expect(p16?.data.beslut).toBe('återremiss')
  })
})

describe('parseParagrafer — nytt format (2025+)', () => {
  const { nodes } = parseParagrafer(NYTT_FORMAT, '2026-05-28')
  const paragrafer = nodes.filter((n) => n.typ === 'paragraf')

  it('emitterar §§ med SLK-ärendenummer', () => {
    expect(paragrafer.map((n) => n.data.paragrafNr).sort()).toEqual(['169', '170'])
    expect(paragrafer.find((n) => n.data.paragrafNr === '169')?.data.ärendeNr).toBe(
      'SLK-2026-00015',
    )
  })

  it('§-referens med punkt ("§ 121.") i löptext blir INTE en egen nod', () => {
    expect(paragrafer.some((n) => n.data.paragrafNr === '121')).toBe(false)
  })
})
