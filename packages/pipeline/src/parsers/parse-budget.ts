/**
 * Budget PDF Parser — автоматически извлекает бюджет из PDF в knowledge graph
 *
 * Парсит оригинальный PDF бюджета Göteborgs Stad:
 * 1. Скачивает PDF (из handlingar или по URL)
 * 2. Извлекает текст (pdftotext -layout)
 * 3. Находит таблицу kommunbidrag per nämnd (regex)
 * 4. Строит граф: budget → nämnder → poster
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')
const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')

interface GraphNode {
  id: string
  typ: 'budget' | 'nämnd' | 'post' | 'leverantör'
  label: string
  data: Record<string, unknown>
}

interface GraphEdge {
  from: string
  to: string
  typ: 'finansierar' | 'ingår_i' | 'köper_av'
  data?: Record<string, unknown>
}

// Parse the budget table from PDF text
function parseBudgetTable(text: string): Array<{ namn: string; belopp: number }> {
  const results: Array<{ namn: string; belopp: number }> = []

  // Pattern: "Nämndnamn" followed by spaces and a number like "5 361 320" (tkr)
  // The table uses thousands (tkr), with space-separated groups
  const lines = text.split('\n')

  for (const line of lines) {
    // Match lines like: "Förskolenämnden                    5 361 320"
    const match = line.match(/^(.{20,60}?)\s{2,}([\d ]{5,15})$/)
    if (!match) continue

    const namn = match[1].trim()
    const beloppStr = match[2].replace(/\s/g, '')
    const beloppTkr = parseInt(beloppStr)

    if (!beloppTkr || beloppTkr < 1000) continue // Skip tiny/invalid

    // Convert tkr → mnkr
    const beloppMnkr = Math.round(beloppTkr / 1000)

    // Only include known nämnd-like names (exclude summa/total rows and table headers)
    if (namn.match(/^(Summa|Totalt|Kommunalskatt|Exploateringsvo|Exploateringsinkomst|Exploateringarnetto|Kommuncentrala|Kommunbidrag nämnder|Finansiering via)/i)) continue
    if (namn.match(/nämnden|Förskole|Grundskole|Social|Stadsmiljö|Kommun|Kultur|Utbildnings|Valnämnd|Äldre|Exploaterings(?!vo)|Stadsbygg|Stadsfastig|Intraservice|Inköps|Idrotts|Kretslopp|Arkiv|Business|Göteborg|Överförmyndar/i)) {
      results.push({ namn, belopp: beloppMnkr })
    }
  }

  return results
}

// Find and extract uppdrag from budget text
function parseUppdrag(text: string): Array<{ nämnd: string; uppdrag: string }> {
  const results: Array<{ nämnd: string; uppdrag: string }> = []
  const re = /(?:»\s*)([\wäöåÅÄÖ\s,-]+?(?:nämnden|nämnderna|styrelsen|AB))\s+(?:får i uppdrag att|ska)\s+([^»\n]{20,200})/g
  let match
  while ((match = re.exec(text)) !== null) {
    results.push({ nämnd: match[1].trim(), uppdrag: match[2].trim() })
  }
  return results
}

function buildGraph(nämnder: Array<{ namn: string; belopp: number }>, år: string, styre: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const totalMnkr = nämnder.reduce((sum, n) => sum + n.belopp, 0)

  // Root
  nodes.push({
    id: `budget-${år}`,
    typ: 'budget',
    label: `Göteborgs Stad Kommunbudget ${år}`,
    data: { år: parseInt(år), totalMnkr, styre, källa: 'PDF' },
  })

  // Nämnder
  for (const n of nämnder) {
    const id = `nämnd-${n.namn.toLowerCase().replace(/[^a-zåäö0-9]+/g, '-').replace(/-+$/, '')}`
    const andel = Math.round((n.belopp / totalMnkr) * 1000) / 10

    nodes.push({
      id,
      typ: 'nämnd',
      label: n.namn,
      data: { kommunbidragMnkr: n.belopp, andelProcent: andel },
    })
    edges.push({
      from: `budget-${år}`,
      to: id,
      typ: 'finansierar',
      data: { mnkr: n.belopp, andel },
    })
  }

  return { nodes, edges }
}

async function main() {
  const pdfUrlOrPath = process.argv[2]
  const år = process.argv[3] || '2026'
  const styre = process.argv[4] || 'S+V+MP'

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  let pdfPath: string

  if (!pdfUrlOrPath) {
    // Auto-find budget PDF from handlingar data
    const handlingarPath = join(DATA_DIR, 'beslut/kf-handlingar-2025.json')
    if (!existsSync(handlingarPath)) {
      console.error('Kör scrape:handlingar först, eller ange PDF-sökväg/URL')
      process.exit(1)
    }
    const handlingar = JSON.parse(readFileSync(handlingarPath, 'utf-8'))
    let budgetUrl = ''
    for (const s of handlingar.sammanträden) {
      for (const h of s.handlingar) {
        if (h.titel.match(/Budget\d{4}.*S.*V.*MP/i) && !h.titel.includes('Yrkande')) {
          budgetUrl = h.url
          break
        }
      }
      if (budgetUrl) break
    }
    if (!budgetUrl) { console.error('Hittade ingen budget-PDF i handlingar'); process.exit(1) }

    pdfPath = join(TMP_DIR, `budget-${år}.pdf`)
    if (!existsSync(pdfPath)) {
      console.log(`⬇️  Laddar ner budget-PDF...`)
      execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' "${budgetUrl}" -o "${pdfPath}"`)
    }
  } else if (pdfUrlOrPath.startsWith('http')) {
    pdfPath = join(TMP_DIR, `budget-${år}.pdf`)
    if (!existsSync(pdfPath)) {
      console.log(`⬇️  Laddar ner: ${pdfUrlOrPath.slice(0, 60)}...`)
      execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' "${pdfUrlOrPath}" -o "${pdfPath}"`)
    }
  } else {
    pdfPath = pdfUrlOrPath
  }

  console.log(`💰 Parsear budget ${år} (${styre})...\n`)

  // Extract text with layout preservation (important for tables)
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  console.log(`   ${text.split('\n').length} rader text`)

  // Parse budget table
  const nämnder = parseBudgetTable(text)
  console.log(`   ${nämnder.length} nämnder/poster hittade`)

  if (nämnder.length === 0) {
    console.error('   ✗ Kunde inte hitta budgettabellen i PDF')
    process.exit(1)
  }

  const totalMnkr = nämnder.reduce((sum, n) => sum + n.belopp, 0)
  console.log(`   Total: ${totalMnkr} mnkr\n`)

  for (const n of nämnder.slice(0, 10)) {
    console.log(`   ${n.namn.padEnd(45)} ${n.belopp.toLocaleString().padStart(8)} mnkr`)
  }
  if (nämnder.length > 10) console.log(`   ... och ${nämnder.length - 10} till`)

  // Build graph
  const graph = buildGraph(nämnder, år, styre)

  // Parse uppdrag and add as edges
  const uppdrag = parseUppdrag(text)
  console.log(`\n   ${uppdrag.length} uppdrag hittade`)

  const outPath = join(OUTPUT_DIR, `budget-${år}.json`)
  writeFileSync(outPath, JSON.stringify(graph, null, 2))
  console.log(`\n✅ ${outPath} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`)
}

main().catch(console.error)
