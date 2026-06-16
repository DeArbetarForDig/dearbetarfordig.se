/**
 * Scraper: allabolag.se — bolagsengagemang för politiker
 *
 * Söker varje KF-politiker på allabolag.se och extraherar styrelseuppdrag.
 * Kräver Playwright (client-side rendering).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const OUTPUT_DIR = join(DATA_DIR, 'politiker')
const DELAY_MS = 2000 // Be nice to allabolag

interface Bolagsuppdrag {
  bolag: string
  roll: string
  orgNr?: string
  url?: string
}

interface PolitikerBolag {
  id: string
  namn: string
  parti: string
  allabolagUrl: string | null
  bolagsuppdrag: Bolagsuppdrag[]
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const polData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const limit = parseInt(process.argv[2] || '5') // Default: first 5 for testing

  console.log(`🏢 Scraping allabolag.se — bolagsengagemang\n`)
  console.log(`   ${polData.politiker.length} politiker, söker ${limit} st\n`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const results: PolitikerBolag[] = []

  for (let i = 0; i < Math.min(limit, polData.politiker.length); i++) {
    const p = polData.politiker[i]
    const name = `${p.förnamn} ${p.efternamn}`
    process.stdout.write(`   [${i + 1}/${limit}] ${name} (${p.parti})...`)

    try {
      await page.goto(`https://www.allabolag.se/befattningshavare?q=${encodeURIComponent(name)}`, { waitUntil: 'networkidle', timeout: 20000 })

      // Get person links from search results
      const personLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/befattning/"]')).map(a => ({
          name: a.textContent?.trim() || '',
          href: (a as HTMLAnchorElement).href,
        }))
      )

      // Find best match (name contains both first and last name)
      const match = personLinks.find(l =>
        l.name.toLowerCase().includes(p.förnamn.toLowerCase()) &&
        l.name.toLowerCase().includes(p.efternamn.toLowerCase())
      )

      if (!match) {
        console.log(' ✗ ej hittad')
        results.push({ id: p.id, namn: name, parti: p.parti, allabolagUrl: null, bolagsuppdrag: [] })
        await sleep(DELAY_MS)
        continue
      }

      // Go to person page and extract roles
      await page.goto(match.href, { waitUntil: 'networkidle', timeout: 20000 })

      const bolagsuppdrag = await page.evaluate(() => {
        const roles: Array<{ bolag: string; roll: string; orgNr?: string; url?: string }> = []
        // Look for role entries in tables or cards
        document.querySelectorAll('table tbody tr').forEach(row => {
          const cells = row.querySelectorAll('td')
          if (cells.length >= 2) {
            const roll = cells[0]?.textContent?.trim() || ''
            const bolagEl = cells[1]?.querySelector('a') || cells[1]
            const bolag = bolagEl?.textContent?.trim() || ''
            const url = (bolagEl as HTMLAnchorElement)?.href || undefined
            if (roll && bolag) roles.push({ bolag, roll, url })
          }
        })
        // Fallback: look for role-like elements
        if (roles.length === 0) {
          document.querySelectorAll('[class*="Role"], [class*="role"]').forEach(el => {
            const text = el.textContent?.trim() || ''
            if (text.includes('Ledamot') || text.includes('Ordförande') || text.includes('VD') || text.includes('Suppleant')) {
              const link = el.querySelector('a[href*="/foretag/"]')
              roles.push({ roll: text.split('\n')[0], bolag: link?.textContent?.trim() || text, url: (link as HTMLAnchorElement)?.href })
            }
          })
        }
        return roles
      })

      results.push({ id: p.id, namn: name, parti: p.parti, allabolagUrl: match.href, bolagsuppdrag })
      console.log(` ✓ ${bolagsuppdrag.length} bolag`)
    } catch (err) {
      console.log(` ✗ error`)
      results.push({ id: p.id, namn: name, parti: p.parti, allabolagUrl: null, bolagsuppdrag: [] })
    }

    await sleep(DELAY_MS)
  }

  await browser.close()

  // Save
  const outPath = join(OUTPUT_DIR, 'bolagsengagemang-goteborg.json')
  writeFileSync(outPath, JSON.stringify({ hämtad: new Date().toISOString(), antal: results.length, politiker: results }, null, 2))
  const medBolag = results.filter(r => r.bolagsuppdrag.length > 0).length
  console.log(`\n✅ ${outPath} (${medBolag}/${results.length} har bolagsuppdrag)`)
}

main().catch(console.error)
