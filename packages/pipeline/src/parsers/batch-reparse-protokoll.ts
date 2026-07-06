/**
 * Batch reparse all KF protocols.
 * Downloads PDFs (if not cached) and runs parse-protokoll on each.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const PARSER = join(import.meta.dirname, 'parse-protokoll.ts')

mkdirSync(TMP_DIR, { recursive: true })

interface Sammanträde {
  datum: string
  handlingar: Array<{ titel: string; url: string }>
}

function getProtokollUrls(): Array<{ datum: string; url: string }> {
  const urls: Array<{ datum: string; url: string }> = []
  for (const year of ['2023', '2024', '2025', '2026']) {
    const path = join(DATA_DIR, `beslut/kf-handlingar-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden as Sammanträde[]) {
      for (const h of s.handlingar) {
        // Case-insensitive: 2023-06-08 is published as "KF_Protokoll_20230608.pdf"
        if (h.titel.toLowerCase().includes('kf_protokoll')) {
          urls.push({ datum: s.datum, url: h.url })
        }
      }
    }
  }
  return urls
}

async function main() {
  const protocols = getProtokollUrls()
  console.log(`📄 Batch reparse: ${protocols.length} KF-protokoll\n`)

  let ok = 0
  let fail = 0

  for (const { datum, url } of protocols) {
    const pdfPath = join(TMP_DIR, `protokoll-${datum}.pdf`)

    // Download if not cached or if cached file is HTML (broken)
    if (!existsSync(pdfPath) || readFileSync(pdfPath, 'utf-8').startsWith('<!DOCTYPE')) {
      try {
        execSync(`curl -sL '${url}' -o "${pdfPath}"`, { timeout: 30000 })
      } catch {
        console.log(`  ✗ ${datum} — download failed`)
        fail++
        continue
      }
    }

    // Verify it's a real PDF
    const header = readFileSync(pdfPath, 'utf-8').slice(0, 5)
    if (!header.startsWith('%PDF')) {
      console.log(`  ✗ ${datum} — not a PDF (${header.slice(0, 10)}...)`)
      fail++
      continue
    }

    // Parse
    try {
      const out = execSync(`npx tsx "${PARSER}" "${pdfPath}" "${datum}"`, {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: join(import.meta.dirname, '../../../..'),
      })
      const närvaroMatch = out.match(/Närvaro: (\d+)/)
      const nodesMatch = out.match(/Nodes: (\d+)/)
      console.log(
        `  ✓ ${datum} — ${nodesMatch?.[1] || '?'} nodes, ${närvaroMatch?.[1] || '0'} närvaro`,
      )
      ok++
    } catch (e: any) {
      console.log(`  ✗ ${datum} — parse error`)
      fail++
    }
  }

  console.log(`\n✅ Done: ${ok} ok, ${fail} failed`)
}

main().catch(console.error)
