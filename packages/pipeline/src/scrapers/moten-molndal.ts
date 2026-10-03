/**
 * Scraper: Mölndals stads sammanträdeskalender (molndal.se/.../moten-protokoll-kallelser).
 *
 * Sidan är en tabell per organ och månad. Ett datum som är en länk till
 * webbdiarium.molndal.se har publicerade handlingar (kallelse/protokoll);
 * ett datum i klartext är ett planerat möte utan handlingar ännu.
 * Protokollen själva ligger i webbdiariet (SPA utan öppet API), så här
 * sparas bara mötet + länken dit.
 *
 * Usage: npx tsx packages/pipeline/src/scrapers/moten-molndal.ts
 * Output: data/beslut/molndal-moten.json
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KÄLLA = 'https://www.molndal.se/kommun-och-politik/moten-protokoll-kallelser'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/beslut')

export interface Möte {
  organ: string
  datum: string
  url: string
}

export function parseMöten(html: string): Möte[] {
  const re =
    /href="(https:\/\/webbdiarium\.molndal\.se\/#!\/search\/\?t=1&(?:amp;)*i=([^&"]+)&(?:amp;)*d=(\d{4}-\d{2}-\d{2})[^"]*)"/g
  const möten = new Map<string, Möte>()
  for (const m of html.matchAll(re)) {
    const organ = decodeURIComponent(m[2])
    const datum = m[3]
    const url = m[1].replace(/&(?:amp;)+/g, '&')
    möten.set(`${organ}|${datum}`, { organ, datum, url })
  }
  return [...möten.values()].sort(
    (a, b) => b.datum.localeCompare(a.datum) || a.organ.localeCompare(b.organ, 'sv'),
  )
}

async function main() {
  const res = await fetch(KÄLLA, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${KÄLLA}`)
  const möten = parseMöten(await res.text())
  if (möten.length === 0) throw new Error('Inga möten hittade — har sidans struktur ändrats?')

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const outPath = join(OUTPUT_DIR, 'molndal-moten.json')
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        kommun: 'molndal',
        källa: KÄLLA,
        hämtad: new Date().toISOString(),
        antal: möten.length,
        möten,
      },
      null,
      2,
    ),
  )
  const organ = new Set(möten.map((m) => m.organ))
  console.log(`✅ ${outPath} (${möten.length} möten med handlingar, ${organ.size} organ)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
