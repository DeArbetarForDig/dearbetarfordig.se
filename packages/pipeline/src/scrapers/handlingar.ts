/**
 * Scraper: goteborg.se nämndhandlingar — KF protokoll och beslut
 *
 * WebSphere Portal kräver session → ladda sidan, interagera med formuläret via Playwright.
 * Custom dropdowns: klicka på .c-input-select-wrapper istället för native select.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const START_URL = 'https://goteborg.se/wps/portal/start/kommun-och-politik/handlingar-och-protokoll/namndhandlingar/valj-namnd-och-ar'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/beslut')

interface Handling {
  titel: string
  url: string
  typ: 'protokoll' | 'kallelse' | 'bilaga' | 'övrigt'
}

interface Sammanträde {
  datum: string
  handlingar: Handling[]
}

function classifyDoc(titel: string): Handling['typ'] {
  const t = titel.toLowerCase()
  if (t.includes('protokoll')) return 'protokoll'
  if (t.includes('kallelse') || t.includes('dagordning')) return 'kallelse'
  if (t.includes('bilaga') || t.includes('tjänsteutlåtande') || t.includes('yttrande')) return 'bilaga'
  return 'övrigt'
}

async function main() {
  const year = process.argv[2] || new Date().getFullYear().toString()
  console.log(`📋 Scraping KF-handlingar ${year} från goteborg.se...\n`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    // Load the page with session
    await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 45_000 })
    console.log('   ✓ Sidan laddad')

    // The form has custom JS selects. Use JavaScript to set values and submit.
    await page.evaluate((yr) => {
      // Find and set the hidden native selects
      const selects = document.querySelectorAll('select')
      for (const sel of selects) {
        if (sel.name === 'snNamnd' || sel.id === 'snNamnd') {
          for (const opt of sel.options) {
            if (opt.text.includes('Kommunfullmäktige') && !opt.text.includes('presidium')) {
              sel.value = opt.value
              sel.dispatchEvent(new Event('change', { bubbles: true }))
              break
            }
          }
        }
        if (sel.name === 'snAr') {
          sel.value = yr
          sel.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    }, year)

    // Submit the form
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20_000 }),
      page.evaluate(() => {
        const form = document.querySelector('form.c-form') as HTMLFormElement
        if (form) form.submit()
      }),
    ])
    console.log('   ✓ Formulär skickat')

    // Now get the result — look for meeting items
    const pageText = await page.evaluate(() => document.body.innerText)
    const meetingDates = [...pageText.matchAll(/Sammanträde\s+(\d{4}-\d{2}-\d{2})/g)].map(m => m[1])
    console.log(`   Hittade ${meetingDates.length} sammanträden i text`)

    // Get all clickable meeting links
    const meetingElements = await page.$$eval('a, button, [role="button"]', els =>
      els
        .filter(el => /Sammanträde\s+\d{4}/.test(el.textContent || ''))
        .map(el => ({ text: el.textContent?.trim() || '', tag: el.tagName }))
    )
    console.log(`   Klickbara element: ${meetingElements.length}`)

    // Try clicking each meeting to get documents
    const sammanträden: Sammanträde[] = []

    for (const datum of meetingDates) {
      try {
        // Click the meeting link/button
        const clicked = await page.evaluate((d) => {
          const els = document.querySelectorAll('a, button, [role="button"], [class*="accordion"]')
          for (const el of els) {
            if (el.textContent?.includes(`Sammanträde ${d}`)) {
              (el as HTMLElement).click()
              return true
            }
          }
          return false
        }, datum)

        if (clicked) {
          await page.waitForTimeout(1000) // Wait for accordion/page

          // Check if we navigated to a new page or expanded an accordion
          const docs = await page.evaluate((d) => {
            const results: Array<{ titel: string; url: string }> = []
            // Look for PDF links that appeared
            document.querySelectorAll('a[href*=".pdf"], a[href*="dokument"]').forEach(a => {
              const href = (a as HTMLAnchorElement).href
              const titel = a.textContent?.trim() || ''
              if (titel && href) results.push({ titel, url: href })
            })
            return results
          }, datum)

          sammanträden.push({
            datum,
            handlingar: docs.map(d => ({ ...d, typ: classifyDoc(d.titel) })),
          })
          console.log(`   ${datum}: ${docs.length} dokument`)
        } else {
          sammanträden.push({ datum, handlingar: [] })
          console.log(`   ${datum}: kunde inte klicka`)
        }
      } catch {
        sammanträden.push({ datum, handlingar: [] })
        console.log(`   ${datum}: fel`)
      }
    }

    // If no meetings found via clicking, save the dates at least
    if (sammanträden.length === 0 && meetingDates.length > 0) {
      for (const d of meetingDates) {
        sammanträden.push({ datum: d, handlingar: [] })
      }
    }

    // Save
    mkdirSync(OUTPUT_DIR, { recursive: true })
    const output = {
      kommun: 'goteborg',
      organisation: 'Kommunfullmäktige',
      år: year,
      källa: START_URL,
      hämtad: new Date().toISOString(),
      antalSammanträden: sammanträden.length,
      sammanträden,
    }

    const outPath = join(OUTPUT_DIR, `kf-handlingar-${year}.json`)
    writeFileSync(outPath, JSON.stringify(output, null, 2))
    const totalDocs = sammanträden.reduce((n, s) => n + s.handlingar.length, 0)
    console.log(`\n✅ Sparad: ${outPath} (${sammanträden.length} sammanträden, ${totalDocs} dokument)`)
  } finally {
    await browser.close()
  }
}

main().catch(console.error)
