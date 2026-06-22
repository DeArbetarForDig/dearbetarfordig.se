/**
 * Scraper: politiker.goteborg.se (aka goteborg.tromanpublik.se)
 *
 * Hämtar alla förtroendevalda i Göteborgs Stad KF.
 * Static HTML — Cheerio räcker, ingen Playwright behövs.
 *
 * Steg:
 * 1. Hämta KF-listan → alla personer med UUID, namn, parti, roll
 * 2. Hämta varje persons sida → email, alla uppdrag med datum
 * 3. Spara till data/politiker/goteborg.json
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://politiker.goteborg.se'
const KF_ORG_ID = '8f8da821-ebcd-4d1a-8a91-b1427de24de5'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/politiker')
const DELAY_MS = 300

interface RawPerson {
  id: string
  förnamn: string
  efternamn: string
  parti: string
  rollKF: string
}

interface PersonDetail {
  id: string
  förnamn: string
  efternamn: string
  parti: string
  email: string | null
  uppdrag: Array<{
    organisation: string
    organisationId: string
    roll: string
    från: string
    till: string | null
  }>
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchPage(path: string): Promise<string> {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

async function scrapeKFList(): Promise<RawPerson[]> {
  const html = await fetchPage(`/organisation/${KF_ORG_ID}`)
  const $ = cheerio.load(html)
  const people: RawPerson[] = []

  $('#engagementTable\\:tbody_element tr').each((_, row) => {
    const cells = $(row).find('td')
    const link = cells.eq(0).find('a')
    const href = link.attr('href') || ''
    const id = href.split('/person/')[1] || ''
    const efternamn = cells.eq(0).text().trim()
    const förnamn = cells.eq(1).text().trim()
    const parti = cells.eq(2).text().trim()
    const rollKF = cells.eq(3).text().trim()

    if (id && förnamn) {
      people.push({ id, förnamn, efternamn, parti, rollKF })
    }
  })

  return people
}

async function scrapePersonDetail(
  personId: string,
): Promise<Omit<PersonDetail, 'förnamn' | 'efternamn' | 'parti'>> {
  const html = await fetchPage(`/person/${personId}`)
  const $ = cheerio.load(html)

  // Email
  const emailLink = $('a[href^="mailto:"]').first()
  const email = emailLink.length ? emailLink.text().trim() : null

  // Uppdrag table
  const uppdrag: PersonDetail['uppdrag'] = []
  $('#engagementTable\\:tbody_element tr, #engagementTable tbody tr').each((_, row) => {
    const cells = $(row).find('td')
    const orgLink = cells.eq(0).find('a')
    const orgHref = orgLink.attr('href') || ''
    const organisationId = orgHref.split('/organisation/')[1] || ''
    const organisation = cells.eq(0).text().trim()
    const roll = cells.eq(1).text().trim()
    const från = cells.eq(2).text().trim()
    const tillText = cells.eq(3).text().trim()
    const till = tillText || null

    if (organisation) {
      uppdrag.push({ organisation, organisationId, roll, från, till })
    }
  })

  return { id: personId, email, uppdrag }
}

async function main() {
  console.log('🔍 Scraping politiker.goteborg.se — KF Göteborg...\n')

  // Step 1: Get KF member list
  const kfList = await scrapeKFList()
  console.log(`   Hittade ${kfList.length} uppdrag i KF`)

  // Deduplicate by person ID (same person can appear twice if ledamot + ersättare)
  const uniquePersons = new Map<string, RawPerson>()
  for (const p of kfList) {
    if (!uniquePersons.has(p.id)) {
      uniquePersons.set(p.id, p)
    }
  }
  console.log(`   ${uniquePersons.size} unika personer\n`)

  // Step 2: Fetch each person's detail page
  const results: PersonDetail[] = []
  let i = 0
  for (const [id, raw] of uniquePersons) {
    i++
    process.stdout.write(`   [${i}/${uniquePersons.size}] ${raw.förnamn} ${raw.efternamn}...`)
    try {
      const detail = await scrapePersonDetail(id)
      results.push({
        ...detail,
        förnamn: raw.förnamn,
        efternamn: raw.efternamn,
        parti: raw.parti,
      })
      console.log(` ✓ (${detail.uppdrag.length} uppdrag)`)
    } catch (err) {
      console.log(` ✗ ${err}`)
    }
    await sleep(DELAY_MS)
  }

  // Step 3: Save
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const output = {
    kommun: 'goteborg',
    källa: `${BASE_URL}/organisation/${KF_ORG_ID}`,
    hämtad: new Date().toISOString(),
    mandatperiod: { från: '2022-10-15', till: '2026-10-14' },
    antal: results.length,
    politiker: results,
  }

  const outPath = join(OUTPUT_DIR, 'goteborg.json')
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ Sparad: ${outPath} (${results.length} politiker)`)
}

main().catch(console.error)
