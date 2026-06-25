/**
 * Scraper: stadsrevisionen.goteborg.se — revisionsrapporter
 *
 * Laddar ner granskningsrapporter från Göteborgs Stads revision.
 * Dessa innehåller konkreta bedömningar: godkänd/underkänd, rekommendationer,
 * konstaterade brister per nämnd/förvaltning.
 *
 * Källa: https://goteborg.se/wps/portal/start/kommun-och-politik/sa-arbetar-kommunen-med/revision/
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/revision')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp/revision')

const BASE_URL = 'https://goteborg.se'
const REVISION_URL = `${BASE_URL}/wps/portal/start/kommun-och-politik/sa-arbetar-kommunen-med/revision`

interface Rapport {
  titel: string
  url: string
  datum: string
  år: string
  typ: 'granskning' | 'årsredogörelse' | 'revisionsberättelse' | 'övrigt'
  nämnd: string[]
  filnamn: string
}

function classifyReport(titel: string): Rapport['typ'] {
  const t = titel.toLowerCase()
  if (t.includes('årsredogörelse')) return 'årsredogörelse'
  if (t.includes('revisionsberättelse')) return 'revisionsberättelse'
  if (t.includes('granskning') || t.includes('rapport')) return 'granskning'
  return 'övrigt'
}

function extractNämnder(titel: string): string[] {
  const nämnder: string[] = []
  const t = titel.toLowerCase()
  const mappings: Record<string, string> = {
    grundskole: 'Grundskolenämnden',
    förskole: 'Förskolenämnden',
    utbildnings: 'Utbildningsnämnden',
    stadsmiljö: 'Stadsmiljönämnden',
    exploatering: 'Exploateringsnämnden',
    stadsbygg: 'Stadsbyggnadsnämnden',
    'idrotts- och förening': 'Idrotts- och föreningsnämnden',
    kultur: 'Kulturnämnden',
    'miljö- och klimat': 'Miljö- och klimatnämnden',
    funktionsstöd: 'Nämnden för funktionsstöd',
    intraservice: 'Nämnden för intraservice',
    'demokrati och medborgar': 'Nämnden för demokrati och medborgarservice',
    'inköps- och upphandling': 'Inköps- och upphandlingsnämnden',
    'arbetsmarknad': 'Nämnden för arbetsmarknad och vuxenutbildning',
    'äldre samt vård': 'Äldre samt vård- och omsorgsnämnden',
    'social': 'Socialnämnderna',
    stadsfastighet: 'Stadsfastighetsnämnden',
    'kretslopp och vatten': 'Kretslopp och vattennämnden',
    arkiv: 'Arkivnämnden',
    kommunstyrel: 'Kommunstyrelsen',
  }
  for (const [key, val] of Object.entries(mappings)) {
    if (t.includes(key)) nämnder.push(val)
  }
  return nämnder
}

function sanitizeFilename(url: string, titel: string): string {
  const urlMatch = url.match(/\/([^/]+\.pdf)/i)
  if (urlMatch) return urlMatch[1]
  return titel.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_').slice(0, 80) + '.pdf'
}

async function main() {
  const year = process.argv[2] || new Date().getFullYear().toString()
  console.log(`📋 Scraping revisionsrapporter ${year}...\n`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  mkdirSync(TMP_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  const rapporter: Rapport[] = []

  try {
    // Navigate to revision page
    await page.goto(REVISION_URL, { waitUntil: 'networkidle', timeout: 30_000 })

    // Look for links to PDF reports and sub-pages
    const links = await page.evaluate(() => {
      const results: Array<{ text: string; href: string }> = []
      document.querySelectorAll('a').forEach((a) => {
        const href = a.href
        const text = a.textContent?.trim() || ''
        if (
          href &&
          (href.includes('.pdf') || text.toLowerCase().includes('rapport') || text.toLowerCase().includes('granskning'))
        ) {
          results.push({ text, href })
        }
      })
      return results
    })

    console.log(`   Found ${links.length} potential links on main page`)

    // Also try sub-pages for different years
    const subPages = await page.evaluate(() => {
      const results: Array<{ text: string; href: string }> = []
      document.querySelectorAll('a').forEach((a) => {
        const text = a.textContent?.trim() || ''
        if (text.match(/\d{4}/) || text.toLowerCase().includes('rapporter') || text.toLowerCase().includes('granskningar')) {
          results.push({ text, href: a.href })
        }
      })
      return results
    })

    console.log(`   Found ${subPages.length} sub-page links`)

    // Navigate each sub-page looking for PDFs
    const visitedUrls = new Set<string>()
    const allPdfLinks: Array<{ text: string; href: string }> = []

    // Add direct PDF links from main page
    for (const link of links) {
      if (link.href.includes('.pdf') && !visitedUrls.has(link.href)) {
        visitedUrls.add(link.href)
        allPdfLinks.push(link)
      }
    }

    // Visit sub-pages
    for (const sub of subPages) {
      if (visitedUrls.has(sub.href) || !sub.href.startsWith('http')) continue
      visitedUrls.add(sub.href)
      try {
        await page.goto(sub.href, { waitUntil: 'networkidle', timeout: 20_000 })
        const pdfs = await page.evaluate(() => {
          const results: Array<{ text: string; href: string }> = []
          document.querySelectorAll('a[href*=".pdf"]').forEach((a) => {
            results.push({ text: a.textContent?.trim() || '', href: (a as HTMLAnchorElement).href })
          })
          return results
        })
        for (const pdf of pdfs) {
          if (!visitedUrls.has(pdf.href)) {
            visitedUrls.add(pdf.href)
            allPdfLinks.push(pdf)
          }
        }
      } catch {
        // Skip unreachable sub-pages
      }
    }

    console.log(`\n   Total PDF links found: ${allPdfLinks.length}`)

    // Download each PDF
    let downloaded = 0
    for (const pdf of allPdfLinks) {
      const filnamn = sanitizeFilename(pdf.href, pdf.text)
      const localPath = join(TMP_DIR, filnamn)

      // Filter by year if specified
      if (!pdf.text.includes(year) && !pdf.href.includes(year)) continue

      const rapport: Rapport = {
        titel: pdf.text,
        url: pdf.href,
        datum: `${year}-01-01`,
        år: year,
        typ: classifyReport(pdf.text),
        nämnd: extractNämnder(pdf.text),
        filnamn,
      }
      rapporter.push(rapport)

      if (!existsSync(localPath)) {
        try {
          execSync(`curl -sL -o "${localPath}" "${pdf.href}"`, { timeout: 60_000 })
          downloaded++
          process.stdout.write(`   ✓ ${filnamn}\n`)
        } catch {
          process.stdout.write(`   ✗ ${filnamn} (download failed)\n`)
        }
      } else {
        process.stdout.write(`   ↺ ${filnamn} (cached)\n`)
      }
    }

    console.log(`\n   Downloaded: ${downloaded} new, ${rapporter.length - downloaded} cached`)
  } finally {
    await browser.close()
  }

  // Save index
  const output = {
    kommun: 'goteborg',
    källa: REVISION_URL,
    hämtad: new Date().toISOString(),
    år: year,
    antalRapporter: rapporter.length,
    rapporter,
  }
  const outPath = join(OUTPUT_DIR, `revisionsrapporter-${year}.json`)
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${outPath} (${rapporter.length} rapporter)`)
}

main().catch(console.error)
