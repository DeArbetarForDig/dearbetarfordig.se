/**
 * Förteckning över Mölndals KF- och KS-protokoll från mandatperioden
 * 2022–2026 och framåt → data/beslut/molndal-protokoll.json.
 *
 * Två källor, för protokollen ligger på olika ställen beroende på ålder:
 *
 * 1. Webbdiariet (webbdiarium.molndal.se, Formpipe Ciceron). Har ett
 *    JSON-RPC-API (POST /json, "CiceronsokServer:*"), men visar bara möten
 *    ungefär två år bakåt. Search → ReadItems → ReadObjectDetails ger mötets
 *    dokumentlista; protokollet hämtas via download/document med filnamn
 *    (base64) + dokument-id + session.
 *
 * 2. Stadens arkiv (molndal.se/download/…). Äldre protokoll flyttas dit som
 *    filer utan någon listning (mappsidan ger 404, sajtsöket indexerar dem
 *    inte). Sitevision svarar dock på /download/{id}/x/x med en redirect till
 *    filens riktiga namn, så protokollen hittas genom att gå igenom id:n i de
 *    uppladdningsomgångar de ligger i (ARKIV nedan — utökas när fler omgångar
 *    dyker upp). Bara HEAD-anrop, ett par i taget.
 *
 * 3. Mellanrummet (jan–sep 2024): för gammalt för webbdiariets mötessök,
 *    ännu inte flyttat till arkivet — men dokumenten finns kvar i
 *    webbdiariet. Filnamnet följer mötesdatumet (20240221_protokoll_kf.pub.pdf)
 *    och dokument-id:n hittades en gång 2026-10-03 genom att pröva id:n nära
 *    kända ankare (sökmotorindexerade länkar); datumen är KF:s och KS:s
 *    beslutade sammanträdesdagar 2024 (KS 2023-09-27 § 237). Saknas: KS
 *    2024-08-28 (inte hittat) och KS okt–dec 2022 (inte i någon källa).
 *
 * Usage: npx tsx packages/pipeline/src/scrapers/protokoll-molndal.ts [--full]
 *   Utan --full återanvänds arkivdelen ur den befintliga utfilen (arkivet
 *   ändras inte; genomsökningen är ~800 anrop) — bara webbdiariet hämtas om.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FRÅN = '2022-10-15' // mandatperioden 2022–2026 börjar
const WEBBDIARIET = 'https://webbdiarium.molndal.se'
const OUTPUT = join(import.meta.dirname, '../../../../data/beslut/molndal-protokoll.json')

// Uppladdningsomgångar i molndal.se:s filarkiv som innehåller KF/KS-protokoll
// (id = prefix + hex). Hittade 2026-10-03.
const ARKIV = [
  { prefix: '18.5ba77e9a19a7d80c6e0', från: 0xb900, till: 0xb920, innehåll: 'KF 2022' },
  { prefix: '18.707ac4a619b2bed27ae7', från: 0x5300, till: 0x5600, innehåll: 'KF och KS 2023' },
]

const WEBBDIARIET_KÄNDA: Array<{ organ: Organ; datum: string; dokumentId: string }> = [
  { organ: 'Kommunstyrelsen', datum: '2024-01-24', dokumentId: '1767' },
  { organ: 'Kommunfullmäktige', datum: '2024-02-21', dokumentId: '1886' },
  { organ: 'Kommunstyrelsen', datum: '2024-02-28', dokumentId: '1914' },
  { organ: 'Kommunfullmäktige', datum: '2024-03-20', dokumentId: '2034' },
  { organ: 'Kommunstyrelsen', datum: '2024-03-27', dokumentId: '2055' },
  { organ: 'Kommunfullmäktige', datum: '2024-04-17', dokumentId: '2157' },
  { organ: 'Kommunstyrelsen', datum: '2024-04-24', dokumentId: '2181' },
  { organ: 'Kommunfullmäktige', datum: '2024-05-15', dokumentId: '2258' },
  { organ: 'Kommunstyrelsen', datum: '2024-05-29', dokumentId: '2320' },
  { organ: 'Kommunstyrelsen', datum: '2024-06-12', dokumentId: '2398' },
  { organ: 'Kommunfullmäktige', datum: '2024-06-19', dokumentId: '2421' },
  { organ: 'Kommunfullmäktige', datum: '2024-09-18', dokumentId: '2719' },
  { organ: 'Kommunstyrelsen', datum: '2024-09-25', dokumentId: '2732' },
  { organ: 'Kommunstyrelsen', datum: '2024-10-02', dokumentId: '2750' },
]

const ORGAN = {
  Kommunfullmäktige: 'kf',
  Kommunstyrelsen: 'ks',
} as const
type Organ = keyof typeof ORGAN

export interface Protokoll {
  organ: Organ
  datum: string
  källa: 'webbdiariet' | 'arkiv'
  /** arkiv: direkt-URL. webbdiariet: kräver session — se webbdiarietUrl(). */
  url?: string
  dokumentId?: string
  filnamnB64?: string
}

// --- Webbdiariet ---------------------------------------------------------

export class Webbdiariet {
  private sessionId: string | null = null

  async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const body: Record<string, unknown> = { jsonrpc: '2.0', method, params }
    if (this.sessionId) body.session_id = this.sessionId
    const res = await fetch(`${WEBBDIARIET}/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Webbdiariet ${method}: HTTP ${res.status}`)
    const data = await res.json()
    if (data.session_id) this.sessionId = data.session_id
    if (data.error) throw new Error(`Webbdiariet ${method}: ${data.error.message}`)
    return data.result
  }

  async öppna() {
    this.sessionId = null
    await this.rpc('CiceronsokServer:Test')
  }

  /** Nedladdnings-URL för ett dokument — giltig i den aktuella sessionen. */
  dokumentUrl(filnamnB64: string, dokumentId: string): string {
    const q = new URLSearchParams({ filename: filnamnB64, id: dokumentId })
    if (this.sessionId) q.set('session_id', this.sessionId)
    return `${WEBBDIARIET}/download/document?${q}`
  }
}

async function frånWebbdiariet(): Promise<Protokoll[]> {
  const wd = new Webbdiariet()
  await wd.öppna()
  const idag = new Date().toISOString().slice(0, 10)
  const protokoll: Protokoll[] = []
  for (const organ of Object.keys(ORGAN) as Organ[]) {
    const searchId = `daf-${ORGAN[organ]}`
    // doctype måste vara ett tal här (i ReadObject:s param däremot en sträng)
    await wd.rpc('CiceronsokServer:Search', {
      search_id: searchId,
      doctype: 1,
      text: '',
      param: JSON.stringify({
        diary: 'KS',
        board: organ,
        from_date: FRÅN,
        to_date: idag,
        hasFiles: false,
      }),
    })
    const { results = [] } = await wd.rpc('CiceronsokServer:ReadItems', {
      search_id: searchId,
      offset: 0,
      limit: 250,
    })
    for (const möte of results) {
      const datum = möte.title.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
      if (!datum) continue
      const detaljer = await wd.rpc('CiceronsokServer:ReadObjectDetails', {
        search_id: searchId,
        id: möte.id,
      })
      const dokument = JSON.parse(detaljer.value).documents ?? []
      // "Protokoll kommunfullmäktige 2026-09-17" — inte protokollsutdrag och inte
      // det separata "…, omedelbart justerat" (bara de paragraferna)
      const p = dokument.find((d: any) => /^protokoll \S+ \d{4}-\d{2}-\d{2}$/i.test(d.name.trim()))
      if (!p) continue
      protokoll.push({
        organ,
        datum,
        källa: 'webbdiariet',
        dokumentId: p.id,
        filnamnB64: p.filename_b64,
      })
    }
  }
  return protokoll
}

// --- Arkivet -------------------------------------------------------------

async function arkivfil(id: string): Promise<string | null> {
  const res = await fetch(`https://www.molndal.se/download/${id}/1/x.pdf`, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  return res.status === 301 || res.status === 302 ? res.headers.get('location') : null
}

async function frånArkivet(): Promise<Protokoll[]> {
  const protokoll: Protokoll[] = []
  for (const { prefix, från, till } of ARKIV) {
    const ids = Array.from({ length: till - från }, (_, i) => `${prefix}${(från + i).toString(16)}`)
    // Några åt gången — det är stadens webbserver
    for (let i = 0; i < ids.length; i += 4) {
      const platser = await Promise.all(ids.slice(i, i + 4).map(arkivfil))
      for (const plats of platser) {
        // Huvudprotokollet, t.ex. 20231025_protokoll_ks.pdf — inte de omedelbart
        // justerade utdragen (20230222_protokoll_ks_57.pdf), de ingår i huvudprotokollet
        const m =
          plats &&
          decodeURIComponent(plats).match(/\/(\d{4})(\d{2})(\d{2})_protokoll_(kf|ks)\.pdf$/i)
        if (!m) continue
        const datum = `${m[1]}-${m[2]}-${m[3]}`
        if (datum < FRÅN) continue
        const organ = m[4].toLowerCase() === 'kf' ? 'Kommunfullmäktige' : 'Kommunstyrelsen'
        protokoll.push({ organ, datum, källa: 'arkiv', url: `https://www.molndal.se${plats}` })
      }
    }
  }
  return protokoll
}

function kända(): Protokoll[] {
  return WEBBDIARIET_KÄNDA.map(({ organ, datum, dokumentId }) => ({
    organ,
    datum,
    källa: 'webbdiariet',
    dokumentId,
    filnamnB64: Buffer.from(
      `${datum.replaceAll('-', '')}_protokoll_${ORGAN[organ]}.pub.pdf`,
    ).toString('base64'),
  }))
}

function sparatArkiv(): Protokoll[] | null {
  if (process.argv.includes('--full') || !existsSync(OUTPUT)) return null
  const tidigare = JSON.parse(readFileSync(OUTPUT, 'utf-8')).protokoll as Protokoll[]
  const arkiv = tidigare.filter((p) => p.källa === 'arkiv')
  return arkiv.length ? arkiv : null
}

async function main() {
  const [webb, arkiv] = await Promise.all([frånWebbdiariet(), sparatArkiv() ?? frånArkivet()])
  // Samma möte i båda källorna → webbdiariet vinner (originalet)
  const perMöte = new Map<string, Protokoll>()
  for (const p of [...arkiv, ...kända(), ...webb]) perMöte.set(`${p.organ}|${p.datum}`, p)
  const protokoll = [...perMöte.values()].sort(
    (a, b) => a.datum.localeCompare(b.datum) || a.organ.localeCompare(b.organ),
  )

  mkdirSync(join(OUTPUT, '..'), { recursive: true })
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        kommun: 'molndal',
        från: FRÅN,
        hämtad: new Date().toISOString(),
        antal: protokoll.length,
        protokoll,
      },
      null,
      2,
    ),
  )
  for (const organ of Object.keys(ORGAN))
    console.log(`   ${organ}: ${protokoll.filter((p) => p.organ === organ).length} protokoll`)
  console.log(`✅ ${OUTPUT} (${webb.length} från webbdiariet, ${arkiv.length} från arkivet)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
