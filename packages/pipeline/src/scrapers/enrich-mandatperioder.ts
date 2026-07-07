/**
 * enrich-mandatperioder.ts
 *
 * Enriches goteborg.json with historical mandate period data from the
 * Wayback Machine. The live site only shows each person's CURRENT
 * appointment interval (annually renewed uppdrag all start 2026-01-01),
 * so tenure has to come from archived snapshots of the old JSF site:
 *
 *   - snapshots from 2017        → period 2014–2018
 *   - snapshots from 2020–2021   → period 2018–2022
 *
 * Unlike the first version (which only read Kommunfullmäktige, org id
 * 176), this walks EVERY archived viewOrganization.jsf page in the
 * window — nämnder, bolag, stiftelser — so nämnd-only veterans get their
 * history too. Discovery goes through the CDX API; names are matched
 * against the roster (förnamn + efternamn, diacritics-insensitive).
 *
 * Existing mandatperioder entries are kept as-is; only missing periods
 * are added. Wayback is polite-crawled with a delay.
 *
 * Usage: npx tsx packages/pipeline/src/scrapers/enrich-mandatperioder.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_PATH = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')
const DELAY_MS = 700

interface Window {
  from: string
  to: string
  period: string
}

const WINDOWS: Window[] = [
  { from: '2017', to: '2017', period: '2014-2018' },
  { from: '2020', to: '2021', period: '2018-2022' },
]

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function normName(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** All archived viewOrganization.jsf snapshots in the window, one per org. */
async function discoverOrgSnapshots(w: Window): Promise<Array<{ url: string; ts: string }>> {
  const cdx = `http://web.archive.org/cdx/search/cdx?url=politiker.goteborg.se%2FviewOrganization.jsf*&from=${w.from}&to=${w.to}&filter=statuscode:200&collapse=urlkey&fl=original,timestamp&limit=1000`
  const res = await fetch(cdx)
  if (!res.ok) throw new Error(`CDX HTTP ${res.status}`)
  const lines = (await res.text()).trim().split('\n').filter(Boolean)
  return lines.map((l) => {
    const [original, ts] = l.split(' ')
    return { url: original, ts }
  })
}

/** Names on one archived org page. Old Troman format lists each person as
 *  two viewPerson-links with the same id: efternamn, förnamn. */
function extractNames(html: string): Set<string> {
  const byId = new Map<string, string[]>()
  const pattern = /viewPerson[^"]*id=(\d+)[^"]*"[^>]*>\s*([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const [, id, name] = match
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id)?.push(name.trim())
  }
  const names = new Set<string>()
  for (const parts of byId.values()) {
    if (parts.length >= 2) names.add(normName(`${parts[1]} ${parts[0]}`))
  }
  return names
}

async function fetchNamesForPeriod(w: Window): Promise<Set<string>> {
  const snapshots = await discoverOrgSnapshots(w)
  console.log(`  [${w.period}] ${snapshots.length} arkiverade organisationssidor`)
  const names = new Set<string>()
  let i = 0
  for (const s of snapshots) {
    i++
    await sleep(DELAY_MS)
    try {
      const res = await fetch(`https://web.archive.org/web/${s.ts}/${s.url}`, {
        redirect: 'follow',
      })
      if (!res.ok) continue
      for (const n of extractNames(await res.text())) names.add(n)
      process.stdout.write(`\r  [${w.period}] ${i}/${snapshots.length} sidor, ${names.size} namn`)
    } catch {
      // enstaka trasiga snapshots är väntat — namnen kommer från unionen
    }
  }
  console.log()
  return names
}

async function main() {
  console.log('📜 Enriching mandatperioder from Wayback Machine (alla organ)...\n')

  const periodNames = new Map<string, Set<string>>()
  for (const w of WINDOWS) {
    periodNames.set(w.period, await fetchNamesForPeriod(w))
  }

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  let updated = 0

  for (const p of data.politiker) {
    const name = normName(`${p.förnamn} ${p.efternamn}`)
    const existing: Array<{ period: string }> = p.mandatperioder || []
    const har = new Set(existing.map((m) => m.period))

    const nya: Array<{ period: string; roll: string; källa: string }> = []
    for (const [period, names] of periodNames) {
      if (!har.has(period) && names.has(name)) {
        nya.push({ period, roll: 'förtroendevald', källa: 'Wayback Machine' })
      }
    }
    // Complete the chain up to today — but only for people with confirmed
    // history (or existing entries). Adding 2022-2026 to EVERYONE would turn
    // a genuine 2025 newcomer's "Aktiv sedan" into 2022; without wayback
    // evidence their min(uppdrag.från) fallback is less wrong.
    if (!har.has('2022-2026') && (nya.length > 0 || existing.length > 0)) {
      nya.push({ period: '2022-2026', roll: 'förtroendevald', källa: 'politiker.goteborg.se' })
    }

    if (nya.length > 0) {
      p.mandatperioder = [...existing, ...nya].sort((a, b) => a.period.localeCompare(b.period))
      updated++
    }
  }

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2))
  console.log(
    `\n✅ Updated ${updated}/${data.politiker.length} politicians with historical mandatperioder`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
