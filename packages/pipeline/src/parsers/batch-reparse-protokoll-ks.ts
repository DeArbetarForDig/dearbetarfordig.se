/**
 * Batch parse all KS protocols.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const PARSER = join(import.meta.dirname, 'parse-protokoll-ks.ts')

mkdirSync(TMP_DIR, { recursive: true })

function getProtokollUrls(): Array<{ datum: string; url: string }> {
  const urls: Array<{ datum: string; url: string }> = []
  for (const year of ['2024', '2025', '2026']) {
    const path = join(DATA_DIR, `beslut/ks-handlingar-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden) {
      for (const h of s.handlingar) {
        if (h.titel.match(/^Protokoll_\d+\.pdf$/)) {
          urls.push({ datum: s.datum, url: h.url })
        }
      }
    }
  }
  return urls
}

async function main() {
  const protocols = getProtokollUrls()
  console.log(`📄 Batch parse KS: ${protocols.length} protokoll\n`)

  let ok = 0
  let fail = 0

  for (const { datum, url } of protocols) {
    const pdfPath = join(TMP_DIR, `ks-protokoll-${datum}.pdf`)

    if (!existsSync(pdfPath) || readFileSync(pdfPath, 'utf-8').startsWith('<!DOCTYPE')) {
      try {
        execSync(`curl -sL '${url}' -o "${pdfPath}"`, { timeout: 30000 })
      } catch {
        console.log(`  ✗ ${datum} — download failed`)
        fail++
        continue
      }
    }

    const header = readFileSync(pdfPath, 'utf-8').slice(0, 5)
    if (!header.startsWith('%PDF')) {
      console.log(`  ✗ ${datum} — not a PDF`)
      fail++
      continue
    }

    try {
      const out = execSync(`npx tsx "${PARSER}" "${pdfPath}" "${datum}"`, {
        encoding: 'utf-8',
        timeout: 60000,
        cwd: join(import.meta.dirname, '../../../..'),
      })
      const nodesMatch = out.match(/Nodes: (\d+)/)
      const närvMatch = out.match(/Närvarande: (\d+)/)
      console.log(
        `  ✓ ${datum} — ${nodesMatch?.[1] || '?'} nodes, ${närvMatch?.[1] || '0'} närvarande`,
      )
      ok++
    } catch {
      console.log(`  ✗ ${datum} — parse error`)
      fail++
    }
  }

  console.log(`\n✅ Done: ${ok} ok, ${fail} failed`)
}

main().catch(console.error)
