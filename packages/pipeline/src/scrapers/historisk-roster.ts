/**
 * historisk-roster.ts — förtroendevalda som lämnat under mandatperioden.
 *
 * Voteringsbilagorna 2023–2026 innehåller ~1,5k röster från personer som
 * inte längre finns på politiker.goteborg.se (avgångna ledamöter och
 * ersättare — Wikström, Lann, Moberg …). Deras röster kunde aldrig matchas
 * till roster-uuid:n och tappades vid edge-genereringen
 * (docs/ANALYS-2026-07.md, punkt 19).
 *
 * Wayback Machine har dock crawlat den NYA sajtens organisationssidor
 * (stora svepet 2023-06-05 m.fl.): medlemstabellerna där innehåller samma
 * person-uuid:n som den levande sajten. Denna scraper:
 *
 *   1. hittar alla arkiverade /organisation/<uuid>-sidor via CDX
 *   2. extraherar (uuid, efternamn, förnamn, parti) ur medlemstabellerna
 *   3. diffar mot nuvarande goteborg.json → avgångna personer
 *   4. hämtar deras arkiverade /person/<uuid>-sida när en finns
 *      (uppdragslista + e-post)
 *   5. appendar dem till goteborg.json med `historisk: true`
 *
 * alla-fortroendevalda.ts bevarar historisk-flaggade poster vid omscrape,
 * så veckokörningen skriver inte över dem.
 *
 * Usage: npx tsx packages/pipeline/src/scrapers/historisk-roster.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'

const DATA_PATH = join(import.meta.dirname, '../../../../data/politiker/goteborg.json')
const DELAY_MS = 700
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/

// Äldre snapshots skriver ut partinamnet i klartext; rostret använder
// bokstavskoder.
const PARTIKOD: Record<string, string> = {
  socialdemokraterna: 'S',
  'moderata samlingspartiet': 'M',
  moderaterna: 'M',
  vänsterpartiet: 'V',
  sverigedemokraterna: 'SD',
  liberalerna: 'L',
  miljöpartiet: 'MP',
  'miljöpartiet de gröna': 'MP',
  demokraterna: 'D',
  kristdemokraterna: 'KD',
  centerpartiet: 'C',
  opolitisk: '-',
}

function partikod(raw: string): string {
  return PARTIKOD[raw.trim().toLowerCase()] || raw.trim() || '-'
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function cdx(pathGlob: string): Promise<Array<{ url: string; ts: string }>> {
  const q = `http://web.archive.org/cdx/search/cdx?url=politiker.goteborg.se%2F${pathGlob}*&from=2022&to=2026&filter=statuscode:200&collapse=urlkey&fl=original,timestamp&limit=2000`
  const res = await fetch(q)
  if (!res.ok) throw new Error(`CDX HTTP ${res.status}`)
  return (await res.text())
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [url, ts] = l.split(' ')
      return { url, ts }
    })
}

async function fetchSnapshot(ts: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://web.archive.org/web/${ts}/${url}`, { redirect: 'follow' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

interface Sedd {
  förnamn: string
  efternamn: string
  parti: string
  roller: Set<string>
}

function parseOrgSnapshot(html: string, ackumulerat: Map<string, Sedd>) {
  const $ = cheerio.load(html)
  $('#engagementTable tbody tr, #engagementTable\\:tbody_element tr').each((_, row) => {
    const cells = $(row).find('td')
    const href = cells.eq(0).find('a').attr('href') || ''
    const uuid = href.match(UUID_RE)?.[1]
    if (!uuid || !href.includes('/person/')) return
    const efternamn = cells.eq(0).text().trim()
    const förnamn = cells.eq(1).text().trim()
    const parti = partikod(cells.eq(2).text())
    const roll = cells.eq(3).text().trim()
    if (!förnamn && !efternamn) return
    const sedd = ackumulerat.get(uuid)
    if (sedd) {
      if (roll) sedd.roller.add(roll)
    } else {
      ackumulerat.set(uuid, { förnamn, efternamn, parti, roller: new Set(roll ? [roll] : []) })
    }
  })
}

function parsePersonSnapshot(html: string): {
  email: string | null
  uppdrag: Array<{
    organisation: string
    organisationId: string
    roll: string
    från: string
    till: string | null
  }>
} {
  const $ = cheerio.load(html)
  const emailLink = $('a[href^="mailto:"]').first()
  const email = emailLink.length ? emailLink.text().trim() : null
  const uppdrag: ReturnType<typeof parsePersonSnapshot>['uppdrag'] = []
  $('#engagementTable tbody tr, #engagementTable\\:tbody_element tr')
    .filter((_, row) => $(row).parents('#person-history').length === 0)
    .each((_, row) => {
      const cells = $(row).find('td')
      const orgHref = cells.eq(0).find('a').attr('href') || ''
      const organisationId = orgHref.includes('/organisation/')
        ? orgHref.match(UUID_RE)?.[1] || ''
        : ''
      const organisation = cells.eq(0).text().trim()
      const roll = cells.eq(1).text().trim()
      const från = cells.eq(2).text().trim()
      const till = cells.eq(3).text().trim() || null
      if (organisation) uppdrag.push({ organisation, organisationId, roll, från, till })
    })
  return { email, uppdrag }
}

async function main() {
  console.log('🏛  Historisk roster från Wayback Machine (nya sajten, 2022–)...\n')

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  const nuvarande = new Set<string>((data.politiker as Array<{ id: string }>).map((p) => p.id))

  const orgSnapshots = await cdx('organisation%2F')
  console.log(`   ${orgSnapshots.length} arkiverade organisationssidor`)

  const sedda = new Map<string, Sedd>()
  let i = 0
  for (const s of orgSnapshots) {
    i++
    await sleep(DELAY_MS)
    const html = await fetchSnapshot(s.ts, s.url)
    if (html) parseOrgSnapshot(html, sedda)
    process.stdout.write(`\r   [${i}/${orgSnapshots.length}] sidor, ${sedda.size} personer sedda`)
  }
  console.log()

  const avgångna = [...sedda.entries()].filter(([uuid]) => !nuvarande.has(uuid))
  console.log(`\n   ${avgångna.length} personer i arkivet som saknas i nuvarande roster\n`)

  // Arkiverade personsidor (för uppdrag + e-post) — bygg uuid → snapshot-ts
  const personSnapshots = new Map<string, { url: string; ts: string }>()
  for (const s of await cdx('person%2F')) {
    const uuid = s.url.match(UUID_RE)?.[1]
    if (uuid) personSnapshots.set(uuid, s)
  }

  const nya: Array<Record<string, unknown>> = []
  i = 0
  for (const [uuid, sedd] of avgångna) {
    i++
    let email: string | null = null
    let uppdrag: ReturnType<typeof parsePersonSnapshot>['uppdrag'] = []
    const snap = personSnapshots.get(uuid)
    if (snap) {
      await sleep(DELAY_MS)
      const html = await fetchSnapshot(snap.ts, snap.url)
      if (html) ({ email, uppdrag } = parsePersonSnapshot(html))
    }
    nya.push({
      id: uuid,
      förnamn: sedd.förnamn,
      efternamn: sedd.efternamn,
      parti: sedd.parti,
      email,
      uppdrag,
      mandatperioder: [{ period: '2022-2026', roll: 'förtroendevald', källa: 'Wayback Machine' }],
      närstående: null,
      historisk: true,
    })
    console.log(
      `   [${i}/${avgångna.length}] ${sedd.förnamn} ${sedd.efternamn} (${sedd.parti})${snap ? ` — personsida ✓ (${uppdrag.length} uppdrag)` : ''}`,
    )
  }

  data.politiker.push(...nya)
  data.antal = data.politiker.length
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2))
  console.log(`\n✅ ${nya.length} historiska personer tillagda → ${data.antal} totalt i rostret`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
