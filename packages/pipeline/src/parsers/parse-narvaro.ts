/**
 * parse-narvaro.ts — Extracts attendance (närvaro) from KF protocols.
 * 
 * Sources:
 * - Bilaga 1: Full attendance list with arrival/departure times (2025+ format)
 * - Header text: "Tjänstgörande ersättare" list (2023+ format)
 * 
 * Output: data/graf/narvaro.json with edges: politiker → närvarade → möte
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')

// Parse Bilaga 1 format: "Plats  Ledamot  Ersättare  Parti  Ankom  Utgick"
// Lines: "1          Akbas, Aslan                                S        14:41   22:01"
const BILAGA1_RE = /^\s*\d+\s+([\wÅÄÖåäöé -]+?,\s*[\wÅÄÖåäöé -]+?)\s{2,}(?:([\wÅÄÖåäöé -]+?,\s*[\wÅÄÖåäöé -]+?)\s{2,})?(S|M|V|SD|L|MP|D|KD|C)\s{2,}(\d{2}:\d{2})\s+(\d{2}:\d{2})/

// Parse names from text blocks like "Henrik Sjöstrand (M), Joel Wickman (M)"
const NAMN_PARTI_RE = /([\wÅÄÖåäöé][\wÅÄÖåäöé -]+?)\s*\((\w+)\)/g

interface Närvarande { namn: string; parti: string; ankom?: string; utgick?: string; roll: 'ledamot' | 'ersättare' }

function parseNärvaroPdf(pdfPath: string): Närvarande[] {
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  const result: Närvarande[] = []

  // Strategy 1: Parse Bilaga 1 (column format with times)
  const bilaga1Match = text.match(/Bilaga 1[\s\S]*?Plats\s+Ledamot[\s\S]*?(?=Bilaga 2|$)/)
  if (bilaga1Match) {
    const lines = bilaga1Match[0].split('\n')
    for (const line of lines) {
      const m = line.match(BILAGA1_RE)
      if (m) {
        // "Efternamn, Förnamn" → "Förnamn Efternamn"
        const [efter, för] = m[1].split(',').map(s => s.trim())
        result.push({ namn: `${för} ${efter}`, parti: m[3], ankom: m[4], utgick: m[5], roll: 'ledamot' })
        // Ersättare column
        if (m[2]) {
          const [eEfter, eFör] = m[2].split(',').map(s => s.trim())
          if (eFör) result.push({ namn: `${eFör} ${eEfter}`, parti: m[3], ankom: m[4], utgick: m[5], roll: 'ersättare' })
        }
      }
    }
  }

  // Strategy 2: Parse header text (always present in both formats)
  const tjänstSection = text.match(/Tjänstgörande ersättare\n([\s\S]*?)(?=\nÖvriga ersättare|\nÖvriga närvarande|\n\n\n)/)?.[1] || ''
  let m: RegExpExecArray | null
  const re = new RegExp(NAMN_PARTI_RE.source, 'g')
  while ((m = re.exec(tjänstSection)) !== null) {
    const namn = m[1].trim()
    if (!result.find(r => r.namn.toLowerCase() === namn.toLowerCase())) {
      result.push({ namn, parti: m[2], roll: 'ersättare' })
    }
  }

  return result
}

async function main() {
  const pdfs = readdirSync('.tmp').filter(f => f.match(/^kf-protokoll-\d+\.pdf$/)).map(f => `.tmp/${f}`).sort()

  const nodes: any[] = []
  const edges: any[] = []
  let totalNärvaro = 0

  for (const pdf of pdfs) {
    const datumMatch = pdf.match(/(\d{4})(\d{2})(\d{2})/)
    if (!datumMatch) continue
    const datum = `${datumMatch[1]}-${datumMatch[2]}-${datumMatch[3]}`
    const möteId = `möte-kf-${datum}`

    const närvarande = parseNärvaroPdf(pdf)
    if (närvarande.length > 0) {
      console.log(`  ✅ ${datum}: ${närvarande.length} närvarande`)
      totalNärvaro += närvarande.length
    }

    // Store per-meeting attendance data in the möte node
    for (const n of närvarande) {
      edges.push({ from: `namn:${n.namn.toLowerCase()}`, to: möteId, typ: 'närvarade', data: { roll: n.roll, ankom: n.ankom, utgick: n.utgick } })
    }
  }

  console.log(`\n📊 Totalt: ${totalNärvaro} närvaroregistreringar, ${pdfs.length} möten`)

  // Match names to politiker IDs
  const polData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const politiker = polData.politiker as Array<{ id: string; förnamn: string; efternamn: string }>

  const nameToId: Record<string, string> = {}
  for (const p of politiker) {
    const pid = `politiker-${p.id}`
    nameToId[`${p.förnamn} ${p.efternamn}`.toLowerCase()] = pid
    const parts = p.efternamn.split(' ')
    if (parts.length > 1) {
      for (const part of parts) nameToId[`${p.förnamn} ${part}`.toLowerCase()] = pid
    }
  }

  // Convert to proper edges
  const finalEdges: any[] = []
  let matched = 0
  for (const e of edges) {
    const namn = e.from.replace('namn:', '')
    const pid = nameToId[namn]
    if (pid) {
      finalEdges.push({ from: pid, to: e.to, typ: 'närvarade', data: e.data })
      matched++
    }
  }

  console.log(`   ${matched}/${edges.length} matchade till politiker`)

  // Save
  const output = { nodes: [], edges: finalEdges }
  writeFileSync(join(DATA_DIR, 'graf/narvaro.json'), JSON.stringify(output, null, 2))
  console.log(`   ✅ Sparad: data/graf/narvaro.json (${finalEdges.length} edges)`)
}

main()
