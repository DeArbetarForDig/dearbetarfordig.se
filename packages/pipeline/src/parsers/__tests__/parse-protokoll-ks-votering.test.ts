import { describe, expect, it } from 'vitest'
import { parseOmröstningar } from '../parse-protokoll-ks'

// Golden-file test: verifierar Omröstning-parsningen mot verklig text ur
// KS-protokoll (rå pdftotext-utdata, inklusive sidhuvud-skräp där det
// faktiskt förekommer) — se docs/SPEC-KS-VOTERINGAR.md.

describe('parseOmröstningar', () => {
  it('§478 (KS 2026-06-17): Ja=avslag, ersättaren+ordföranden, typographic kavychar', () => {
    const text = `
Omröstning

Godkänd voteringsproposition: ”Ja för avslag och Nej för bifall till yrkandet från
L, M, D, KD och SD.”
Daniel Bernmar (V), Viktoria Tryggvadottir Rolka (S), Blerta Hoti Singh (S),
Jenny Broman (V), Karin Pleijel (MP), tjänstgörande ersättaren Johannes Hulter (S) och
ordföranden Jonas Attenius (S) röstar Ja (7).
Axel Josefson (M), Hampus Magnusson (M), Martin Wannholt (D),
Jörgen Fogelklou (SD), Axel Darvik (L) och Dan-Ove Marcelind (KD) röstar Nej (6).

Protokollsanteckning

Representanterna från MP, S och V antecknar som yttrande en skrivelse från
den 16 juni 2026.`

    const [votering] = parseOmröstningar(text, 'ks-2026-06-17-§478')
    expect(votering).toBeDefined()
    expect(votering.ja).toBe(7)
    expect(votering.nej).toBe(6)
    expect(votering.avstår).toBe(0)
    expect(votering.jaBetyder).toBe('avslag')
    expect(votering.nejBetyder).toBe('bifall')
    expect(votering.verified).toBe(true)
    expect(votering.röster).toHaveLength(13)

    const attenius = votering.röster.find((r) => r.namn === 'Jonas Attenius')
    expect(attenius).toMatchObject({ parti: 'S', röst: 'ja' })
    const marcelind = votering.röster.find((r) => r.namn === 'Dan-Ove Marcelind')
    expect(marcelind).toMatchObject({ parti: 'KD', röst: 'nej' })
  })

  it('duell mellan två yrkanden: "Ja för bifall till X... Nej för bifall till Y" + sidhuvud mitt i sektionen', () => {
    // Sidhuvud-skräp ("Göteborgs Stad Kommunstyrelsen protokoll", sidnummer,
    // "Kommunstyrelsen", "Protokoll nr/Sammanträdesdatum") hamnar HÄR mellan
    // rubriken "Omröstning" och "Godkänd voteringsproposition" i den riktiga
    // PDF:en (variation 11 i spec) — testar att ankringen på
    // "Godkänd voteringsproposition:" är robust mot det.
    const text = `
Propositionsordning

Ordföranden Jonas Attenius (S) ställer propositioner på yrkandena och finner att det egna
yrkandet bifallits. Omröstning begärs.

Göteborgs Stad Kommunstyrelsen protokoll

19 (58)

Kommunstyrelsen

Omröstning

Protokoll nr 11
Sammanträdesdatum: 2024-04-10

Godkänd voteringsproposition: "Ja för bifall till Jonas Attenius yrkande och Nej för bifall
till Axel Darviks yrkande."
Daniel Bernmar (V), Viktoria Tryggvadottir Rolka (S), Ingrid Andreae (S), Marina
Johansson (S), Karin Pleijel (MP), tjänstgörande ersättaren Marie Brynolfsson (V) och
ordföranden Jonas Attenius (S) röstar Ja (7).
Axel Darvik (L) röstar Nej (1).
Axel Josefson (M), Hampus Magnusson (M), Martin Wannholt (D), Jörgen Fogelklou (SD)
och tjänstgörande ersättaren Nina Miskovsky (M) avstår från att rösta (5).

Protokollsanteckningar`

    const [votering] = parseOmröstningar(text, 'ks-2024-04-10-§286')
    expect(votering).toBeDefined()
    expect(votering.ja).toBe(7)
    expect(votering.nej).toBe(1)
    expect(votering.avstår).toBe(5)
    expect(votering.jaBetyder).toBe('bifall: Jonas Attenius yrkande')
    expect(votering.nejBetyder).toBe('bifall: Axel Darviks yrkande')
    expect(votering.verified).toBe(true)
    expect(votering.röster).toHaveLength(13)
  })

  it('avstår + "ersättarna" (plural) + "samt" + radbrytning mitt i namn + saknad partibeteckning', () => {
    const text = `
Propositionsordning

Ordföranden Jonas Attenius (S) ställer propositioner på yrkandena och finner att det egna
yrkandet bifallits.

Omröstning

Godkänd voteringsproposition: "Ja för bifall till Jonas Attenius yrkande och Nej för bifall
till Axel Darviks och Martin Wannholts yrkande."
Daniel Bernmar (V), Viktoria Tryggvadottir Rolka (S), Marina Johansson (S), Karin
Pleijel (MP), tjänstgörande ersättarna Johannes Hulter (S) och Marie Brynolfsson (V)
samt ordföranden Jonas Attenius röstar Ja (7).
Martin Wannholt (D), Jörgen Fogelklou (SD), Axel Darvik (L) och Elisabet Lann (KD)
röstar Nej (4).
Axel Josefson (M) och Hampus Magnusson (M) avstår från att rösta (2).

Göteborgs Stad Kommunstyrelsen protokoll

49 (62)

Kommunstyrelsen`

    const [votering] = parseOmröstningar(text, 'ks-2024-04-24-§366')
    expect(votering).toBeDefined()
    expect(votering.ja).toBe(7)
    expect(votering.nej).toBe(4)
    expect(votering.avstår).toBe(2)
    expect(votering.verified).toBe(true)
    expect(votering.röster).toHaveLength(13)

    // "Karin\nPleijel (MP)" — radbruten mitt i namnet
    expect(votering.röster.find((r) => r.namn === 'Karin Pleijel')).toMatchObject({
      parti: 'MP',
      röst: 'ja',
    })
    // "tjänstgörande ersättarna X och Y" — prefixet gäller bara närmast följande namn
    expect(votering.röster.find((r) => r.namn === 'Johannes Hulter')).toMatchObject({
      parti: 'S',
      röst: 'ja',
    })
    expect(votering.röster.find((r) => r.namn === 'Marie Brynolfsson')).toMatchObject({
      parti: 'V',
      röst: 'ja',
    })
    // "samt ordföranden Jonas Attenius röstar Ja" — utan "(S)" i källan
    expect(votering.röster.find((r) => r.namn === 'Jonas Attenius')).toMatchObject({
      parti: '',
      röst: 'ja',
    })
  })

  it('flera Omröstningar i samma paragraf-fulltext ger flera resultat utan att blanda ihop namnlistorna', () => {
    const text = `
Propositionsordning

Ordföranden Jonas Attenius (S) ställer först propositioner på yrkandena med undantag av
tilläggsyrkandena och finner att Marie Brynolfssons och Axel Josefsons yrkande bifallits.
Ordföranden ställer härefter propositioner på bifall respektive avslag på tilläggsyrkandet
från SD och D och finner att det avslagits. Omröstning begärs.

Omröstning

Godkänd voteringsproposition: "Ja för avslag och Nej för bifall till tilläggsyrkandet från
SD och D."
Axel Josefson (M), Daniel Bernmar (V) röstar Ja (2).
Martin Wannholt (D) röstar Nej (1).

Propositionsordning

Ordföranden ställer därefter propositioner på bifall respektive avslag på tilläggsyrkandet
från D och SD och finner att det avslagits. Omröstning begärs.

Omröstning

Godkänd voteringsproposition: "Ja för avslag och Nej för bifall till tilläggsyrkandet från
D och SD."
Axel Josefson (M) röstar Ja (1).
Martin Wannholt (D), Jörgen Fogelklou (SD) röstar Nej (2).

Protokollsanteckning`

    const voteringar = parseOmröstningar(text, 'ks-2024-04-10-§307')
    expect(voteringar).toHaveLength(2)
    expect(voteringar[0]).toMatchObject({ ja: 2, nej: 1 })
    expect(voteringar[1]).toMatchObject({ ja: 1, nej: 2 })
    expect(voteringar[0].röster).toHaveLength(3)
    expect(voteringar[1].röster).toHaveLength(3)
  })
})
