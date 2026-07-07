/**
 * parse-voteringar.ts — regenerates individual röstade_* edges from KF
 * voting bilagor (protocol appendices with namnupprop).
 *
 * Target resolution: a bilaga identifies its vote by AGENDA number
 * ("Ärende: 15"), which is NOT the protocol § number — the earlier version
 * of this script built targets as `kf-<datum>-§<ärende>`, which on most
 * dates points at a nonexistent node (dropped at seed) or, worse, at a
 * DIFFERENT paragraph that happens to have that § number (off-by-N vote
 * corruption). See docs/ANALYS-2026-07.md, punkt 18.
 *
 * The correct mapping goes via the bilaga's Ärendemening, matched against
 * the § rubriker in data/graf/kf-<datum>.json (which must be freshly
 * parsed — run batch-reparse-protokoll.ts first).
 *
 * Sub-voteringar ("Ärende: 8:1", "8:2" — motförslagsvotering followed by
 * huvudvotering) share one §: only the LAST (the huvudvotering, the vote
 * that decides the ärende) becomes röstade_* edges.
 *
 * REPLACES all existing röstade_* edges in politiker-komplett.json.
 *
 * Usage: npx tsx parse-voteringar.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const KOMPLETT_PATH = join(DATA_DIR, 'graf/politiker-komplett.json')

// Column-based vote line: "Aslan Akbas       S       1   Ordförande   Ja".
// Column separators vary between protocol generations — some tables use a
// single space ("… 1 Ordförande Ja") and long names get squeezed against the
// parti column ("Robert Andersson Hammarstrand S") — so separators are \s+
// and the line is anchored by parti + plats-number + röst instead.
const VOTE_RE =
  /^\s*(.{2,45}?)\s+(S|M|V|SD|L|MP|D|KD|C)\s+\d+\s+.+?\s+(Ja|Nej|Avstår|Frånvarande)\s*$/

interface Votering {
  ärende: string // full bilaga id incl. sub-votering, e.g. "8:2"
  bas: string // base agenda number, e.g. "8"
  mening: string
  antal: { ja: number; nej: number; avstår: number; frånvarande: number }
  röster: Array<{ namn: string; parti: string; röst: string }>
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zåäö0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseBilagor(pdfPath: string): Votering[] {
  const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
  const voteringar: Votering[] = []

  // Header form varies by protocol generation: 2023 uses an indented
  // uppercase "BILAGA 2", 2025+ a line-start "Bilaga 2" — match both as an
  // own-line header. A missed split glues ALL vote tables into one bilaga
  // and attributes every vote of the meeting to its first ärende.
  for (const bilaga of text.split(/(?=^[ \t]*BILAGA\s+\d+\s*$)/im)) {
    const ärendeMatch = bilaga.match(/Ärende:\s*([\d:]+)/)
    const meningMatch = bilaga.match(/Ärendemening:\s*([\s\S]+?)\s*\nAntal Ja/)
    const jaMatch = bilaga.match(/Antal Ja:\s*(\d+)/)
    if (!ärendeMatch || !meningMatch || !jaMatch) continue

    const resultatIdx = bilaga.indexOf('Resultat')
    if (resultatIdx === -1) continue

    const röster: Votering['röster'] = []
    let pendingName = ''
    for (const line of bilaga.slice(resultatIdx).split('\n').slice(1)) {
      const m = line.match(VOTE_RE)
      if (m) {
        const namn = `${pendingName} ${m[1]}`.trim()
        pendingName = ''
        röster.push({ namn, parti: m[2], röst: m[3].toLowerCase() })
      } else if (
        line.trim() &&
        !line.match(/^\s*(Namn|Bilaga|\f|Göteborgs|Kommunfullmäktige|Protokoll|Sammanträdes)/i)
      ) {
        pendingName += ` ${line.trim()}`
      } else {
        pendingName = ''
      }
    }
    if (röster.length === 0) continue

    const antal = {
      ja: Number.parseInt(jaMatch[1]),
      nej: Number.parseInt(bilaga.match(/Antal Nej:\s*(\d+)/)?.[1] || '0'),
      avstår: Number.parseInt(bilaga.match(/Antal Avstår:\s*(\d+)/)?.[1] || '0'),
      frånvarande: Number.parseInt(bilaga.match(/Antal Frånv\w*:\s*(\d+)/)?.[1] || '0'),
    }
    const förväntat = antal.ja + antal.nej + antal.avstår + antal.frånvarande
    if (röster.length > förväntat) {
      // More parsed vote rows than the bilaga's own tally — table glued or
      // duplicated; refuse rather than seed corrupt votes.
      throw new Error(
        `${pdfPath}: ärende ${ärendeMatch[1]} har ${röster.length} rösträder men tally ${förväntat}`,
      )
    }

    voteringar.push({
      ärende: ärendeMatch[1],
      bas: ärendeMatch[1].split(':')[0],
      mening: meningMatch[1].replace(/\s+/g, ' ').trim(),
      antal,
      röster,
    })
  }
  return voteringar
}

/** Match a bilaga's ärendemening against the date's § rubriker. */
function findParagraf(
  mening: string,
  antal: Votering['antal'],
  paragrafer: Array<{ id: string; rubrik: string; fulltext: string }>,
): { id: string; ambiguous: boolean } | null {
  // Compare the full overlap of the shorter string — the bilaga truncates
  // meningen at ~70 chars, but a fixed shorter cap confused ärenden that
  // share a long prefix ("Motion av Axel Darvik (L) och Eva Flyborg (L) om
  // att skydda…" vs "…om att införa…"). Spaces are stripped before
  // comparison: pdftotext drops hyphens over line breaks ("Sundén-Andersson"
  // → "SundénAndersson"). Exact equality accepts short rubriker
  // ("Frågestund") that the minimum-overlap rule would reject.
  const a = norm(mening).replace(/ /g, '')
  const candidates = paragrafer.filter((p) => {
    const b = norm(p.rubrik).replace(/ /g, '')
    if (b.length > 0 && a === b) return true
    const n = Math.min(a.length, b.length)
    return n >= 13 && a.slice(0, n) === b.slice(0, n)
  })
  if (candidates.length === 0) {
    // Old-format procedural §§ can lack a rubrik entirely — fall back to the
    // paragraph whose fulltext quotes the ärendemening, if unique. (Matching
    // on the vote tally instead is tempting but two voteringar on the same
    // date can share exact numbers — it mis-assigned 2023-10-12 ärende 13:2
    // to §8.)
    const iText = paragrafer.filter((p) => norm(p.fulltext).replace(/ /g, '').includes(a))
    if (iText.length === 1) return { id: iText[0].id, ambiguous: false }
    return null
  }
  if (candidates.length === 1) return { id: candidates[0].id, ambiguous: false }
  // Same rubrik on several §§ (e.g. a bordlagd motion retaken): the protocol
  // § quotes the tally — pick the candidate whose text carries this bilaga's
  // exact result, else one that records an omröstning at all.
  const medTal = candidates.filter((p) =>
    p.fulltext.match(new RegExp(`${antal.ja}\\s*Ja\\s*mot\\s*${antal.nej}\\s*Nej`, 'i')),
  )
  if (medTal.length === 1) return { id: medTal[0].id, ambiguous: false }
  const medOmröstning = candidates.filter((p) => /omröstning/i.test(p.fulltext))
  const pick = medOmröstning.length === 1 ? medOmröstning[0] : candidates[0]
  return { id: pick.id, ambiguous: medOmröstning.length !== 1 }
}

function getProtokoll(): Array<{ datum: string; url: string }> {
  const found = new Map<string, string>()
  for (const year of ['2023', '2024', '2025', '2026']) {
    const path = join(DATA_DIR, `beslut/kf-handlingar-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden) {
      const h = s.handlingar.find((h: { titel: string }) =>
        h.titel.toLowerCase().includes('kf_protokoll'),
      )
      if (h && !found.has(s.datum)) found.set(s.datum, h.url)
    }
  }
  return [...found.entries()].sort().map(([datum, url]) => ({ datum, url }))
}

/** Download the protocol PDF if it isn't cached (fresh CI runner). */
function ensurePdf(datum: string, url: string): string | null {
  const pdfPath = join(TMP_DIR, `protokoll-${datum}.pdf`)
  if (!existsSync(pdfPath)) {
    try {
      execSync(`curl -sL '${url}' -o "${pdfPath}"`, { timeout: 60000 })
    } catch {
      return null
    }
  }
  if (!existsSync(pdfPath) || !readFileSync(pdfPath).subarray(0, 5).toString().startsWith('%PDF')) {
    return null
  }
  return pdfPath
}

async function main() {
  mkdirSync(TMP_DIR, { recursive: true })

  // Name → politiker node id
  const polData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const nameToId: Record<string, string> = {}
  for (const p of polData.politiker) {
    const pid = `politiker-${p.id}`
    nameToId[`${p.förnamn} ${p.efternamn}`.toLowerCase()] = pid
    const parts = p.efternamn.split(' ')
    if (parts.length > 1) {
      for (const part of parts) nameToId[`${p.förnamn} ${part}`.toLowerCase()] = pid
    }
  }

  const newEdges: Array<{ from: string; to: string; typ: string; data: Record<string, unknown> }> =
    []
  let totalVoteringar = 0
  let totalHuvud = 0
  let omatchadeParagrafer = 0
  const omatchadeNamn = new Map<string, number>()

  for (const { datum, url } of getProtokoll()) {
    const pdfPath = ensurePdf(datum, url)
    const grafPath = join(DATA_DIR, `graf/kf-${datum}.json`)
    if (!pdfPath || !existsSync(grafPath)) {
      console.log(`  ⚠️ ${datum}: pdf eller graf saknas — hoppar över`)
      continue
    }

    const voteringar = parseBilagor(pdfPath)
    if (voteringar.length === 0) continue
    totalVoteringar += voteringar.length

    const graf = JSON.parse(readFileSync(grafPath, 'utf-8'))
    const paragrafer = graf.nodes
      .filter((n: { typ: string }) => n.typ === 'paragraf')
      .map((n: { id: string; data: { rubrik?: string; fulltext?: string } }) => ({
        id: n.id,
        rubrik: n.data.rubrik || '',
        fulltext: n.data.fulltext || '',
      }))

    // Only the last sub-votering per base ärende (the huvudvotering) counts
    const huvudPerBas = new Map<string, Votering>()
    for (const v of voteringar) huvudPerBas.set(v.bas, v)

    let matchadeRöster = 0
    let döda = 0
    for (const v of huvudPerBas.values()) {
      totalHuvud++
      const träff = findParagraf(v.mening, v.antal, paragrafer)
      if (!träff) {
        omatchadeParagrafer++
        console.log(`  ⚠️ ${datum} ärende ${v.ärende}: ingen § matchar "${v.mening.slice(0, 60)}"`)
        continue
      }
      if (träff.ambiguous) {
        console.log(`  ⚠️ ${datum} ärende ${v.ärende}: flera §-kandidater, valde ${träff.id}`)
      }
      for (const r of v.röster) {
        const pid = nameToId[r.namn.toLowerCase()]
        if (!pid) {
          omatchadeNamn.set(r.namn, (omatchadeNamn.get(r.namn) || 0) + 1)
          döda++
          continue
        }
        matchadeRöster++
        newEdges.push({
          from: pid,
          to: träff.id,
          typ: `röstade_${r.röst}`,
          data: { mandatperiod: '2022-2026', datum, bilagaÄrende: v.ärende },
        })
      }
    }
    console.log(
      `  ✅ ${datum}: ${voteringar.length} bilagor → ${huvudPerBas.size} huvudvoteringar, ${matchadeRöster} röster${döda ? ` (${döda} omatchade namn)` : ''}`,
    )
  }

  console.log(`\n📊 ${totalVoteringar} bilagor, ${totalHuvud} huvudvoteringar`)
  console.log(`   ${newEdges.length} röstade-edges genererade`)
  if (omatchadeParagrafer > 0) console.log(`   ⚠️ ${omatchadeParagrafer} voteringar utan §-träff`)
  if (omatchadeNamn.size > 0) {
    console.log(`   ⚠️ omatchade namn (${omatchadeNamn.size}):`)
    for (const [namn, antal] of [...omatchadeNamn.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)) {
      console.log(`      ${antal}× ${JSON.stringify(namn)}`)
    }
  }

  // Replace all röstade_* edges in politiker-komplett.json
  const komplett = JSON.parse(readFileSync(KOMPLETT_PATH, 'utf-8'))
  const före = komplett.edges.length
  const behållna = komplett.edges.filter((e: { typ: string }) => !e.typ.startsWith('röstade_'))
  const borttagna = före - behållna.length

  // Full replacement: a run that parsed drastically fewer votes than the file
  // already holds (unreachable PDFs on a fresh CI runner, site down, format
  // drift) must not silently wipe the dataset.
  if (newEdges.length < borttagna * 0.9) {
    throw new Error(
      `vägrar ersätta: ${borttagna} befintliga röstade-edges men bara ${newEdges.length} nya parsade (<90%)`,
    )
  }

  komplett.edges = behållna
  komplett.edges.push(...newEdges)
  writeFileSync(KOMPLETT_PATH, JSON.stringify(komplett, null, 2))
  console.log(
    `\n✅ politiker-komplett.json: ${borttagna} gamla röstade-edges ersatta med ${newEdges.length}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
