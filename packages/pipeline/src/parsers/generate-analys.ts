/**
 * Analyslager steg 1 — process + underlag + ekonomi, helt deterministiskt.
 *
 * Analysenheten är ÄRENDET (SLK-nummer), inte paragrafen: 786 av 1352 ärenden
 * behandlas i flera §§ (bordläggning), och det är kedjan — inte den enskilda
 * paragrafen — som säger något om hur beslutet kom till.
 *
 * Ingen LLM här. Allt nedan finns redan strukturerat i data/graf/{kf,ks}-*.json
 * eller är regex över handlingstexten. AI-prognoslagret (steg 3) skrivs till
 * `prognos`-fältet som lämnas null här, och `källa_hash` gör det steget
 * idempotent: oförändrad hash ⇒ ingen ny modellkörning.
 *
 * Resultatet hålls MEDVETET utanför data/graf/ — allt i grafen är parsade
 * fakta, och /v1/goteborg/graf/node/… får aldrig returnera en maskinbedömning
 * som om den vore en kant i protokollet.
 *
 * Kör: npx tsx packages/pipeline/src/parsers/generate-analys.ts
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')

export interface Paragraf {
  id: string
  datum: string
  paragrafNr: string
  ärendeNr?: string
  rubrik?: string
  beslut?: string | null
  votering?: { ja: number; nej: number; avstår?: number } | null
  yrkanden?: { namn: string; parti?: string; typ?: string }[]
  reservationer?: unknown[]
  jäv?: unknown[]
  fulltext?: string
  handlingText?: string
}

/** Rubriker som är mötesadministration — analys av dem är brus, inte insikt. */
const PROCEDURELL =
  /^(bestämmande av tid för justering|justering|upprop|parentation|frågestund|förteckning över anmälningsärenden|anmälan av|valberedningens förslag|val av|fyllnadsval|avsägelse|entledigande|nominering|redovisning av inkomna motioner|inkomna|mötets öppnande|godkännande av (dagordning|föredragningslista))/i

/** Ärenden som debatteras men inte avgör något — de har ingen utfallssida. */
const UTAN_BESLUTSKARAKTÄR = /^(interpellation|fråga|enkel fråga|remiss från|meddelande)/i

/**
 * Återkommande förvaltningsärenden: de FATTAS på riktigt (och process- och
 * ekonomilagret gäller — en årsredovisning som går igenom med votering är i
 * högsta grad intressant), men de blickar bakåt eller är rena utbetalningar.
 * En prognos om deras framtida konsekvenser har inget att ta spjärn mot, vilket
 * en testkörning bekräftade: modellen svarade "otillräckligt underlag" på
 * exakt dessa — ett svar som kostade en modellkörning att få.
 */
const RUTINÄRENDE =
  /(årsredovisning|delårsrapport|verksamhetsberättelse|revisionsberättelse|ansvarsfrihet|utdelning ur|ur stiftelsen|sammanträdestider|firmatecknare|attestordning|arkivbeskrivning)/i

const UNDERLAG_MÖNSTER = {
  nämner_utredning: /\butred(ning|ningen|ningar|ts|a|er)\b/i,
  nämner_konsekvensanalys: /konsekvens(analys|beskrivning|bedömning|utredning)/i,
  nämner_barnperspektiv: /barn(konsekvens|perspektiv|rätts|rättslig)/i,
  nämner_jämställdhetsanalys: /jämställdhets(analys|perspektiv|bedömning)/i,
  nämner_riskanalys: /risk(analys|bedömning|inventering)/i,
  // "yttrande från" ströks 2026-07-28: flaggan slog på "inhämta yttrande från
  // den utomstående som hade vetorätt" i ett stiftelseärende där ordet remiss
  // inte förekommer alls. En flagga som säger fel sak om underlaget är värre
  // än ingen flagga (SLK-2026-00495).
  nämner_remiss: /\bremiss|remitterad|remissinstans/i,
} as const

/**
 * Formuleringar där handlingen SJÄLV medger att finansieringen är osäker.
 * Det är inte en bedömning från vår sida — det är ett citat, och citatet
 * sparas så att påståendet går att kontrollera mot källan.
 *
 * "inte fullt ut" krävde ett pengaord i närheten från 2026-07-29: av 156
 * förekomster i korpusen rörde 19 pengar. Resten var IVO som "inte fullt ut
 * fyllde denna funktion", processer som var "inte fullt utvecklade" (frasen
 * matchade rentav mitt inne i ett annat ord) och utbildning som "inte fullt ut
 * tillhandhölls". Flaggan satte SLK-2026-00402 i analyskön på en mening om en
 * outnyttjad byggrätt — som dessutom var ett argument FÖR planen.
 *
 * "oklart hur" fick samma villkor av samma skäl: 64 av 68 förekomster gällde
 * geoteknik, planbestämmelser och lasthantering, inte pengar.
 */
const OSÄKER_FINANSIERING =
  /(ännu oklart|är oklart om|oklart hur[^.]{0,80}(?:kostnad|finansier|medel|ersättn|bidrag|budget)|ryms (?:inte|ej|inte helt) inom|saknas finansiering|ej finansierad|ofinansierad|inte fullt ut\b[^.]{0,80}(?:ersättning|kostnad|finansier|medel|bidrag|kompens)|(?:ersättning|kompensation|bidrag)[^.]{0,80}inte fullt ut\b|utökade kostnader|ökade kostnader för (?:staden|kommunen|nämnden)|kräver (?:ytterligare|utökade) (?:medel|resurser)|återkomma (?:med|om) finansiering|finansiering saknas)/i

/** Motsatsen: ett explicit finansieringspåstående som går att stämma av senare. */
const PÅSTÅDD_FINANSIERING =
  /(ryms inom (?:befintlig|befintliga|nuvarande)|inom befintlig ram|finansieras (?:inom|via|genom|av|med)|täcks av)/i

/**
 * Enheterna kommer ur `--granska`, som räknar vad som faktiskt står efter ett
 * tal i korpusen. "miljoner kr" saknades och fick 70 miljoner i ett
 * stiftelsekapital att falla bort medan 190 mkr i samma handling fångades
 * (SLK-2026-00495); mdkr (1197 förekomster), kkr och tusen kronor saknades
 * också.
 *
 * Bara "miljoner"/"miljarder" utan valutaord är MEDVETET utelämnat, inte
 * glömt: granskningen visar att det lika gärna är euro, ton, kvadratmeter,
 * besök, människor eller USD. Ett påhittat belopp är värre än ett saknat —
 * plattformen ska kunna citeras.
 */
const BELOPP =
  /(\d[\d  ]*(?:,\d+)?)\s*(mnkr|mdkr|mkr|tkr|kkr|miljard(?:er)? (?:kronor|kr|sek)|miljon(?:er)? (?:kronor|kr|sek)|tusen kronor|kronor|kr)(?![a-zåäö])/gi

const TILL_MNKR: Record<string, number> = {
  mnkr: 1,
  mkr: 1,
  mdkr: 1000,
  'miljon kronor': 1,
  'miljon kr': 1,
  'miljon sek': 1,
  'miljoner kronor': 1,
  'miljoner kr': 1,
  'miljoner sek': 1,
  'miljard kronor': 1000,
  'miljard kr': 1000,
  'miljard sek': 1000,
  'miljarder kronor': 1000,
  'miljarder kr': 1000,
  'miljarder sek': 1000,
  tkr: 0.001,
  kkr: 0.001,
  'tusen kronor': 0.001,
  kronor: 1e-6,
  kr: 1e-6,
}

/** Svenska tal: mellanslag som tusentalsavgränsare, komma som decimaltecken. */
export function beloppMnkr(text: string): number[] {
  const funna = new Set<number>()
  for (const m of text.matchAll(BELOPP)) {
    const tal = Number(m[1].replace(/[\s ]/g, '').replace(',', '.'))
    const mnkr = tal * TILL_MNKR[m[2].toLowerCase()]
    // Under 0,1 mnkr är i praktiken avgifter och taxor, inte ärendets kostnad.
    if (Number.isFinite(mnkr) && mnkr >= 0.1) funna.add(Math.round(mnkr * 10) / 10)
  }
  return [...funna].sort((a, b) => b - a).slice(0, 5)
}

function citat(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  if (!m) return null
  const start = Math.max(0, m.index - 100)
  return `…${text
    .slice(start, m.index + m[0].length + 120)
    .replace(/\s+/g, ' ')
    .trim()}…`
}

/**
 * Vilka ärenden som är värda en modellkörning. Ett prognosvärt ärende måste ha
 * något att ta spjärn mot: pengar, oenighet eller en erkänd osäkerhet.
 *
 * ponytail: trubbig tröskel (10 mnkr) vald för att den skär bort ~2/3 av kön.
 * Byt mot andel av nämndens ram om beloppen visar sig missvisande — en tia är
 * mycket för kulturnämnden och avrundningsfel i grundskolans budget.
 */
export function prognosKandidat(
  rubrik: string,
  sig: { handling: boolean; belopp: number; omstritt: boolean; osäkerFinansiering: boolean },
): { värd: boolean; skäl: string } {
  if (RUTINÄRENDE.test(rubrik)) return { värd: false, skäl: 'rutinärende' }
  if (!sig.handling) return { värd: false, skäl: 'handling ej hämtad' }
  if (sig.osäkerFinansiering) return { värd: true, skäl: 'finansiering erkänt osäker' }
  if (sig.belopp >= 10) return { värd: true, skäl: `belopp ${sig.belopp} mnkr` }
  if (sig.omstritt) return { värd: true, skäl: 'omstritt beslut' }
  return { värd: false, skäl: 'inget att prognostisera mot' }
}

/** "Motion av Anna Svensson (C) och …" → C. Enda stället vi kan initiativtagare. */
export function initiativParti(rubrik: string): string | null {
  if (!/^(motion|interpellation|fråga)/i.test(rubrik)) return null
  return /\(([A-ZÅÄÖ]{1,3})\)/.exec(rubrik)?.[1] ?? null
}

export interface Analys {
  ärendeNr: string
  rubrik: string
  organ: 'kf' | 'ks'
  initiativ_parti: string | null
  paragrafer: { id: string; datum: string; nr: string; beslut: string | null }[]
  analyserbar: boolean
  /** Varför ingen analys — så att UI kan säga skälet i stället för att visa tomt. */
  skäl?: 'procedurell' | 'utan_beslutskaraktär' | 'ej_avgjord'
  process?: {
    beslut: string
    beslutsdatum: string
    första_behandling: string
    handläggningsdagar: number
    bordlagd_antal: number
    enighet: 'enig' | 'delad' | 'okänd'
    votering: { ja: number; nej: number; avstår?: number } | null
    marginal: number | null
    antal_yrkanden: number
    alternativt_yrkande: boolean
    antal_reservationer: number
    antal_jäv: number
  }
  /**
   * `null` = handlingen är inte nedladdad, alltså VET vi inget. Skilj det från
   * `false` (texten finns och nämner det inte) — annars läser både UI och
   * framtida promptar "saknar konsekvensanalys" ur en lucka i vår egen pipeline.
   */
  underlag?: { har_handling: boolean } & Record<keyof typeof UNDERLAG_MÖNSTER, boolean | null>
  ekonomi?: {
    belopp_mnkr: number[]
    finansiering_osäker: boolean
    finansiering_påstådd: boolean
    citat: string | null
  }
  /**
   * Kö till prognoslagret. Skilt från `analyserbar`: ett rutinärende får full
   * process- och ekonomianalys men ska inte kosta en modellkörning. Filtret
   * fanns inte vid testkörningen 2026-07-28 och 2 av 5 ärenden gick till
   * modellen bara för att få svaret "otillräckligt underlag".
   */
  prognos_kandidat?: { värd: boolean; skäl: string }
  källa_hash: string
  prognos: null
  utfall: null
  genererad: string
}

export function analysera(paragrafer: Paragraf[], idag: string): Analys {
  const kedja = [...paragrafer].sort((a, b) => a.datum.localeCompare(b.datum))
  const sista = kedja[kedja.length - 1]
  const rubrik = kedja.find((p) => p.rubrik)?.rubrik ?? ''
  const text = kedja.map((p) => `${p.fulltext ?? ''}\n${p.handlingText ?? ''}`).join('\n')

  const bas = {
    ärendeNr: sista.ärendeNr as string,
    rubrik,
    organ: sista.id.startsWith('ks-') ? ('ks' as const) : ('kf' as const),
    initiativ_parti: initiativParti(rubrik),
    paragrafer: kedja.map((p) => ({
      id: p.id,
      datum: p.datum,
      nr: p.paragrafNr,
      beslut: p.beslut ?? null,
    })),
    källa_hash: createHash('sha1').update(text).digest('hex').slice(0, 16),
    prognos: null,
    utfall: null,
    genererad: idag,
  }

  if (PROCEDURELL.test(rubrik)) return { ...bas, analyserbar: false, skäl: 'procedurell' }
  if (UTAN_BESLUTSKARAKTÄR.test(rubrik))
    return { ...bas, analyserbar: false, skäl: 'utan_beslutskaraktär' }

  // Ett ärende kan komma tillbaka under samma nummer långt efter att det
  // avgjorts — "…- nu fråga om fullmakt" är en ny fråga, inte beslutet. Utan
  // undantaget blev SLK-2025-00591:s beslutsdatum 2026-06-17, dagen staden gav
  // fullmakt att försvara planen i domstol, i stället för antagandet.
  //
  // ponytail: bara datumet skyddas, inte hela kedjan. 600 av 3936 paragrafer
  // saknar dessutom beslutsklassning från protokollparsern, så beslutsdatum kan
  // fortfarande peka på KS tillstyrkan i stället för KF:s antagande. Rätt fix
  // ligger i parse-protokoll, inte här.
  const uppföljning = /[-–]\s*nu fråga om/i
  const kandidater = kedja.filter((p) => !uppföljning.test(p.rubrik ?? ''))
  const avgörande = [...(kandidater.length ? kandidater : kedja)]
    .reverse()
    .find((p) => p.beslut && p.beslut !== 'bordläggning')
  if (!avgörande) return { ...bas, analyserbar: false, skäl: 'ej_avgjord' }

  const votering = avgörande.votering ?? null
  const reservationer = avgörande.reservationer?.length ?? 0
  const yrkanden = avgörande.yrkanden ?? []
  // Fler än ett distinkt yrkandeslag = oppositionen lade ett eget förslag.
  const alternativt = new Set(yrkanden.map((y) => y.typ)).size > 1
  const handling = kedja.some((p) => p.handlingText)
  const ekonomi = {
    // Belopp som NÄMNS i ärendet — inte en beräknad kostnad för beslutet.
    belopp_mnkr: beloppMnkr(text),
    finansiering_osäker: OSÄKER_FINANSIERING.test(text),
    finansiering_påstådd: PÅSTÅDD_FINANSIERING.test(text),
    citat: citat(text, OSÄKER_FINANSIERING),
  }

  return {
    ...bas,
    analyserbar: true,
    prognos_kandidat: prognosKandidat(rubrik, {
      handling,
      belopp: ekonomi.belopp_mnkr[0] ?? 0,
      omstritt: Boolean(votering) || reservationer > 0,
      osäkerFinansiering: ekonomi.finansiering_osäker,
    }),
    process: {
      beslut: avgörande.beslut as string,
      beslutsdatum: avgörande.datum,
      första_behandling: kedja[0].datum,
      handläggningsdagar: Math.round(
        (Date.parse(avgörande.datum) - Date.parse(kedja[0].datum)) / 86_400_000,
      ),
      bordlagd_antal: kedja.filter((p) => p.beslut === 'bordläggning').length,
      enighet: votering || reservationer > 0 ? 'delad' : alternativt ? 'okänd' : 'enig',
      votering,
      marginal: votering ? Math.abs(votering.ja - votering.nej) : null,
      antal_yrkanden: yrkanden.length,
      alternativt_yrkande: alternativt,
      antal_reservationer: reservationer,
      antal_jäv: avgörande.jäv?.length ?? 0,
    },
    underlag: {
      har_handling: handling,
      ...(Object.fromEntries(
        Object.entries(UNDERLAG_MÖNSTER).map(([k, re]) => [k, handling ? re.test(text) : null]),
      ) as Record<keyof typeof UNDERLAG_MÖNSTER, boolean | null>),
    },
    ekonomi,
  }
}

export function gruppera(grafDir: string): Map<string, Paragraf[]> {
  const ärenden = new Map<string, Paragraf[]>()
  for (const fil of readdirSync(grafDir).filter((f) =>
    /^(kf|ks)-\d{4}-\d{2}-\d{2}\.json$/.test(f),
  )) {
    const graf = JSON.parse(readFileSync(join(grafDir, fil), 'utf-8'))
    for (const nod of graf.nodes) {
      if (nod.typ !== 'paragraf' || !nod.data.ärendeNr) continue
      const p: Paragraf = { id: nod.id, ...nod.data }
      const kedja = ärenden.get(p.ärendeNr as string)
      if (kedja) kedja.push(p)
      else ärenden.set(p.ärendeNr as string, [p])
    }
  }
  return ärenden
}

/**
 * Flagg-granskning: vad har mönstren FAKTISKT träffat på, i hela korpusen?
 *
 * Två fel hittades av en slump när en AI-analys råkade snubbla på dem
 * (SLK-2026-00495): beloppsregexen missade "miljoner kr" medan den tog "mkr" i
 * samma handling, och nämner_remiss slog på "inhämta yttrande från". Båda hade
 * synts direkt om någon sett vad mönstren träffade — en boolean döljer det,
 * ett citat gör det inte. Därför den här vyn: kör den efter varje ändring i
 * mönstren, och läs vad de fastnat på.
 *
 * Kör: npx tsx .../generate-analys.ts --granska
 */
function granska(ärenden: { text: string }[]) {
  // Alla mönster som gör ett påstående om handlingen granskas likadant —
  // finansieringsflaggorna styr dessutom kön och citeras i UI:t, så de är de
  // som kostar mest när de har fel.
  const MÖNSTER = {
    ...UNDERLAG_MÖNSTER,
    finansiering_osäker: OSÄKER_FINANSIERING,
    finansiering_påstådd: PÅSTÅDD_FINANSIERING,
  }
  for (const [namn, re] of Object.entries(MÖNSTER)) {
    const global = new RegExp(re.source, 'gi')
    const träffar = new Map<string, number>()
    for (const { text } of ärenden) {
      for (const m of text.matchAll(global)) {
        const nyckel = m[0].toLowerCase()
        träffar.set(nyckel, (träffar.get(nyckel) ?? 0) + 1)
      }
    }
    const sorterat = [...träffar].sort((a, b) => b[1] - a[1])
    console.log(`\n${namn} — ${sorterat.length} distinkta träffar`)
    for (const [ord, n] of sorterat.slice(0, 12)) console.log(`   ${String(n).padStart(5)}  ${ord}`)
    if (sorterat.length > 12) console.log(`         … och ${sorterat.length - 12} former till`)
  }

  // Motsatt håll: vilka enheter står efter ett tal i korpusen, och vilka av dem
  // fångar BELOPP? Det är så en missad stavning syns utan att någon snubblar.
  const enheter = new Map<string, number>()
  for (const { text } of ärenden) {
    for (const m of text.matchAll(/\d[\d {2}]*(?:,\d+)?\s+([a-zåäö]+(?: (?:kronor|kr))?)/gi)) {
      const e = m[1].toLowerCase()
      // Bara pengaord: slutar på kr/kronor eller börjar på miljon/miljard/tusen.
      // Utan den avgränsningen fastnar "planbeskrivning" och "kretslopp" på
      // sitt inbakade "kr".
      if (/(kr|kronor)$|^(miljon|miljard|tusen)/.test(e)) enheter.set(e, (enheter.get(e) ?? 0) + 1)
    }
  }
  console.log('\nEnheter efter ett tal (fångas de av beloppMnkr?)')
  for (const [e, n] of [...enheter].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    // Prova enheten mot funktionen i stället för att plocka isär regexen.
    // Provbeloppet måste vara stort nog att passera 0,1 mnkr-golvet även för
    // den minsta enheten, annars ser "kr" ut att missas fast den fångas.
    const fångas = beloppMnkr(`1000000 ${e}`).length > 0
    console.log(`   ${fångas ? '✓' : '✗ MISSAS'}  ${String(n).padStart(5)}  ${e}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const idag = new Date().toISOString().slice(0, 10)
  const ärenden = [...gruppera(join(DATA_DIR, 'graf')).values()].map((p) => analysera(p, idag))
  ärenden.sort((a, b) => b.paragrafer[0].datum.localeCompare(a.paragrafer[0].datum))

  if (process.argv.includes('--granska')) {
    granska(
      [...gruppera(join(DATA_DIR, 'graf')).values()].map((kedja) => ({
        text: kedja.map((p) => `${p.fulltext ?? ''}\n${p.handlingText ?? ''}`).join('\n'),
      })),
    )
    process.exit(0)
  }

  mkdirSync(join(DATA_DIR, 'analys'), { recursive: true })
  writeFileSync(
    join(DATA_DIR, 'analys', 'beslut.json'),
    `${JSON.stringify(
      {
        genererad: idag,
        källa: 'data/graf/{kf,ks}-*.json (KF- och KS-protokoll + handlingar)',
        metod: 'deterministisk härledning + regex, ingen modellbedömning',
        antal: ärenden.length,
        ärenden,
      },
      null,
      2,
    )}\n`,
  )

  const a = ärenden.filter((x) => x.analyserbar)
  console.log(`✓ ${ärenden.length} ärenden → data/analys/beslut.json (${a.length} analyserbara)`)
  for (const [skäl, n] of Object.entries(
    ärenden.reduce<Record<string, number>>((acc, x) => {
      if (x.skäl) acc[x.skäl] = (acc[x.skäl] ?? 0) + 1
      return acc
    }, {}),
  ))
    console.log(`  utan analys — ${skäl}: ${n}`)

  const kö = a.filter((x) => x.prognos_kandidat?.värd)
  console.log(`  kö till prognoslagret: ${kö.length} av ${a.length} analyserbara`)
  for (const [skäl, n] of Object.entries(
    a.reduce<Record<string, number>>((acc, x) => {
      const k = x.prognos_kandidat as { värd: boolean; skäl: string }
      const nyckel = `${k.värd ? '  in' : ' bort'} — ${k.skäl.replace(/belopp .*/, 'belopp ≥10 mnkr')}`
      acc[nyckel] = (acc[nyckel] ?? 0) + 1
      return acc
    }, {}),
  ).sort())
    console.log(`   ${skäl}: ${n}`)

  // Underlagsflaggorna gäller bara ärenden vars handling faktiskt är hämtad.
  const medHandling = a.filter((x) => x.underlag?.har_handling)
  console.log(
    `  delade: ${a.filter((x) => x.process?.enighet === 'delad').length}` +
      `  osäker finansiering: ${a.filter((x) => x.ekonomi?.finansiering_osäker).length}` +
      `  handling hämtad: ${medHandling.length}` +
      `  saknar konsekvensanalys: ${medHandling.filter((x) => x.underlag?.nämner_konsekvensanalys === false).length}`,
  )

  // Neutralitetskontroll: samma flaggor per initiativparti. Slår en flagga
  // systematiskt mot ett block är det antingen verkligt eller en parserbias —
  // båda fallen ska synas, inte döljas i ett totalvärde.
  const perParti = new Map<string, { n: number; osäker: number; utan_ka: number }>()
  for (const x of a) {
    if (!x.initiativ_parti) continue
    const rad = perParti.get(x.initiativ_parti) ?? { n: 0, osäker: 0, utan_ka: 0 }
    rad.n++
    if (x.ekonomi?.finansiering_osäker) rad.osäker++
    if (x.underlag?.nämner_konsekvensanalys === false) rad.utan_ka++
    perParti.set(x.initiativ_parti, rad)
  }
  console.log('\n  Flaggor per initiativparti (motioner/interpellationer):')
  for (const [parti, r] of [...perParti].sort((x, y) => y[1].n - x[1].n))
    console.log(
      `    ${parti.padEnd(3)} n=${String(r.n).padStart(3)}  osäker fin. ${Math.round((100 * r.osäker) / r.n)}%  utan konsekvensanalys ${Math.round((100 * r.utan_ka) / r.n)}%`,
    )
}
