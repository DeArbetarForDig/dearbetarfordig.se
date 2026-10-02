/**
 * Downloader: Valmyndighetens mandatfördelning för val 2026 — KF Göteborg.
 *
 * Källa: https://resultat.val.se/data/resultat/val2026/KF_14_1480_{S|P}.json
 * (länskod 14 = Västra Götaland, kommunkod 1480 = Göteborg — samma kommunkod
 * som scrapers/kandidater.ts). Försöker "S" (slutligt, länsstyrelsens
 * fastställda resultat) först, faller tillbaka till "P" (preliminärt,
 * valnattens rösträkning) tills det slutliga protokollet publicerats.
 *
 * Det slutliga resultatet har dessutom ledamoterPerParti: vilka kandidater
 * som faktiskt får mandaten (personval inräknat) med ersättare. Det
 * preliminära saknar det — då approximerar mandatperiod-2026.astro med
 * listordning.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { partiKod } from './parti-kod'

const LÄNSKOD = '14'
const KOMMUNKOD = '1480'
const BASE_URL = `https://resultat.val.se/data/resultat/val2026/KF_${LÄNSKOD}_${KOMMUNKOD}`
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/politiker')

interface PartiMandat {
  parti: string
  partiNamn: string
  antalMandat: number
  antalMandatFöregåendeVal: number
}

async function hämtaResultat(): Promise<{ url: string; data: any }> {
  for (const tillfälle of ['S', 'P']) {
    const url = `${BASE_URL}_${tillfälle}.json`
    const res = await fetch(url)
    if (res.ok) return { url, data: await res.json() }
  }
  throw new Error(`Inget resultat hittat på ${BASE_URL}_{S,P}.json`)
}

async function main() {
  console.log('🔍 Hämtar mandatfördelning val 2026 (Valmyndigheten)...\n')
  const { url, data } = await hämtaResultat()

  const partiMandat: PartiMandat[] = (data.partiMandat || []).map((p: any) => ({
    parti: partiKod(p.partiforkortning, p.partibeteckning),
    partiNamn: p.partibeteckning,
    antalMandat: p.antalMandat,
    antalMandatFöregåendeVal: p.antalMandatForegaendeVal,
  }))

  // Bara i slutligt resultat: vilka kandidater som faktiskt fick mandaten
  // (personval inräknat) och deras ersättare. kandidatnummer = kandidater.id
  // (KANDIDATNUMMER i kandidaturer.csv, se scrapers/kandidater.ts).
  const ledamöter = (data.ledamoterPerParti || []).flatMap((p: any) =>
    p.ledamoter.map((l: any) => ({
      kandidatId: String(l.kandidatnummer),
      parti: partiKod(p.partiforkortning, p.partibeteckning),
      personvald: Boolean(l.personvald),
      ersättare: (l.ersattare || []).map((e: any) => String(e.kandidatnummer)),
    })),
  )

  const totalMandat = partiMandat.reduce((s, p) => s + p.antalMandat, 0)
  console.log(
    `   ${data.rakningstillfalle} resultat, ${totalMandat} mandat, ${partiMandat.length} partier\n`,
  )

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, 'mandat-2026-goteborg.json')
  const output = {
    val: '2026',
    kommun: 'goteborg',
    valtyp: 'kommunfullmäktige',
    källa: url,
    hämtad: new Date().toISOString(),
    rakningstillfälle: data.rakningstillfalle,
    senasteUppdateringstid: data.senasteUppdateringstid,
    antalValdistriktRäknade: data.antalValdistriktRaknade,
    antalValdistriktSomSkaRäknas: data.antalValdistriktSomSkaRaknas,
    valdeltagande: data.valdeltagande,
    totaltAntalRöster: data.totaltAntalRoster,
    totalMandat,
    partiMandat,
    ledamöter,
  }
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`✅ Sparad: ${outPath}`)
}

main().catch(console.error)
