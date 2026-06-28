/**
 * Batch Budget Parser — скачивает и парсит бюджеты 2024-2026 через pixelshot + VLM
 *
 * Рендерит PDF-страницы в изображения (pixelshot), затем отправляет на VLM
 * для структурированного извлечения таблиц kommunbidrag per nämnd.
 *
 * Бюджеты 2022-2023 недоступны на goteborg.se (хранятся только 2023-2027).
 * Для них нужно вручную получить PDF:
 *   - Begäran om allmän handling: registrator@goteborg.se
 *   - Или найти в Wayback Machine / партийных сайтов
 *
 * Использование:
 *   npx tsx packages/pipeline/src/parsers/parse-budget-batch.ts
 *   npx tsx packages/pipeline/src/parsers/parse-budget-batch.ts --year 2024
 *   npx tsx packages/pipeline/src/parsers/parse-budget-batch.ts --local .tmp/budget-2023.pdf --year 2023
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../../..')
const TMP_DIR = join(ROOT, '.tmp')
const TILES_DIR = join(TMP_DIR, 'budget-tiles')
const OUTPUT_DIR = join(ROOT, 'data/graf')

// Known budget PDF URLs (S+V+MP styrande)
const BUDGET_URLS: Record<string, string> = {
  '2024':
    'https://www4.goteborg.se/prod/Intraservice/Namndhandlingar/SamrumPortal.nsf/796C47E520BB07DCC1258A5A004F8BC4/$File/Budget2024_S_V_MP.pdf?OpenElement',
  '2025':
    'https://www4.goteborg.se/prod/Intraservice/Namndhandlingar/SamrumPortal.nsf/B575B887C52395D2C1258BC1003C3E8F/$File/Budget2025_S_V_MP_rev.pdf?OpenElement',
  '2026':
    'https://www4.goteborg.se/prod/Intraservice/Namndhandlingar/SamrumPortal.nsf/8C302DA8A5C1DA2AC1258D2D0041091F/$File/Budget2026_S_V_MP_Reviderad.pdf?OpenElement',
}

interface NämndBudget {
  namn: string
  kommunbidragMnkr: number
}

interface GraphNode {
  id: string
  typ: string
  label: string
  data: Record<string, unknown>
}

interface GraphEdge {
  from: string
  to: string
  typ: string
  data?: Record<string, unknown>
}

/**
 * Ladda ner PDF om den inte redan finns
 */
function downloadPdf(url: string, destPath: string): void {
  if (existsSync(destPath)) {
    console.log(`   ✓ PDF finns redan: ${destPath}`)
    return
  }
  console.log('   ⬇️  Laddar ner...')
  execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' '${url}' -o '${destPath}'`, {
    timeout: 60_000,
  })
}

/**
 * Rendera PDF till tiles med pixelshot
 */
function renderTiles(pdfPath: string, outputDir: string): string[] {
  mkdirSync(outputDir, { recursive: true })

  // pixelshot creates a subdirectory like: outputDir/<basename>.tiles/tile_XXXX.jpg
  const pdfName = pdfPath.split('/').pop()!.replace('.pdf', '.png.tiles')
  const tilesSubdir = join(outputDir, pdfName)

  // Kolla om tiles redan finns
  if (existsSync(tilesSubdir)) {
    const existing = readdirSync(tilesSubdir).filter((f) => f.endsWith('.jpg'))
    if (existing.length > 0) {
      console.log(`   ✓ ${existing.length} tiles finns redan`)
      return existing.sort().map((f) => join(tilesSubdir, f))
    }
  }

  console.log('   📷 Renderar PDF → tiles (pixelshot)...')
  execSync(`pixelshot '${pdfPath}' --output '${outputDir}' --dpi 200 --quality 90`, {
    timeout: 120_000,
    stdio: 'pipe',
  })

  const tiles = readdirSync(tilesSubdir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(tilesSubdir, f))
  console.log(`   ✓ ${tiles.length} tiles renderade`)
  return tiles
}

/**
 * Hitta sidor som innehåller budgettabellen (kommunbidrag per nämnd).
 * Vi letar efter sidor med "kommunbidrag" i texten via pdftotext som hint.
 */
function findBudgetPages(pdfPath: string): number[] {
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })

  const pages: number[] = []
  let pageNum = 1
  for (const page of text.split('\f')) {
    const lower = page.toLowerCase()
    if (
      lower.includes('kommunbidrag') &&
      (lower.includes('nämnden') || lower.includes('förskole') || lower.includes('grundskole'))
    ) {
      pages.push(pageNum)
    }
    pageNum++
  }
  return pages
}

/**
 * Skapa VLM-prompt för att extrahera budgettabell från en bild
 */
function buildExtractionPrompt(): string {
  return `Du ser en sida ur Göteborgs Stads kommunbudget. 
Extrahera tabellen med kommunbidrag (eller nettokostnad/ram) per nämnd/styrelse.

Returnera ENBART en JSON-array med objekt:
[
  {"namn": "Förskolenämnden", "belopp_tkr": 5361320},
  {"namn": "Grundskolenämnden", "belopp_tkr": 7847000},
  ...
]

Regler:
- "belopp_tkr" = beloppet i tusentals kronor (tkr) som det står i tabellen
- Inkludera ALLA rader med nämnder/styrelser/förvaltningar
- Exkludera summa-rader, totaler, och kolumnrubriker
- Om tabellen visar flera år/kolumner, ta den kolumnen som motsvarar budgetåret (inte utfall/prognos)
- Returnera [] om det inte finns någon budgettabell på sidan
- ENBART JSON, ingen annan text`
}

/**
 * Extrahera budgetdata via VLM (Claude) från en tile-bild.
 * Returnerar parsed nämnd-data eller tom array.
 */
function extractWithVlm(tilePath: string): NämndBudget[] {
  const prompt = buildExtractionPrompt()

  // Använd Claude CLI (kiro) eller anthropic API via curl
  // Fallback: base64-encode bild och skicka via API
  const imgBase64 = execSync(`base64 -i "${tilePath}"`, {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim()

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imgBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  const tmpReq = join(TMP_DIR, 'vlm-request.json')
  writeFileSync(tmpReq, requestBody)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('   ✗ ANTHROPIC_API_KEY saknas. Sätter env-variabeln.')
    process.exit(1)
  }

  const response = execSync(
    `curl -sS https://api.anthropic.com/v1/messages -H "x-api-key: ${apiKey}" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d @"${tmpReq}"`,
    { encoding: 'utf-8', timeout: 60_000 },
  )

  try {
    const result = JSON.parse(response)
    const text = result.content?.[0]?.text || ''
    // Extrahera JSON-array från response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ namn: string; belopp_tkr: number }>
    return parsed
      .filter((r) => r.belopp_tkr > 1000) // Minst 1 mnkr
      .map((r) => ({
        namn: r.namn,
        kommunbidragMnkr: Math.round(r.belopp_tkr / 1000),
      }))
  } catch (e) {
    console.error('   ✗ VLM parse error:', (e as Error).message)
    return []
  }
}

/**
 * Bygg knowledge graph från nämnder-data
 */
function buildGraph(
  nämnder: NämndBudget[],
  år: string,
  styre: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const totalMnkr = nämnder.reduce((sum, n) => sum + n.kommunbidragMnkr, 0)

  nodes.push({
    id: `budget-${år}`,
    typ: 'budget',
    label: `Göteborgs Stad Kommunbudget ${år}`,
    data: { år: Number(år), totalMnkr, styre, källa: 'PDF+VLM' },
  })

  for (const n of nämnder) {
    const id = `nämnd-${n.namn
      .toLowerCase()
      .replace(/[^a-zåäö0-9]+/g, '-')
      .replace(/-+$/, '')}`
    const andel = Math.round((n.kommunbidragMnkr / totalMnkr) * 1000) / 10
    nodes.push({
      id,
      typ: 'nämnd',
      label: n.namn,
      data: { kommunbidragMnkr: n.kommunbidragMnkr, andelProcent: andel },
    })
    edges.push({
      from: `budget-${år}`,
      to: id,
      typ: 'finansierar',
      data: { mnkr: n.kommunbidragMnkr, andel },
    })
  }
  return { nodes, edges }
}

/**
 * Parsea ett budget-PDF med pixelshot + VLM
 */
async function parseBudget(pdfPath: string, år: string, styre: string): Promise<void> {
  console.log(`\n💰 Budget ${år} (${styre})`)
  console.log(`   PDF: ${pdfPath}`)

  // 1. Hitta relevanta sidor
  const budgetPages = findBudgetPages(pdfPath)
  console.log(
    `   📄 Sidor med budgettabell: ${budgetPages.length > 0 ? budgetPages.join(', ') : '(söker alla)'}`,
  )

  // 2. Rendera till tiles
  const tilesDir = join(TILES_DIR, `budget-${år}`)
  const tiles = renderTiles(pdfPath, tilesDir)

  // 3. Extrahera med VLM från relevanta sidor
  const pagesToScan = budgetPages.length > 0 ? budgetPages : [1, 2, 3, 4, 5] // Fallback: första 5
  let allNämnder: NämndBudget[] = []

  for (const pageNum of pagesToScan) {
    if (pageNum > tiles.length) continue
    const tile = tiles[pageNum - 1]
    console.log(`   🤖 VLM → sida ${pageNum}...`)
    const result = extractWithVlm(tile)
    if (result.length > 0) {
      console.log(`      ✓ ${result.length} nämnder hittade`)
      allNämnder = [...allNämnder, ...result]
    }
  }

  // Dedup by namn (ta senaste/störst)
  const unique = new Map<string, NämndBudget>()
  for (const n of allNämnder) {
    const key = n.namn.toLowerCase()
    if (!unique.has(key) || unique.get(key)!.kommunbidragMnkr < n.kommunbidragMnkr) {
      unique.set(key, n)
    }
  }
  const nämnder = [...unique.values()]

  if (nämnder.length === 0) {
    console.error(`   ✗ Inga nämnder hittade för ${år}`)
    return
  }

  const total = nämnder.reduce((s, n) => s + n.kommunbidragMnkr, 0)
  console.log(`\n   ${nämnder.length} nämnder, totalt ${total.toLocaleString('sv-SE')} mnkr`)
  for (const n of nämnder.slice(0, 8)) {
    console.log(
      `   ${n.namn.padEnd(40)} ${n.kommunbidragMnkr.toLocaleString('sv-SE').padStart(8)} mnkr`,
    )
  }
  if (nämnder.length > 8) console.log(`   ... +${nämnder.length - 8} till`)

  // 4. Bygg graf & spara
  const graph = buildGraph(nämnder, år, styre)
  const outPath = join(OUTPUT_DIR, `budget-${år}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n   ✅ ${outPath} (${graph.nodes.length} noder, ${graph.edges.length} kanter)`)
}

// ============ MAIN ============
async function main() {
  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })
  mkdirSync(TILES_DIR, { recursive: true })

  const args = process.argv.slice(2)
  const yearIdx = args.indexOf('--year')
  const localIdx = args.indexOf('--local')
  const targetYear = yearIdx >= 0 ? args[yearIdx + 1] : null
  const localPdf = localIdx >= 0 ? args[localIdx + 1] : null

  // Om lokalt PDF angetts
  if (localPdf && targetYear) {
    if (!existsSync(localPdf)) {
      console.error(`✗ Filen finns inte: ${localPdf}`)
      process.exit(1)
    }
    await parseBudget(localPdf, targetYear, 'S+V+MP')
    return
  }

  // Vilka år att köra
  const years = targetYear ? [targetYear] : Object.keys(BUDGET_URLS).sort()

  console.log('═══════════════════════════════════════════════')
  console.log(' Budget Parser (pixelshot + VLM)')
  console.log(' Göteborgs Stad Kommunbudget')
  console.log('═══════════════════════════════════════════════')

  if (!targetYear) {
    console.log('\n⚠️  Budgetar 2022-2023 är ej tillgängliga via goteborg.se.')
    console.log('   Alternativ:')
    console.log('   1. Begär via registrator@goteborg.se (Begäran om allmän handling)')
    console.log('   2. Lägg PDF i .tmp/ och kör:')
    console.log('      npx tsx parse-budget-batch.ts --local .tmp/budget-2022.pdf --year 2022')
    console.log('      npx tsx parse-budget-batch.ts --local .tmp/budget-2023.pdf --year 2023\n')
  }

  for (const år of years) {
    const url = BUDGET_URLS[år]
    if (!url) {
      console.log(`\n⏭️  Budget ${år}: ingen URL tillgänglig (kräver manuell PDF)`)
      continue
    }

    const pdfPath = join(TMP_DIR, `budget-${år}.pdf`)
    downloadPdf(url, pdfPath)
    await parseBudget(pdfPath, år, 'S+V+MP')
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log(' Klart!')
  console.log('═══════════════════════════════════════════════')
}

main().catch(console.error)
