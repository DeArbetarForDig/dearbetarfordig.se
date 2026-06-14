/**
 * Scraper: politiker.goteborg.se
 *
 * Hämtar alla förtroendevalda i Göteborgs Stad.
 * Källa: https://politiker.goteborg.se
 * Format: JSF-app med UUID-baserade URLs (/organisation/{uuid})
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Politiker } from '@daf/shared'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://politiker.goteborg.se'
const OUTPUT_DIR = join(import.meta.dirname, '../../../data/politiker')

async function fetchPage(path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`)
  return res.text()
}

async function scrapeOrganisationer(): Promise<Array<{ id: string; namn: string }>> {
  const html = await fetchPage('/')
  const $ = cheerio.load(html)
  const orgs: Array<{ id: string; namn: string }> = []

  $('a[href*="/organisation/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const id = href.split('/organisation/')[1]
    const namn = $(el).text().trim()
    if (id && namn) {
      orgs.push({ id, namn })
    }
  })

  return orgs
}

async function scrapePolitiker(orgId: string): Promise<Partial<Politiker>[]> {
  const html = await fetchPage(`/viewOrganization.jsf?id=${orgId}`)
  const $ = cheerio.load(html)
  const politiker: Partial<Politiker>[] = []

  // TODO: parse the JSF table structure
  // politiker.goteborg.se uses JSF with dynamic rendering
  // May need Playwright for full rendering

  return politiker
}

async function main() {
  console.log('🔍 Scraping politiker.goteborg.se...')

  const orgs = await scrapeOrganisationer()
  console.log(`   Hittade ${orgs.length} organisationer`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(join(OUTPUT_DIR, 'organisationer-goteborg.json'), JSON.stringify(orgs, null, 2))

  console.log(`✅ Sparad: ${OUTPUT_DIR}/organisationer-goteborg.json`)
}

main().catch(console.error)
