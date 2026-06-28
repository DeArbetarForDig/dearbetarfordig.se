/**
 * Scraper: Nämndledamöter från politiker.goteborg.se
 *
 * Hämtar fullständiga ledamötslistor för alla nämnder (inte bara KF-ledamöter).
 * Sparar till data/politiker/namnd-ledamoter.json
 *
 * Användning:
 *   npx tsx packages/pipeline/src/scrapers/namnd-ledamoter.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://politiker.goteborg.se'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/politiker')
const DELAY_MS = 300

// Known nämnd organisation IDs on politiker.goteborg.se
// Fetch by searching for "nämnd" in the organisation list
const NAMND_ORG_IDS: Record<string, string> = {
  'Göteborgs Stads förskolenämnd': '',
  'Göteborgs Stads grundskolenämnd': '',
  'Göteborgs Stads utbildningsnämnd': '',
  'Göteborgs Stads socialnämnd Nordost': '',
  'Göteborgs Stads socialnämnd Centrum': '',
  'Göteborgs Stads socialnämnd Sydväst': '',
  'Göteborgs Stads socialnämnd Hisingen': '',
  'Göteborgs Stads äldre samt vård- och omsorgsnämnd': '',
  'Göteborgs Stads nämnden för funktionsstöd': '',
  'Göteborgs Stads stadsmiljönämnd': '',
  'Göteborgs Stads stadsbyggnadsnämnd': '',
  'Göteborgs Stads kulturnämnd': '',
  'Göteborgs Stads idrotts- och föreningsnämnd': '',
  'Göteborgs Stads exploateringsnämnd': '',
  'Göteborgs Stads nämnden för arbetsmarknad och vuxenutbildning': '',
}

interface NämndMember {
  id: string
  förnamn: string
  efternamn: string
  parti: string
  roll: string
  organisation: string
  organisationId: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchPage(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

/**
 * Discover all nämnd organisation IDs by scraping the organisation list
 */
async function discoverNämndOrgs(): Promise<{ id: string; namn: string }[]> {
  // Fetch the organisation search/list page
  const html = await fetchPage('/organisation')
  const $ = cheerio.load(html)
  const orgs: { id: string; namn: string }[] = []

  $('a[href*="/organisation/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const id = href.split('/organisation/')[1]?.split('?')[0]?.split('/')[0]
    const namn = $(el).text().trim()
    if (id && namn && namn.toLowerCase().includes('nämnd')) {
      orgs.push({ id, namn })
    }
  })

  // Also try table rows
  $('tr').each((_, row) => {
    const link = $(row).find('a[href*="/organisation/"]').first()
    const href = link.attr('href') || ''
    const id = href.split('/organisation/')[1]?.split('?')[0]?.split('/')[0]
    const namn = link.text().trim()
    if (id && namn && namn.toLowerCase().includes('nämnd') && !orgs.find(o => o.id === id)) {
      orgs.push({ id, namn })
    }
  })

  return orgs
}

/**
 * Extract org IDs from the uppdrag data in existing politiker file
 */
function extractOrgIds(): Map<string, string> {
  const polFile = join(OUTPUT_DIR, 'goteborg.json')
  if (!existsSync(polFile)) return new Map()

  const data = JSON.parse(readFileSync(polFile, 'utf-8'))
  const orgMap = new Map<string, string>()

  for (const p of data.politiker) {
    for (const u of p.uppdrag || []) {
      if (u.organisationId && u.organisation?.toLowerCase().includes('nämnd')) {
        orgMap.set(u.organisation, u.organisationId)
      }
    }
  }
  return orgMap
}

/**
 * Scrape all members of a given organisation
 */
async function scrapeOrgMembers(orgId: string, orgNamn: string): Promise<NämndMember[]> {
  const html = await fetchPage(`/organisation/${orgId}`)
  const $ = cheerio.load(html)
  const members: NämndMember[] = []

  $('#engagementTable\\:tbody_element tr, #engagementTable tbody tr').each((_, row) => {
    const cells = $(row).find('td')
    const link = cells.eq(0).find('a')
    const href = link.attr('href') || ''
    const id = href.split('/person/')[1]?.split('?')[0] || ''
    const efternamn = cells.eq(0).text().trim()
    const förnamn = cells.eq(1).text().trim()
    const parti = cells.eq(2).text().trim()
    const roll = cells.eq(3).text().trim()

    if (id && (förnamn || efternamn)) {
      members.push({ id, förnamn, efternamn, parti, roll, organisation: orgNamn, organisationId: orgId })
    }
  })

  return members
}

async function main() {
  console.log('🔍 Scraping nämndledamöter från politiker.goteborg.se...\n')
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Get org IDs from existing politician data
  const orgMap = extractOrgIds()
  console.log(`   Hittade ${orgMap.size} nämnd-organisationer i befintlig data`)

  if (orgMap.size === 0) {
    console.error('   ✗ Kör scrape:politiker först')
    process.exit(1)
  }

  // Also try to discover more from the site
  try {
    const discovered = await discoverNämndOrgs()
    for (const { id, namn } of discovered) {
      if (!orgMap.has(namn)) {
        orgMap.set(namn, id)
      }
    }
    console.log(`   + ${discovered.length} från organisations-sidan`)
  } catch (e) {
    console.log('   (organisations-sida ej tillgänglig, använder befintliga ID:n)')
  }

  // Scrape each nämnd
  const allMembers: NämndMember[] = []
  const byOrg = new Map<string, NämndMember[]>()
  let i = 0

  for (const [orgNamn, orgId] of orgMap) {
    i++
    if (!orgId) continue
    process.stdout.write(`   [${i}/${orgMap.size}] ${orgNamn.replace('Göteborgs Stads ', '')}...`)
    try {
      await sleep(DELAY_MS)
      const members = await scrapeOrgMembers(orgId, orgNamn)
      // Deduplicate by person ID
      const seen = new Set<string>()
      const unique = members.filter(m => {
        if (seen.has(m.id)) return false
        seen.add(m.id)
        return true
      })
      byOrg.set(orgNamn, unique)
      allMembers.push(...unique)
      console.log(` ✓ ${unique.length} ledamöter`)
    } catch (err) {
      console.log(` ✗ ${err}`)
    }
  }

  // Save
  const output = {
    källa: BASE_URL,
    hämtad: new Date().toISOString(),
    antal: allMembers.length,
    nämnder: Object.fromEntries(byOrg),
  }
  const outPath = join(OUTPUT_DIR, 'namnd-ledamoter.json')
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${outPath} (${allMembers.length} ledamöter i ${byOrg.size} nämnder)`)
}

main().catch(console.error)
