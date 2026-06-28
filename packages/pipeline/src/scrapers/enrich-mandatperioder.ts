/**
 * enrich-mandatperioder.ts
 *
 * Enriches goteborg.json with historical mandate period data from Wayback Machine.
 * Sources:
 *   - 2017 snapshot → period 2014–2018
 *   - 2020 snapshot → period 2018–2022
 *   - Current uppdrag → period 2022–2026
 *
 * Matches politicians by name (förnamn + efternamn).
 * Adds/updates `mandatperioder` array without overwriting manually curated data.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_PATH = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')

interface WaybackSource {
  url: string
  period: string
}

const SOURCES: WaybackSource[] = [
  {
    url: 'https://web.archive.org/web/20170702/http://politiker.goteborg.se/viewOrganization.jsf?id=176',
    period: '2014-2018',
  },
  {
    url: 'https://web.archive.org/web/20200618/http://politiker.goteborg.se/viewOrganization.jsf?id=176',
    period: '2018-2022',
  },
]

async function fetchNamesFromSnapshot(url: string): Promise<Set<string>> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  const html = await res.text()

  // Old Troman format: pairs of <a> with same person ID (efternamn, förnamn)
  const pattern = /viewPerson[^"]*id=(\d+)[^"]*"[^>]*>\s*([^<]+)/g
  const byId = new Map<string, string[]>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const [, id, name] = match
    const trimmed = name.trim()
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id)!.push(trimmed)
  }

  const names = new Set<string>()
  for (const parts of byId.values()) {
    // parts = [efternamn, förnamn] → normalize to "förnamn efternamn"
    if (parts.length >= 2) {
      names.add(`${parts[1]} ${parts[0]}`.toLowerCase())
    }
  }
  return names
}

async function main() {
  console.log('📜 Enriching mandatperioder from Wayback Machine...\n')

  // Fetch historical snapshots
  const periodNames = new Map<string, Set<string>>()
  for (const source of SOURCES) {
    console.log(`  Fetching ${source.period} (${source.url.slice(0, 60)}...)`)
    const names = await fetchNamesFromSnapshot(source.url)
    periodNames.set(source.period, names)
    console.log(`    → ${names.size} names`)
  }

  // Load current data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  let updated = 0

  for (const p of data.politiker) {
    const name = `${p.förnamn} ${p.efternamn}`.toLowerCase()

    // Skip if manually curated mandatperioder already exist with >1 entry
    if (p.mandatperioder && p.mandatperioder.length > 1) continue

    const periods: string[] = []
    for (const [period, names] of periodNames) {
      if (names.has(name)) periods.push(period)
    }
    // Always add current period
    periods.push('2022-2026')

    if (periods.length > 1 || !p.mandatperioder) {
      p.mandatperioder = periods.map((period) => ({
        period,
        roll: 'KF-ledamot/ersättare',
        källa: period === '2022-2026' ? 'politiker.goteborg.se' : 'Wayback Machine',
      }))
      updated++
    }
  }

  // Save
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2))
  console.log(`\n✅ Updated ${updated}/${data.politiker.length} politicians with historical mandatperioder`)
}

main().catch(console.error)
