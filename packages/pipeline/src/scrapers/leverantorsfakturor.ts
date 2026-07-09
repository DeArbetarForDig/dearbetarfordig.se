/**
 * Scraper: Leverantörsfakturor (Göteborgs Stads öppna data, catalog.goteborg.se
 * store 6, "psidata") → intressekonflikt-signal.
 *
 * Staden publicerar månadsvis alla leverantörsfakturor som CSV (nämnd,
 * leverantör, organisationsnummer, konto, belopp) — se docs/ANALYS-2026-07.md.
 * Varje månadsfil är 10–15 MB (~100k rader), och med ~10 års historik
 * (2016–idag) blir totalen för stor för att lagras i repo:t. Den här
 * scrapern laddar varje månad transient (till .tmp/), filtrerar direkt mot
 * kända bolag-organisationsnummer (politikers bolagsuppdrag, från
 * allabolag.ts → data/politiker/bolagsengagemang-goteborg.json), och sparar
 * bara de matchande raderna — dvs. bara fakturor till bolag där en politiker
 * sitter i styrelsen/ledningen. Det är precis den signalen som behövs för
 * jäv-granskning; resten av datan är inte värd att versionshantera i git.
 *
 * Användning: npx tsx packages/pipeline/src/scrapers/leverantorsfakturor.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp/leverantorsfakturor')
const OUTPUT_PATH = join(DATA_DIR, 'politiker/leverantorsfakturor-traff.json')

const SEARCH_URL =
  'https://catalog.goteborg.se/store/search?type=solr&query=title:Leverant%C3%B6rsfaktura*&limit=100'

const MONTH_NAMES: Record<string, number> = {
  januari: 1,
  februari: 2,
  mars: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  augusti: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
}

interface SearchHit {
  id: string
  title: string
}

interface MonthCandidate {
  id: string
  title: string
  year: number
  month: number
  format?: string
  modified?: string
}

function parseMonthYear(title: string): { year: number; month: number } | null {
  const ymMatch = title.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/)
  if (ymMatch) return { year: Number(ymMatch[1]), month: Number(ymMatch[2]) }
  const lower = title.toLowerCase()
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (lower.includes(name)) {
      const yearMatch = title.match(/(20\d{2})/)
      if (yearMatch) return { year: Number(yearMatch[1]), month: num }
    }
  }
  return null
}

async function searchAllHits(): Promise<SearchHit[]> {
  const hits: SearchHit[] = []
  let offset = 0
  while (true) {
    const res = await fetch(`${SEARCH_URL}&offset=${offset}`)
    const data = (await res.json()) as {
      results: number
      resource: { children: Array<{ metadata: Record<string, any> }> }
    }
    for (const child of data.resource.children) {
      const id = Object.keys(child.metadata)[0]
      const entry = child.metadata[id]
      const title = entry['http://purl.org/dc/terms/title']?.[0]?.value
      if (id && title) hits.push({ id, title })
    }
    offset += data.resource.children.length
    if (offset >= data.results || data.resource.children.length === 0) break
  }
  return hits
}

async function fetchResourceMeta(
  resourceUrl: string,
): Promise<{ format?: string; modified?: string }> {
  const metadataUrl = resourceUrl.replace('/resource/', '/metadata/')
  const res = await fetch(metadataUrl, { headers: { Accept: 'application/json' } })
  const data = (await res.json()) as Record<string, any>
  const entry = data[resourceUrl]
  return {
    format: entry?.['http://purl.org/dc/terms/format']?.[0]?.value,
    modified: entry?.['http://purl.org/dc/terms/modified']?.[0]?.value,
  }
}

function resourceNumericId(url: string): number {
  return Number(url.split('/').pop()) || 0
}

// Some months were re-uploaded multiple times (e.g. "Leverantörsfaktura Juli
// 2021" exists 3×) and some have a parallel XML version alongside the CSV —
// only text/csv is usable here. Groups every CSV candidate per month, best
// guess first (most recently modified, numerically highest id as
// tiebreak/fallback when `modified` is missing) — but this is only a
// preference order, not a correctness guarantee: one January 2020 upload
// has a `dcterms:modified` timestamp yet returns HTTP 204 (empty) when
// fetched, so the caller must still fall back to the next candidate if the
// preferred one turns out empty (see downloadMonthText).
async function resolveMonthlyResourceGroups(): Promise<Map<string, MonthCandidate[]>> {
  const hits = await searchAllHits()
  const byMonth = new Map<string, MonthCandidate[]>()
  for (const hit of hits) {
    const my = parseMonthYear(hit.title)
    if (!my) continue
    const meta = await fetchResourceMeta(hit.id)
    if (meta.format && meta.format !== 'text/csv') continue
    const key = `${my.year}-${String(my.month).padStart(2, '0')}`
    const candidate: MonthCandidate = { id: hit.id, title: hit.title, ...my, ...meta }
    const list = byMonth.get(key) || []
    list.push(candidate)
    byMonth.set(key, list)
  }
  for (const list of byMonth.values()) {
    list.sort((a, b) => {
      if (a.modified && b.modified) return b.modified.localeCompare(a.modified)
      if (a.modified) return -1
      if (b.modified) return 1
      return resourceNumericId(b.id) - resourceNumericId(a.id)
    })
  }
  return byMonth
}

async function resolveMonthlyResources(): Promise<MonthCandidate[]> {
  const groups = await resolveMonthlyResourceGroups()
  return [...groups.values()]
    .map((list) => list[0])
    .sort((a, b) => a.year - b.year || a.month - b.month)
}

// Tries each candidate for a month in preference order and returns the
// first one with real content — see resolveMonthlyResourceGroups for why a
// "best" candidate can still be an empty upload. Empty isn't the only
// failure mode: one broken upload (2020-01, id 3006) responds 200 with the
// RESOURCE'S OWN RDF METADATA DESCRIPTION instead of file bytes (no actual
// file stored server-side) — non-empty, but starts with "<?xml"/"<rdf:",
// not the expected CSV header, so a naive "non-empty" check would silently
// cache garbage.
// Checks only the ASCII-safe part of the header ("rvaltning"/"Leverant") —
// the accented characters (ö) are exactly what breaks under the wrong
// charset (see decodeCsv below), so matching on them would defeat the point.
function looksLikeCsv(text: string): boolean {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0]
  return firstLine.includes('rvaltning') && firstLine.includes('Leverant')
}

// Most months are UTF-8, but at least one (2020-05) is Windows-1252/
// Latin-1 — decoded as UTF-8 its ö/ä/å become U+FFFD replacement
// characters, which still passes a naive "non-empty" check but corrupts
// every accented name in the file. Falls back to latin1 (a builtin Node
// Buffer encoding, no extra dependency) when the UTF-8 decode contains
// replacement characters in its header line.
function decodeCsv(buffer: ArrayBuffer): string {
  const utf8 = Buffer.from(buffer).toString('utf-8')
  const firstLine = utf8.split(/\r?\n/, 1)[0]
  if (!firstLine.includes('�')) return utf8
  return Buffer.from(buffer).toString('latin1')
}

async function downloadMonthText(candidates: MonthCandidate[], cachePath: string): Promise<string> {
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf-8')
  for (const candidate of candidates) {
    const res = await fetch(candidate.id)
    const text = decodeCsv(await res.arrayBuffer())
    if (looksLikeCsv(text)) {
      mkdirSync(join(cachePath, '..'), { recursive: true })
      writeFileSync(cachePath, text)
      return text
    }
  }
  return ''
}

// Strips legal-suffix variants so "Göteborg Energi AB" (official roster) and
// "Göteborg Energi Aktiebolag" (allabolag.se) compare equal — same approach
// as normalizeBolagNamn in packages/api/src/db/seed.ts (duplicated locally;
// pipeline doesn't depend on api).
function normalizeBolagNamn(namn: string): string {
  return namn
    .toLowerCase()
    .replace(/\(publ\)/g, '')
    .replace(/\b(aktiebolag|ekonomisk förening|ideell förening)\b/g, '')
    .replace(/\bab\b\.?/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// A politiker's allabolag.se-scraped bolagsuppdrag (bolagsengagemang-*.json)
// mixes two very different things: undisclosed private business interests
// (the actual jäv signal) and municipally-owned companies (Higab, Liseberg,
// Renova, Göteborg Energi…) where board membership is a public, KF-appointed
// part of the politiker's official role — not a conflict. A first version of
// this scraper without this filter found ~25 000 "matches" per month, almost
// entirely Göteborgs Stads Leasing AB (the city's own vehicle-leasing
// company) showing up in ordinary invoices from every department. Two
// filters remove the municipal noise: (a) the bolag is already listed in
// the politiker's OFFICIAL uppdrag (data/politiker/goteborg.json — nämnder
// and city-company board seats scraped from politiker.goteborg.se, i.e.
// publicly disclosed); (b) an explicit "Göteborgs/Göteborg Stad(s)…" name
// prefix, for city companies missed by (a) (roster/role mismatches between
// the two source scrapes). Neither filter is a perfect classifier —
// borderline cases (GöteborgsOperan, a regional school company,
// Folkets Hus) fall through on purpose rather than being guessed away;
// they're few enough now to review by hand.
// Known 100%-city-owned holding companies whose name doesn't start with
// "Göteborgs Stad" (so the prefix heuristic below misses them) and that
// didn't show up in the official-uppdrag cross-reference for the specific
// politiker in this data (roster/scrape mismatch between the two source
// files, not an ownership question — Framtiden is the well-documented
// parent of the municipal housing companies, Familjebostäder/Poseidon/
// Bostadsbolaget/Gårdstensbostäder).
const KNOWN_MUNICIPAL_HOLDING = new Set([normalizeBolagNamn('Förvaltningsaktiebolaget Framtiden')])

function isOfficiallyDisclosed(bolagNamn: string, officialOrgNames: Set<string>): boolean {
  const normalized = normalizeBolagNamn(bolagNamn)
  if (officialOrgNames.has(normalized) || KNOWN_MUNICIPAL_HOLDING.has(normalized)) return true
  return /^(göteborgs?\s+stads?|göteborg\s*&\s*co)/i.test(bolagNamn)
}

function loadWatchedOrgnr(): Map<string, { politikerId: string; namn: string; bolag: string }[]> {
  const officialData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const officialOrgNames = new Set<string>()
  for (const p of officialData.politiker) {
    for (const u of p.uppdrag || []) {
      if (u.organisation) officialOrgNames.add(normalizeBolagNamn(u.organisation))
    }
  }

  const path = join(DATA_DIR, 'politiker/bolagsengagemang-goteborg.json')
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  const map = new Map<string, { politikerId: string; namn: string; bolag: string }[]>()
  let excluded = 0
  for (const p of data.politiker) {
    for (const b of p.bolagsuppdrag || []) {
      const m = (b.url || '').match(/\/-\/(\d{10})$/)
      if (!m) continue
      if (isOfficiallyDisclosed(b.bolag || '', officialOrgNames)) {
        excluded++
        continue
      }
      const orgnr = m[1]
      const list = map.get(orgnr) || []
      list.push({ politikerId: p.id, namn: p.namn, bolag: b.bolag })
      map.set(orgnr, list)
    }
  }
  console.log(`   ◦ ${excluded} bolagsuppdrag uteslutna (kommunala bolag, officiellt uppdrag)`)
  return map
}

// pdftotext-adjacent parsers in this repo use a fixed set of tools; here the
// source is already flat CSV so a manual split is enough — semicolon-
// delimited, no embedded semicolons/quoting observed in a manual sample.
function parseCsvLine(line: string): string[] {
  return line.split(';')
}

async function processMonth(
  candidates: MonthCandidate[],
  watched: Map<string, { politikerId: string; namn: string; bolag: string }[]>,
): Promise<
  Array<{
    politikerId: string
    politikerNamn: string
    bolag: string
    orgnr: string
    period: string
    förvaltning: string
    leverantör: string
    kontotext: string
    beloppExklMoms: number
  }>
> {
  const first = candidates[0]
  const period = `${first.year}-${String(first.month).padStart(2, '0')}`
  const cachePath = join(TMP_DIR, `${period}.csv`)
  const text = await downloadMonthText(candidates, cachePath)
  if (!text) {
    console.warn(
      `   ⚠️  ${period}: alla ${candidates.length} kandidat(er) gav tomt svar — hoppar över`,
    )
    return []
  }

  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = parseCsvLine(lines[0])
  const idxOrgnr = header.findIndex((h) => h.trim() === 'Organisationsnummer')
  const idxFörvaltning = header.findIndex((h) => h.trim() === 'Förvaltning')
  const idxLeverantör = header.findIndex((h) => h.trim() === 'Leverantör')
  const idxKontotext = header.findIndex((h) => h.trim() === 'Kontotext')
  const idxBelopp = header.findIndex((h) => h.trim().startsWith('Belopp'))
  if (idxOrgnr < 0) return []

  const matches: Array<{
    politikerId: string
    politikerNamn: string
    bolag: string
    orgnr: string
    period: string
    förvaltning: string
    leverantör: string
    kontotext: string
    beloppExklMoms: number
  }> = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    const orgnr = cols[idxOrgnr]?.trim().replace(/[^\d]/g, '')
    if (!orgnr || !watched.has(orgnr)) continue
    const belopp = Number((cols[idxBelopp] || '0').trim().replace(/\s/g, '').replace(',', '.'))
    for (const w of watched.get(orgnr)!) {
      matches.push({
        politikerId: w.politikerId,
        politikerNamn: w.namn,
        bolag: w.bolag,
        orgnr,
        period,
        förvaltning: cols[idxFörvaltning]?.trim() || '',
        leverantör: cols[idxLeverantör]?.trim() || '',
        kontotext: cols[idxKontotext]?.trim() || '',
        beloppExklMoms: belopp,
      })
    }
  }
  return matches
}

async function main() {
  console.log('🧾 Leverantörsfakturor (psidata) → intressekonflikt-signal\n')
  const watched = loadWatchedOrgnr()
  console.log(`   ${watched.size} bevakade organisationsnummer (politikers bolagsuppdrag)`)

  const groups = await resolveMonthlyResourceGroups()
  const monthKeys = [...groups.keys()].sort()
  console.log(`   ${monthKeys.length} månadsfiler hittade (${monthKeys[0]}…)`)

  const allMatches: Array<Awaited<ReturnType<typeof processMonth>>[number]> = []
  let processed = 0
  for (const key of monthKeys) {
    const candidates = groups.get(key)!
    const matches = await processMonth(candidates, watched)
    allMatches.push(...matches)
    processed++
    if (matches.length > 0) console.log(`   ✓ ${key}: ${matches.length} träffar`)
    if (processed % 20 === 0) console.log(`   … ${processed}/${monthKeys.length} månader`)
  }

  mkdirSync(join(DATA_DIR, 'politiker'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify({ träffar: allMatches }, null, 2))
  console.log(`\n✅ ${OUTPUT_PATH} (${allMatches.length} träffar över ${monthKeys.length} månader)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export {
  parseMonthYear,
  resolveMonthlyResources,
  resolveMonthlyResourceGroups,
  downloadMonthText,
  loadWatchedOrgnr,
  processMonth,
  normalizeBolagNamn,
}
export type { MonthCandidate }
