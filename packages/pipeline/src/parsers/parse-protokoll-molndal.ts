/**
 * Mölndals KF- och KS-protokoll → kunskapsgraf i samma form som Göteborgs
 * (data/graf/kf-*.json): möte, paragrafer med beslut/reservationer/votering,
 * närvaro (närvarade) och namnröster ur omröstningslistorna (röstade_*).
 * Utfil: data/molndal/graf/{kf|ks}-{datum}.json.
 *
 * Indata: data/beslut/molndal-protokoll.json (scrapers/protokoll-molndal.ts)
 * och politikerregistret data/politiker/molndal.json (för politiker-id).
 *
 * Protokollformatet (Mölndals mall, 2022–2026):
 *   § 162            Diarienummer 00322/2026     (2023: "Dnr 00123/20212.6.")
 *   Rubrik
 *   Beslut / Reservationer / Förslag under sammanträdet / Beslutsgång /
 *   Omröstning begärs / Omröstningsresultat / Expedieras till …
 * och sist en "Omröstningslista nr. N" per votering med kolumnerna
 * Ja / Nej / Avst / Frånv (X i rätt kolumn; ersättaren röstar om angiven).
 *
 * Usage: npx tsx packages/pipeline/src/parsers/parse-protokoll-molndal.ts [--only-new]
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Protokoll, Webbdiariet } from '../scrapers/protokoll-molndal'
import { createPolitikerResolver } from './parse-yttrandeprotokoll'

const ROOT = join(import.meta.dirname, '../../../..')
const OUTPUT_DIR = join(ROOT, 'data/molndal/graf')
const CACHE = join(ROOT, '.tmp/molndal-protokoll')

// Rubriker som avslutar ett textavsnitt i en paragraf
const AVSNITT =
  /^(Beslut|Reservation(er)?|Protokollsanteckning(ar)?|Sammanfattning|Ärendet|Beslutsunderlag|Förslag under sammanträdet|Förslag till beslut|Beslutsgång|Omröstning begärs|Omröstningsresultat|Expedieras till|Jäv|Ärendets behandling|Yrkanden?|Särskilt yttrande)$/i

// Sidhuvud/-fot som pdftotext lägger mitt i texten
const SIDBRUS =
  /^(Sida|\d+\(\d+\)|SAMMANTRÄDESPROTOKOLL.*|Sammanträdesdatum|\d{4}-\d{2}-\d{2}|Kommunfullmäktige|Kommunstyrelsen|Justerandes sign.*|Utdragsbestyrkande|Sida\s+\d+\(\d+\))$/

export interface Votering {
  ja: number
  nej: number
  avstår: number
  frånvarande: number
  proposition?: string
  jaBetyder?: string
  nejBetyder?: string
}

export interface Paragraf {
  nr: string
  ärendeNr: string
  rubrik: string
  beslutstext: string
  beslut: string
  omedelbartJusterad: boolean
  reservationer: string[]
  votering?: Votering
  voteringar: Votering[]
  fulltext: string
}

export interface Röst {
  paragrafNr: string
  namn: string
  parti: string
  röst: 'ja' | 'nej' | 'avstår' | 'frånvarande'
}

export interface Närvarande {
  namn: string
  parti: string
  roll?: string
  ersätter?: string
}

const rena = (rader: string[]) =>
  rader
    .map((r) => r.trim())
    .filter((r) => r && !SIDBRUS.test(r))
    .join('\n')

/** "00123/20212.6." → "00123/2021", "00322/2026" oförändrat, "116159" oförändrat */
export function diarienummer(rå: string): string {
  return rå.match(/^(\d{5}\/\d{4})/)?.[1] ?? rå.replace(/[.,]+$/, '')
}

/** Beslutsklass i samma vokabulär som Göteborgs graf */
export function klassificera(beslutstext: string, organ: 'kf' | 'ks'): string {
  const t = beslutstext.toLowerCase()
  // Informationspunkter, presentationer, ändrad ärendelista — inget beslut att klassa
  if (!t) return 'beslut'
  if (/återremitt|återremiss/.test(t)) return 'återremiss'
  if (/bordlägg/.test(t)) return 'bordläggning'
  if (organ === 'ks' && /förslag till kommunfullmäktige|föreslår kommunfullmäktige/.test(t))
    return 'tillstyrkan_kf'
  if (/ärendet utgår/.test(t)) return 'beslut'
  // avslår / avslås / beslutar avslå / avslag / avstyrks
  // (inget \b: JS ordgränser räknar inte å som bokstav)
  if (/avslå|avslag|avstyrk/.test(t)) return 'avslag'
  if (/antecknar|till handlingarna|tar del av|informationen/.test(t)) return 'beslut'
  if (/anses besvarad|besvarad/.test(t)) return 'beslut'
  return 'bifall'
}

export function parseVoteringResultat(text: string): Votering | undefined {
  const t = text.replace(/\s+/g, ' ')
  const ja = t.match(/(\d+) ja-röst/i)?.[1]
  const nej = t.match(/(\d+) nej-röst/i)?.[1]
  if (!ja || !nej) return undefined
  return {
    ja: Number(ja),
    nej: Number(nej),
    avstår: Number(t.match(/(\d+) (?:avstår|avstod|nedlagda|ledamöter avstår)/i)?.[1] ?? 0),
    frånvarande: Number(t.match(/(\d+) frånvarande/i)?.[1] ?? 0),
  }
}

/** Alla voteringar i en paragraf, i ordning, med sin omröstningsordning. */
export function parseVoteringar(kropp: string[]): Votering[] {
  const voteringar: Votering[] = []
  let ordning = ''
  for (let i = 0; i < kropp.length; i++) {
    if (/^Ja-röst/i.test(kropp[i])) ordning = kropp.slice(i, i + 4).join(' ')
    if (!/^Omröstningsresultat$/i.test(kropp[i])) continue
    const v = parseVoteringResultat(kropp.slice(i + 1, i + 4).join(' '))
    if (!v) continue
    // "Ja-röst för X förslag, Nej-röst för Y förslag."
    const m = ordning.match(/Ja-röst(?: för)? (.+?)[,.]?\s+Nej-röst(?: för)? (.+?)(?:\.|,|$)/i)
    if (m) {
      v.jaBetyder = m[1].trim()
      v.nejBetyder = m[2].trim()
      v.proposition = `Ja för ${v.jaBetyder}, Nej för ${v.nejBetyder}.`
    }
    voteringar.push(v)
    ordning = ''
  }
  return voteringar
}

/** Paragraferna i protokollets brödtext (inte innehållsförteckningen). */
export function parseParagrafer(text: string, organ: 'kf' | 'ks'): Paragraf[] {
  const rader = text.split('\n')
  // I brödtexten står diarienumret långt ut till höger ("§ 82      …      Dnr"),
  // i innehållsförteckningen direkt efter ("§ 82   Dnr") — det skiljer dem åt.
  const rubrik = /^\s*§\s*(\d+)\s{6,}(?:Diarienummer|Dnr)\s+(\S+)/
  const starter: number[] = []
  for (let i = 0; i < rader.length; i++) if (rubrik.test(rader[i])) starter.push(i)
  // Omröstningslistorna sist i protokollet hör inte till sista paragrafen
  const listStart = rader.findIndex((r) => /Omröstningslista nr\./.test(r))
  const slut = listStart > 0 ? listStart : rader.length

  return starter.map((start, k) => {
    const [, nr, dnr] = rader[start].match(rubrik)!
    const stopp = Math.min(starter[k + 1] ?? slut, slut)
    const kropp = rader
      .slice(start + 1, stopp)
      .map((r) => r.trim())
      .filter((r) => r && !SIDBRUS.test(r))
    const avsnitt = new Map<string, string[]>()
    const rubrikRader: string[] = []
    let aktuellt: string | null = null
    for (const r of kropp) {
      if (AVSNITT.test(r)) {
        aktuellt = r.toLowerCase()
        if (!avsnitt.has(aktuellt)) avsnitt.set(aktuellt, [])
        continue
      }
      if (aktuellt) avsnitt.get(aktuellt)!.push(r)
      else rubrikRader.push(r)
    }
    // "Ärendet utgår." står under Ärendet, utan Beslut-rubrik
    const ärendet = (avsnitt.get('ärendet') ?? []).join(' ')
    const beslutstext = (
      avsnitt.get('beslut')?.join(' ') ?? (/^ärendet utgår/i.test(ärendet) ? ärendet : '')
    ).trim()
    // Omedelbart justerade paragrafer: beslutet står i det separata protokollet
    const omedelbart = /Paragrafen är omedelbart justerad/i.test(rubrikRader.join(' '))
    const rubrikText = rubrikRader
      .join(' ')
      .replace(/\s*Paragrafen är omedelbart justerad.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    const reservation = (avsnitt.get('reservationer') ?? avsnitt.get('reservation') ?? []).join(' ')
    // En paragraf kan ha flera voteringar (huvudfrågan, sedan t.ex. ett
    // tilläggsförslag). Varje "Omröstningsresultat" följer sin egen ordning.
    const voteringar = parseVoteringar(kropp)
    const votering = voteringar[0]
    return {
      nr,
      ärendeNr: diarienummer(dnr),
      rubrik: rubrikText,
      omedelbartJusterad: omedelbart,
      beslutstext,
      beslut: klassificera(beslutstext, organ),
      reservationer: reservation ? [reservation.trim()] : [],
      votering,
      voteringar,
      fulltext: `§ ${nr} Diarienummer ${dnr}\n${rena(rader.slice(start + 1, stopp))}`,
    }
  })
}

/** "Beslutande"-blocket: vilka som tjänstgjorde (ersättare i stället för ordinarie). */
export function parseNärvaro(text: string): Närvarande[] {
  const rader = text.split('\n')
  const start = rader.findIndex((r) => /^Beslutande\b/.test(r))
  if (start < 0) return []
  const närvarande: Närvarande[] = []
  for (const rad of rader.slice(start, start + 200)) {
    // Listan fortsätter över sidbrytningar — hoppa över sidhuvud/-fot
    if (SIDBRUS.test(rad.trim())) continue
    // Blocket slutar vid nästa etikett — i vänsterkolumnen, eller (2022–2024)
    // indragen som underrubrik: "Ersättare" är de som var där utan att tjänstgöra
    if (rad !== rader[start] && /^[A-ZÅÄÖ]/.test(rad)) break
    if (
      /^(Ersättare|Ej tjänstgörande|Övriga|Utses att justera|Justering|Paragrafer|Underskrifter)\b/.test(
        rad.trim(),
      )
    )
      break
    const innehåll = rad
      .replace(/^Beslutande\s*/, '')
      .replace(/^\s*(Ledamöter|Tjänstgörande ersättare)\s*/, '')
      .trim()
    const m = innehåll.match(/^([A-ZÅÄÖ][\p{L}'’.\- ]+?) \(([\p{L}-]+)\)(.*)$/u)
    if (!m) continue
    const resten = m[3]
    const ersätter = resten.match(/ersätter ([\p{L}'’.\- ]+?) \(/u)?.[1]
    const roll = resten.match(/^,\s*([^§]+?)(?:\s+§|$)/)?.[1]?.trim()
    närvarande.push({ namn: m[1].trim(), parti: m[2], roll, ersätter })
  }
  return närvarande
}

/** Omröstningslistorna → en röst per tjänstgörande ledamot. */
export function parseOmröstningslistor(text: string): Röst[] {
  const rader = text.split('\n')
  const röster: Röst[] = []
  const listorPerParagraf = new Map<string, number>()
  let aktuellLista: string | null = null
  let paragrafNr: string | null = null
  let kolumner: Array<{ röst: Röst['röst']; pos: number }> = []
  for (const rad of rader) {
    const lista = rad.match(/Omröstningslista nr\.\s*(\d+)/)
    if (lista) {
      // Samma listnummer igen = fortsättning på nästa sida (efter "Transport:")
      if (lista[1] !== aktuellLista) {
        aktuellLista = lista[1]
        paragrafNr = null
      }
      kolumner = []
      continue
    }
    const p = rad.match(/^\s*§\s*(\d+)[.\s]/)
    if (p && kolumner.length === 0 && paragrafNr === null) {
      // Bara paragrafens första lista (huvudvoteringen) räknas som namnröster
      const n = (listorPerParagraf.get(p[1]) ?? 0) + 1
      listorPerParagraf.set(p[1], n)
      paragrafNr = n === 1 ? p[1] : '__hoppa__'
      continue
    }
    if (/\bJa\b\s+\bNej\b\s+\bAvst\b\s+\bFrånv\b/.test(rad)) {
      kolumner = (['Ja', 'Nej', 'Avst', 'Frånv'] as const).map((ord, i) => ({
        röst: (['ja', 'nej', 'avstår', 'frånvarande'] as const)[i],
        pos: rad.indexOf(ord) + ord.length / 2,
      }))
      continue
    }
    if (!paragrafNr || paragrafNr === '__hoppa__' || kolumner.length === 0) continue
    const m = rad.match(/^\s*([A-ZÅÄÖ][\p{L}'’.\- ]+?)\s+\(([\p{L}-]+)\)(.*)$/u)
    if (!m) continue
    const x = rad.lastIndexOf('X')
    if (x < 0) continue
    // Ersättaren står mellan partiet (och ev. valkrets "Alla") och röstkolumnerna
    const mellan = rad
      .slice(rad.indexOf(')') + 1, kolumner[0].pos - 2)
      .replace(/\bAlla\b/, '')
      .trim()
    const närmast = kolumner.reduce((a, b) => (Math.abs(b.pos - x) < Math.abs(a.pos - x) ? b : a))
    röster.push({
      paragrafNr,
      namn: mellan || m[1].trim(),
      parti: m[2],
      röst: närmast.röst,
    })
  }
  return röster
}

// --- Körning ----------------------------------------------------------------

async function hämtaPdf(p: Protokoll, wd: Webbdiariet): Promise<string> {
  const fil = join(CACHE, `${p.organ === 'Kommunfullmäktige' ? 'kf' : 'ks'}-${p.datum}.pdf`)
  if (!existsSync(fil)) {
    const url = p.url ?? wd.dokumentUrl(p.filnamnB64!, p.dokumentId!)
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok || buf.subarray(0, 5).toString() !== '%PDF-')
      throw new Error(`Kunde inte hämta ${p.organ} ${p.datum}: HTTP ${res.status}`)
    writeFileSync(fil, buf)
  }
  return execSync(`pdftotext -layout '${fil}' -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
}

async function main() {
  const onlyNew = process.argv.includes('--only-new')
  mkdirSync(CACHE, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const { protokoll } = JSON.parse(
    readFileSync(join(ROOT, 'data/beslut/molndal-protokoll.json'), 'utf-8'),
  )
  const roster = JSON.parse(
    readFileSync(join(ROOT, 'data/politiker/molndal.json'), 'utf-8'),
  ).politiker
  const resolve = createPolitikerResolver(roster)
  const wd = new Webbdiariet()
  await wd.öppna()

  let ok = 0
  for (const p of protokoll as Protokoll[]) {
    const kod = p.organ === 'Kommunfullmäktige' ? 'kf' : 'ks'
    const ut = join(OUTPUT_DIR, `${kod}-${p.datum}.json`)
    if (onlyNew && existsSync(ut)) continue
    const text = await hämtaPdf(p, wd)
    const paragrafer = parseParagrafer(text, kod)
    const närvaro = parseNärvaro(text)
    const röster = parseOmröstningslistor(text)

    const mötesId = `möte-${kod}-${p.datum}`
    const nodes: any[] = [
      {
        id: mötesId,
        typ: 'möte',
        label: `${kod.toUpperCase()} Sammanträde ${p.datum}`,
        data: {
          datum: p.datum,
          organisation: p.organ,
          // Alla tjänstgörande enligt "Beslutande" — även de som inte går att
          // koppla till dagens register (avgångna), till skillnad från närvarade-kanterna
          tjänstgörande: närvaro.length,
          // Ordinarie ledamöter på plats (inte ersättare) — frånvaromåttet
          ordinarieNärvarande: närvaro.filter((n) => !n.ersätter).length,
          källa: p.url ?? 'webbdiarium.molndal.se',
        },
      },
    ]
    const edges: any[] = []
    for (const par of paragrafer) {
      const id = `${kod}-${p.datum}-§${par.nr}`
      nodes.push({
        id,
        typ: 'paragraf',
        label: `§ ${par.nr} ${par.rubrik}`,
        data: {
          paragrafNr: par.nr,
          ärendeNr: par.ärendeNr,
          rubrik: par.rubrik,
          datum: p.datum,
          organ: p.organ,
          beslut: par.beslut,
          beslutstext: par.beslutstext,
          ...(par.omedelbartJusterad ? { omedelbartJusterad: true } : {}),
          reservationer: par.reservationer,
          yrkanden: [],
          ...(par.votering ? { votering: par.votering } : {}),
          ...(par.voteringar.length > 1 ? { voteringar: par.voteringar } : {}),
          fulltext: par.fulltext,
        },
      })
      edges.push({ from: mötesId, to: id, typ: 'beslut_av' })
    }
    let närvaroLänkade = 0
    for (const n of närvaro) {
      const pid = resolve(n.namn, n.parti)
      if (!pid) continue
      närvaroLänkade++
      edges.push({
        from: `politiker-${pid}`,
        to: mötesId,
        typ: 'närvarade',
        label: n.roll ?? undefined,
      })
    }
    let rösterLänkade = 0
    const paragrafIds = new Set(paragrafer.map((x) => x.nr))
    for (const r of röster) {
      if (r.röst === 'frånvarande' || !paragrafIds.has(r.paragrafNr)) continue
      const pid = resolve(r.namn, r.parti)
      if (!pid) continue
      rösterLänkade++
      edges.push({
        from: `politiker-${pid}`,
        to: `${kod}-${p.datum}-§${r.paragrafNr}`,
        typ: `röstade_${r.röst}`,
      })
    }

    // Kontroll: namnlistan ska summera till omröstningsresultatet
    for (const par of paragrafer.filter((x) => x.votering)) {
      const lista = röster.filter((r) => r.paragrafNr === par.nr)
      const ja = lista.filter((r) => r.röst === 'ja').length
      const nej = lista.filter((r) => r.röst === 'nej').length
      if (lista.length && (ja !== par.votering!.ja || nej !== par.votering!.nej))
        console.warn(
          `   ⚠️  ${kod} ${p.datum} § ${par.nr}: lista ${ja}/${nej}, resultat ${par.votering!.ja}/${par.votering!.nej}`,
        )
    }

    writeFileSync(ut, JSON.stringify({ nodes, edges }, null, 2))
    const voteringar = paragrafer.filter((x) => x.votering).length
    console.log(
      `   ✓ ${kod} ${p.datum}: ${paragrafer.length} §, ${voteringar} voteringar, närvaro ${närvaroLänkade}/${närvaro.length}, röster ${rösterLänkade}/${röster.filter((r) => r.röst !== 'frånvarande').length}`,
    )
    ok++
  }
  console.log(`\n✅ ${ok} protokoll → ${OUTPUT_DIR}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
