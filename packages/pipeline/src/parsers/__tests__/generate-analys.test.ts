import { describe, expect, it } from 'vitest'
import {
  type Paragraf,
  analysera,
  beloppMnkr,
  initiativParti,
  prognosKandidat,
} from '../generate-analys.js'

const p = (över: Partial<Paragraf>): Paragraf => ({
  id: 'kf-2025-01-01-§1',
  datum: '2025-01-01',
  paragrafNr: '1',
  ärendeNr: 'SLK-2025-00001',
  rubrik: 'Höjning av avgiften för färdtjänst',
  ...över,
})

describe('beloppMnkr', () => {
  it('normaliserar svenska enheter och tusentalsavgränsare till mnkr', () => {
    expect(beloppMnkr('12,5 mnkr och 1 500 tkr samt 2 miljarder kronor')).toEqual([2000, 12.5, 1.5])
  })

  it('tar både "miljoner kronor" och "miljoner kr" — enheten skrivs inkonsekvent', () => {
    // Samma handling skrev "cirka 190 mkr" och "cirka 70 miljoner kr"; bara den
    // första fångades innan (SLK-2026-00495).
    expect(beloppMnkr('cirka 190 mkr och cirka 70 miljoner kr')).toEqual([190, 70])
    expect(beloppMnkr('2 miljarder kr')).toEqual([2000])
    expect(beloppMnkr('546 mdkr, 500 kkr och 800 tusen kronor')).toEqual([546000, 0.8, 0.5])
  })

  it('tar inte "miljoner" utan valutaord — det är lika ofta euro, ton eller besök', () => {
    // Ur --granska: 103 "miljoner Euro", 23 "miljoner kvadratmeter",
    // 12 "miljarder människor". Ett påhittat belopp är värre än ett saknat.
    expect(beloppMnkr('12 miljarder människor och 3 miljoner besök')).toEqual([])
    expect(beloppMnkr('103 miljoner Euro')).toEqual([])
    expect(beloppMnkr('3 miljoner kronor')).toEqual([3])
  })

  it('sållar bort taxor och avgifter under 0,1 mnkr', () => {
    expect(beloppMnkr('avgiften höjs till 350 kronor')).toEqual([])
  })
})

describe('analysera', () => {
  it('slår ihop bordläggningskedjan och räknar handläggningstid från första §', () => {
    const a = analysera(
      [
        p({ id: 'kf-2025-01-01-§1', datum: '2025-01-01', beslut: 'bordläggning' }),
        p({ id: 'kf-2025-03-01-§9', datum: '2025-03-01', paragrafNr: '9', beslut: 'bordläggning' }),
        p({
          id: 'kf-2025-06-01-§40',
          datum: '2025-06-01',
          paragrafNr: '40',
          beslut: 'bifall',
          votering: { ja: 40, nej: 37 },
          reservationer: ['M'],
        }),
      ],
      '2026-07-28',
    )
    expect(a.analyserbar).toBe(true)
    expect(a.process).toMatchObject({
      beslut: 'bifall',
      beslutsdatum: '2025-06-01',
      handläggningsdagar: 151,
      bordlagd_antal: 2,
      enighet: 'delad',
      marginal: 3,
    })
  })

  it('markerar enighet när votering, reservation och motförslag saknas', () => {
    const a = analysera([p({ beslut: 'bifall' })], '2026-07-28')
    expect(a.process?.enighet).toBe('enig')
    expect(a.process?.alternativt_yrkande).toBe(false)
  })

  it('ser flera yrkandeslag som ett alternativt förslag', () => {
    const a = analysera(
      [
        p({
          beslut: 'bifall',
          yrkanden: [
            { namn: 'A', typ: 'kommunstyrelsens förslag' },
            { namn: 'B', typ: 'yrkande från C' },
          ],
        }),
      ],
      '2026-07-28',
    )
    expect(a.process?.alternativt_yrkande).toBe(true)
  })

  it('flaggar osäker finansiering med citat ur källan', () => {
    const a = analysera(
      [
        p({
          beslut: 'bifall',
          handlingText:
            'Reformen beräknas kosta 45 mnkr. Det är ännu oklart om ersättningen fullt ut kommer att motsvara kommunernas utökade kostnader.',
        }),
      ],
      '2026-07-28',
    )
    expect(a.ekonomi?.finansiering_osäker).toBe(true)
    expect(a.ekonomi?.belopp_mnkr).toEqual([45])
    expect(a.ekonomi?.citat).toContain('ännu oklart')
  })

  it('skiljer "handlingen saknar konsekvensanalys" från "vi har inte handlingen"', () => {
    expect(analysera([p({ beslut: 'bifall' })], '2026-07-28').underlag).toMatchObject({
      har_handling: false,
      nämner_konsekvensanalys: null,
    })
    expect(
      analysera([p({ beslut: 'bifall', handlingText: 'Förslaget bedöms rimligt.' })], '2026-07-28')
        .underlag,
    ).toMatchObject({ har_handling: true, nämner_konsekvensanalys: false })
  })

  it('ger skäl i stället för tom analys för mötesadministration och obeslutade ärenden', () => {
    expect(
      analysera(
        [p({ rubrik: 'Bestämmande av tid för justering', beslut: 'beslut' })],
        '2026-07-28',
      ),
    ).toMatchObject({ analyserbar: false, skäl: 'procedurell' })
    expect(
      analysera([p({ rubrik: 'Interpellation av Pär Gustafsson (L) om skolan' })], '2026-07-28'),
    ).toMatchObject({ analyserbar: false, skäl: 'utan_beslutskaraktär' })
    expect(analysera([p({ beslut: 'bordläggning' })], '2026-07-28')).toMatchObject({
      analyserbar: false,
      skäl: 'ej_avgjord',
    })
  })

  it('håller källa_hash stabil mot oförändrad text — prognossteget ska inte köras om', () => {
    const kedja = [p({ beslut: 'bifall', handlingText: 'x' })]
    expect(analysera(kedja, '2026-07-28').källa_hash).toBe(
      analysera(kedja, '2027-01-01').källa_hash,
    )
  })
})

describe('prognosKandidat', () => {
  const stark = { handling: true, belopp: 45, omstritt: true, osäkerFinansiering: false }

  it('håller rutinärenden utanför modellkön men behåller dem som analyserade', () => {
    // Båda gick till modellen i testkörningen 2026-07-28 och gav bara
    // "otillräckligt underlag" tillbaka.
    expect(prognosKandidat('Tolkförmedling Västs årsredovisning 2025', stark).värd).toBe(false)
    expect(prognosKandidat('Utdelning ur stiftelsen Renströmska fonden 2026', stark)).toMatchObject(
      {
        värd: false,
        skäl: 'rutinärende',
      },
    )
    const a = analysera(
      [p({ rubrik: 'Tolkförmedling Västs årsredovisning 2025', beslut: 'bifall' })],
      '2026-07-28',
    )
    expect(a.analyserbar).toBe(true)
    expect(a.process?.beslut).toBe('bifall')
    expect(a.prognos_kandidat?.värd).toBe(false)
  })

  it('släpper igenom pengar, oenighet och erkänd osäkerhet — men inte tomma ärenden', () => {
    const tomt = { handling: true, belopp: 0, omstritt: false, osäkerFinansiering: false }
    expect(prognosKandidat('Ny simhall i Angered', { ...tomt, belopp: 45 }).värd).toBe(true)
    expect(prognosKandidat('Ny simhall i Angered', { ...tomt, omstritt: true }).värd).toBe(true)
    expect(
      prognosKandidat('Ny simhall i Angered', { ...tomt, osäkerFinansiering: true }).värd,
    ).toBe(true)
    expect(prognosKandidat('Ny simhall i Angered', tomt).värd).toBe(false)
    expect(prognosKandidat('Ny simhall i Angered', { ...stark, handling: false })).toMatchObject({
      värd: false,
      skäl: 'handling ej hämtad',
    })
  })
})

describe('initiativParti', () => {
  it('läser parti ur motionsrubriken men inte ur vanliga ärenden', () => {
    expect(initiativParti('Motion av AnnaSara Perslow (C) om att möjliggöra')).toBe('C')
    expect(initiativParti('Kompletterande budget oktober 2025 (M)')).toBeNull()
  })
})
