/**
 * Inbox Parser — обрабатывает PDF-документы, полученные через begäran om allmän handling
 *
 * Использование:
 *   1. Положить PDF в data/inbox/
 *   2. Запустить: npx tsx src/parsers/parse-inbox.ts
 *   3. Каждый PDF → извлечение текста → NER (organisationer, belopp, avtal) → граф
 *
 * Поддерживаемые типы:
 *   - Årsrapporter → извлекает финансовые данные, leverantörer
 *   - Ramavtal → извлекает avtalspartner, belopp, löptid
 *   - Leverantörslistor → извлекает alla leverantörer + belopp
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const INBOX_DIR = join(import.meta.dirname, '../../../../data/inbox')
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')

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

// Extract monetary amounts with context
function extractBelopp(text: string): Array<{ belopp: number; enhet: string; kontext: string }> {
  const results: Array<{ belopp: number; enhet: string; kontext: string }> = []
  const re = /([\d\s,]+)\s*(mnkr|mkr|tkr|kkr|miljoner|miljarder)\b/gi
  let match
  while ((match = re.exec(text)) !== null) {
    const raw = match[1].replace(/\s/g, '').replace(',', '.')
    const belopp = parseFloat(raw)
    if (isNaN(belopp)) continue
    const enhet = match[2].toLowerCase()
    const start = Math.max(0, match.index - 60)
    const kontext = text.slice(start, match.index + match[0].length + 30).replace(/\n/g, ' ').trim()
    results.push({ belopp, enhet, kontext })
  }
  return results
}

// Extract organisation/company names
function extractLeverantörer(text: string): Array<{ namn: string; belopp?: number }> {
  const results: Array<{ namn: string; belopp?: number }> = []
  // Pattern: "Company AB/AS" followed by amount
  const re = /([\wÅÄÖåäö][\w\sÅÄÖåäö&-]{2,40}(?:AB|AS|Ltd|GmbH|Sverige|Group|Networks|Consulting))\b/g
  const seen = new Set<string>()
  let match
  while ((match = re.exec(text)) !== null) {
    const namn = match[1].trim()
    if (seen.has(namn.toLowerCase())) continue
    seen.add(namn.toLowerCase())
    results.push({ namn })
  }
  return results
}

function parseDocument(pdfPath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const fileName = basename(pdfPath, '.pdf')
  const docId = `doc-${fileName.toLowerCase().replace(/[^a-zåäö0-9]+/g, '-')}`

  // Extract text
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })

  // Document node
  nodes.push({
    id: docId,
    typ: 'dokument',
    label: fileName.replace(/_/g, ' '),
    data: { källa: 'begäran', fil: basename(pdfPath), rader: text.split('\n').length },
  })

  // Extract leverantörer
  const leverantörer = extractLeverantörer(text)
  for (const l of leverantörer) {
    const levId = `leverantör-${l.namn.toLowerCase().replace(/[^a-zåäö0-9]+/g, '-')}`
    if (!nodes.find(n => n.id === levId)) {
      nodes.push({ id: levId, typ: 'leverantör', label: l.namn, data: {} })
    }
    edges.push({ from: docId, to: levId, typ: 'nämner' })
  }

  // Extract monetary amounts
  const belopp = extractBelopp(text)
  if (belopp.length > 0) {
    nodes[0].data.belopp = belopp.slice(0, 20) // Store top amounts in doc node
  }

  return { nodes, edges }
}

function main() {
  console.log('📬 Parsear inbox-dokument...\n')

  if (!existsSync(INBOX_DIR)) {
    console.log('   Ingen inbox-mapp hittad. Skapa data/inbox/ och lägg PDF:er där.')
    return
  }

  const pdfs = readdirSync(INBOX_DIR).filter(f => f.endsWith('.pdf'))
  if (pdfs.length === 0) {
    console.log('   Inga PDF:er i data/inbox/')
    console.log('   Lägg dit dokument från begäran om allmän handling.')
    return
  }

  console.log(`   ${pdfs.length} PDF:er att parsa\n`)
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const allNodes: GraphNode[] = []
  const allEdges: GraphEdge[] = []

  for (const pdf of pdfs) {
    const path = join(INBOX_DIR, pdf)
    process.stdout.write(`   ${pdf}...`)
    try {
      const { nodes, edges } = parseDocument(path)
      allNodes.push(...nodes)
      allEdges.push(...edges)
      const levCount = nodes.filter(n => n.typ === 'leverantör').length
      console.log(` ✓ (${levCount} leverantörer)`)
    } catch (err) {
      console.log(` ✗ ${err}`)
    }
  }

  const outPath = join(OUTPUT_DIR, 'inbox-dokument.json')
  writeFileSync(outPath, JSON.stringify({ nodes: allNodes, edges: allEdges }, null, 2))
  console.log(`\n✅ ${outPath} (${allNodes.length} nodes, ${allEdges.length} edges)`)
}

main()
