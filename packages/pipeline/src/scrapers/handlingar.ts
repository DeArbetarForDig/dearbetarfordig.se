/**
 * Scraper: goteborg.se nämndhandlingar — KF protokoll och beslut
 *
 * Laddar formulärsidan med session, submittar, sedan klickar vi varje
 * sammanträde-accordion individuellt (navigerar tillbaka efter varje).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

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

async function submitForm(page: Page, year: string) {
  await page.goto(START_URL, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.evaluate((yr) => {
    const selects = document.querySelectorAll('select')
    for (const sel of selects) {
      if (sel.name === 'snNamnd' || sel.id === 'snNamnd') {
        for (const opt of sel.options) {
          if (opt.text === 'Kommunfullmäktige') { sel.value = opt.value; break }
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (sel.name === 'snAr') {
        sel.value = yr
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }, year)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20_000 }),
    page.evaluate(() => { (document.querySelector('form.c-form') as HTMLFormElement)?.submit() }),
  ])
}

async function main() {
  const year = process.argv[2] || new Date().getFullYear().toString()
  console.log(`📋 Scraping KF-handlingar ${year}...\n`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    // First pass: get list of meeting dates
    await submitForm(page, year)
    const pageText = await page.evaluate(() => document.body.innerText)
    const meetingDates = [...pageText.matchAll(/Sammanträde\s+(\d{4}-\d{2}-\d{2})/g)].map(m => m[1])
    console.log(`   ${meetingDates.length} sammanträden\n`)

    const sammanträden: Sammanträde[] = []

    // Second pass: for each meeting, reload the results page and click that specific one
    for (const datum of meetingDates) {
      process.stdout.write(`   ${datum}...`)
      try {
        await submitForm(page, year)

        // Click the specific meeting
        const clicked = await page.evaluate((d) => {
          const els = document.querySelectorAll('a, button, [role="button"]')
          for (const el of els) {
            if (el.textContent?.includes(`Sammanträde ${d}`)) {
              (el as HTMLElement).click()
              return true
            }
          }
          return false
        }, datum)

        if (!clicked) { console.log(' ✗ not found'); sammanträden.push({ datum, handlingar: [] }); continue }

        await page.waitForTimeout(2000)

        // Grab PDFs from expanded content or new page
        const docs = await page.evaluate(() => {
          const results: Array<{ titel: string; url: string }> = []
          document.querySelectorAll('a[href*=".pdf"]').forEach(a => {
            const href = (a as HTMLAnchorElement).href
            const titel = a.textContent?.trim() || ''
            if (titel && href) results.push({ titel, url: href })
          })
          return results
        })

        sammanträden.push({ datum, handlingar: docs.map(d => ({ ...d, typ: classifyDoc(d.titel) })) })
        console.log(` ✓ ${docs.length} dok`)
      } catch (err) {
        console.log(` ✗ error`)
        sammanträden.push({ datum, handlingar: [] })
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
    console.log(`\n✅ ${outPath} (${sammanträden.length} möten, ${totalDocs} dokument)`)
  } finally {
    await browser.close()
  }
}

main().catch(console.error)
