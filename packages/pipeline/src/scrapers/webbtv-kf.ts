/**
 * Scraper: Webb-TV — KF Göteborgs sändningar
 *
 * Göteborgs Stad sänder kommunfullmäktige via goteborg.webbtvkf.se.
 * Varje möte har en egen sida: https://goteborg.webbtvkf.se/?YYYYMMDD
 * Datum utan sändning redirectas till /site/login.
 *
 * Läser mötesdatum från data/graf/kf-*.json, verifierar att sändning
 * finns och sparar länkarna. Vid db:seed merged länkarna in som
 * videoUrl på möte-noderna.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = 'https://goteborg.webbtvkf.se'
const DATA_DIR = join(import.meta.dirname, '../../../../data')
const OUTPUT = join(DATA_DIR, 'debatter/webbtv-kf-goteborg.json')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function checkSändning(datum: string): Promise<string | null> {
  const compact = datum.replaceAll('-', '')
  const url = `${BASE_URL}/?${compact}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dearbetarfordig.se)' },
    redirect: 'follow',
  })
  if (!res.ok || res.url.includes('/site/login')) return null
  const html = await res.text()
  return html.includes(`KF Göteborg - ${compact}`) ? url : null
}

async function main() {
  console.log('🎬 Hämtar KF-sändningslänkar från webb-TV...\n')

  const datum = readdirSync(join(DATA_DIR, 'graf'))
    .map((f) => f.match(/^kf-(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()

  console.log(`   ${datum.length} KF-möten i data/graf\n`)

  const sändningar: { datum: string; url: string }[] = []
  for (const d of datum) {
    const url = await checkSändning(d)
    if (url) {
      sändningar.push({ datum: d, url })
      console.log(`   ✓ ${d}`)
    } else {
      console.log(`   – ${d} (ingen sändning)`)
    }
    await sleep(300)
  }

  mkdirSync(join(DATA_DIR, 'debatter'), { recursive: true })
  const output = {
    källa: BASE_URL,
    hämtad: new Date().toISOString(),
    antal: sändningar.length,
    sändningar,
  }
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${sändningar.length}/${datum.length} sändningar → ${OUTPUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
