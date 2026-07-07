/**
 * Scraper: politiker.goteborg.se — ALLA förtroendevalda, alla organ.
 *
 * politiker.ts täcker bara Kommunfullmäktige (125 personer); namnd-ledamoter.ts
 * bara en hårdkodad lista på 15 nämnder. Sajten har i själva verket en fullt
 * genomsökbar hierarki:
 *
 *   /  →  6 organisationstyper (Kommunfullmäktige, Stadsrevisionen,
 *         Kommunstyrelsen, Nämnder, Stiftelser & fonder, Bolag)
 *   →  ~156 organisationer totalt (nämnd-listan hade 15 hårdkodade,
 *      verkligheten är 24 — saknade bl.a. Arkivnämnden för VGR och Göteborgs stad)
 *   →  varje organisation har en medlemstabell (#engagementTable)
 *   →  varje person har en egen sida med KOMPLETT uppdragslista
 *
 * Denna scraper går igenom hela hierarkin och hämtar varje unik persons
 * fullständiga profil (samma detaljnivå som politiker.ts, men för alla).
 *
 * Användning:
 *   npx tsx packages/pipeline/src/scrapers/alla-fortroendevalda.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://politiker.goteborg.se'
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/politiker')
const DELAY_MS = 300

interface RawMember {
  id: string
  förnamn: string
  efternamn: string
  parti: string
  roll: string
}

interface PersonDetail {
  id: string
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
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

async function discoverOrganisationstyper(): Promise<{ id: string; namn: string }[]> {
  const html = await fetchPage('/')
  const $ = cheerio.load(html)
  const typer: { id: string; namn: string }[] = []
  $('a[href^="/organisationstyp/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const id = href.split('/organisationstyp/')[1]?.split('?')[0]
    const namn = $(el).text().trim()
    if (id && namn) typer.push({ id, namn })
  })
  return typer
}

async function discoverOrganisationer(typId: string): Promise<{ id: string; namn: string }[]> {
  const html = await fetchPage(`/organisationstyp/${typId}`)
  const $ = cheerio.load(html)
  const orgs: { id: string; namn: string }[] = []
  $('a[href^="/organisation/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const id = href.split('/organisation/')[1]?.split('?')[0]
    const namn = $(el).text().trim()
    if (id && namn) orgs.push({ id, namn })
  })
  return orgs
}

async function scrapeOrgMembers(orgId: string): Promise<RawMember[]> {
  const html = await fetchPage(`/organisation/${orgId}`)
  const $ = cheerio.load(html)
  const members: RawMember[] = []
  $('#engagementTable\\:tbody_element tr, #engagementTable tbody tr').each((_, row) => {
    const cells = $(row).find('td')
    const link = cells.eq(0).find('a')
    const href = link.attr('href') || ''
    const id = href.split('/person/')[1]?.split('?')[0] || ''
    const efternamn = cells.eq(0).text().trim()
    const förnamn = cells.eq(1).text().trim()
    const parti = cells.eq(2).text().trim()
    const roll = cells.eq(3).text().trim()
    if (id && (förnamn || efternamn)) members.push({ id, förnamn, efternamn, parti, roll })
  })
  return members
}

async function scrapePersonDetail(personId: string): Promise<PersonDetail> {
  const html = await fetchPage(`/person/${personId}`)
  const $ = cheerio.load(html)

  const emailLink = $('a[href^="mailto:"]').first()
  const email = emailLink.length ? emailLink.text().trim() : null

  // Personsidan har TVÅ tabeller som båda delar id="engagementTable" (ogiltig
  // HTML, men så är sajten byggd): "Uppdrag" (nuvarande, rätt kolumnordning)
  // och "Uppdragshistorik" (tidigare uppdrag, annan kolumnordning — id-selektorn
  // matchar annars båda och blandar ihop datum/parti-kolumner). Historiken sitter
  // i <div id="person-history">, exkludera allt där.
  const uppdrag: PersonDetail['uppdrag'] = []
  $('#engagementTable\\:tbody_element tr, #engagementTable tbody tr')
    .filter((_, row) => $(row).parents('#person-history').length === 0)
    .each((_, row) => {
      const cells = $(row).find('td')
      const orgLink = cells.eq(0).find('a')
      const orgHref = orgLink.attr('href') || ''
      const organisationId = orgHref.split('/organisation/')[1] || ''
      const organisation = cells.eq(0).text().trim()
      const roll = cells.eq(1).text().trim()
      const från = cells.eq(2).text().trim()
      const tillText = cells.eq(3).text().trim()
      const till = tillText || null
      if (organisation) uppdrag.push({ organisation, organisationId, roll, från, till })
    })

  return { id: personId, email, uppdrag }
}

async function main() {
  console.log('🔍 Scraping HELA politiker.goteborg.se — alla organisationstyper...\n')

  const typer = await discoverOrganisationstyper()
  console.log(`   ${typer.length} organisationstyper: ${typer.map((t) => t.namn).join(', ')}\n`)

  const allaOrgs: { id: string; namn: string; typ: string }[] = []
  for (const typ of typer) {
    await sleep(DELAY_MS)
    const orgs = await discoverOrganisationer(typ.id)
    console.log(`   [${typ.namn}] ${orgs.length} organisationer`)
    for (const org of orgs) allaOrgs.push({ ...org, typ: typ.namn })
  }
  console.log(`\n   ${allaOrgs.length} organisationer totalt\n`)

  // Steg 2: hämta medlemstabellen för varje organisation, dedupa personer
  const personRaw = new Map<string, RawMember>()
  let i = 0
  for (const org of allaOrgs) {
    i++
    await sleep(DELAY_MS)
    try {
      const members = await scrapeOrgMembers(org.id)
      for (const m of members) if (!personRaw.has(m.id)) personRaw.set(m.id, m)
      process.stdout.write(
        `\r   [${i}/${allaOrgs.length}] organisationer skannade, ${personRaw.size} unika personer hittills...`,
      )
    } catch (err) {
      console.log(`\n   ✗ ${org.namn}: ${err}`)
    }
  }
  console.log(`\n\n   ${personRaw.size} unika personer att hämta fullständig profil för\n`)

  // Steg 3: hämta varje persons EGNA sida — komplett uppdragslista + email
  const detaljer: Array<RawMember & PersonDetail> = []
  i = 0
  for (const [id, raw] of personRaw) {
    i++
    process.stdout.write(`   [${i}/${personRaw.size}] ${raw.förnamn} ${raw.efternamn}...`)
    try {
      const detail = await scrapePersonDetail(id)
      detaljer.push({ ...raw, ...detail })
      console.log(` ✓ (${detail.uppdrag.length} uppdrag)`)
    } catch (err) {
      console.log(` ✗ ${err}`)
    }
    await sleep(DELAY_MS)
  }

  // Steg 4: mergea med befintlig fil (bevara manuellt tillagda mandatperioder/närstående)
  const outPath = join(OUTPUT_DIR, 'goteborg.json')
  const existingById = new Map<string, any>()
  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(readFileSync(outPath, 'utf-8'))
      for (const p of existing.politiker || []) existingById.set(p.id, p)
    } catch {}
  }

  const finalResults: any[] = detaljer.map((p) => {
    const prev = existingById.get(p.id)
    return {
      id: p.id,
      förnamn: p.förnamn,
      efternamn: p.efternamn,
      parti: p.parti,
      email: p.email,
      uppdrag: p.uppdrag,
      mandatperioder: prev?.mandatperioder || [],
      närstående: prev?.närstående ?? null,
    }
  })

  // Personer som försvunnit från sajten (avgångna under mandatperioden)
  // behålls med historisk-flagga i stället för att tyst raderas — deras
  // röster i voteringsbilagorna refererar deras uuid:n
  // (historisk-roster.ts, docs/ANALYS-2026-07.md punkt 19).
  const scrapade = new Set(detaljer.map((p) => p.id))
  let behållna = 0
  for (const [id, prev] of existingById) {
    if (scrapade.has(id)) continue
    finalResults.push({ ...prev, historisk: true })
    behållna++
  }
  if (behållna > 0) console.log(`\n   ${behållna} avgångna personer behållna (historisk: true)`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const output = {
    kommun: 'goteborg',
    källa: `${BASE_URL}/`,
    hämtad: new Date().toISOString(),
    mandatperiod: { från: '2022-10-15', till: '2026-10-14' },
    antal: finalResults.length,
    politiker: finalResults,
  }
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(
    `\n✅ Sparad: ${outPath} (${finalResults.length} personer, ${allaOrgs.length} organisationer)`,
  )
}

main().catch(console.error)
