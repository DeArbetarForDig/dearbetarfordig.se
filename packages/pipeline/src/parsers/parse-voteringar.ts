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
import { createHash } from 'node:crypto'
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
  // namn = raden inkl. ev. föregående namnfortsättningsrad; bara = raden
  // ensam. Ett efternamn kan radbrytas EFTER sin röstrad ("Robert Andersson
  // S 22 … Ja\nHammarstrand") — då hör fortsättningen till FÖRRA personen
  // och "bara" är rätt nyckel för denna.
  röster: Array<{ namn: string; bara: string; parti: string; röst: string }>
}

/** Deterministiskt uuid (v5-format) ur ett namn — samma person får samma id
 *  vid varje körning, så syntetiserade poster är stabila över omkörningar. */
export function syntetisktId(namn: string): string {
  const h = createHash('sha1').update(`dearbetarfordig-historisk:${namn.toLowerCase()}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
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
  return parseBilagorText(text, pdfPath)
}

export function parseBilagorText(text: string, källa = '<text>'): Votering[] {
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
        röster.push({ namn, bara: m[1].trim(), parti: m[2], röst: m[3].toLowerCase() })
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
        `${källa}: ärende ${ärendeMatch[1]} har ${röster.length} rösträder men tally ${förväntat}`,
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
export function findParagraf(
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

  // Name → politiker node id. Keys are space-collapsed lowercase so bilaga
  // spellings like "AnnaSara Perslow" hit roster "Anna Sara Hansson Perslow";
  // multi-part för-/efternamn generate one key per token combination.
  const polData = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))
  const nameKey = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '')
  const nameToId: Record<string, string> = {}
  for (const p of polData.politiker) {
    const pid = `politiker-${p.id}`
    const förnamn: string[] = [p.förnamn, p.förnamn.split(/\s+/)[0]]
    const efternamn: string[] = [p.efternamn, ...p.efternamn.split(/\s+/)]
    for (const f of förnamn) {
      for (const e of efternamn) {
        const key = nameKey(`${f} ${e}`)
        // Först skrivna (fullständigast) vinner vid kollision
        if (!nameToId[key]) nameToId[key] = pid
      }
    }
  }

  const newEdges: Array<{ from: string; to: string; typ: string; data: Record<string, unknown> }> =
    []
  let totalVoteringar = 0
  let totalHuvud = 0
  let omatchadeParagrafer = 0
  const omatchadeNamn = new Map<string, number>()
  const obundnaRöster: Array<{
    namn: string
    parti: string
    röst: string
    paragrafId: string
    datum: string
    ärende: string
  }> = []

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
        const pid = nameToId[nameKey(r.namn)] || nameToId[nameKey(r.bara)]
        if (!pid) {
          omatchadeNamn.set(r.namn, (omatchadeNamn.get(r.namn) || 0) + 1)
          obundnaRöster.push({
            namn: r.namn,
            parti: r.parti,
            röst: r.röst,
            paragrafId: träff.id,
            datum,
            ärende: v.ärende,
          })
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

  // Personer som röstat men varken finns på levande sajten eller i något
  // Wayback-snapshot (avgångna före första crawlen): voteringsbilagan är i
  // sig ett officiellt belägg för att personen tjänstgjorde — syntetisera en
  // historisk roster-post (deterministiskt uuid ur namnet) och ta rösterna.
  // Tröskeln filtrerar bort enstaka OCR-/radbrytningsartefakter.
  const MIN_RÖSTER_FÖR_SYNTES = 5
  const perNamn = new Map<string, typeof obundnaRöster>()
  for (const r of obundnaRöster) {
    const grupp = perNamn.get(r.namn)
    if (grupp) grupp.push(r)
    else perNamn.set(r.namn, [r])
  }
  let syntetiserade = 0
  let räddadeRöster = 0
  for (const [namn, röster] of perNamn) {
    if (röster.length < MIN_RÖSTER_FÖR_SYNTES) continue
    const parti = röster[0].parti
    const bilagaTokens = norm(namn).split(' ')
    // Bilagan kan stava ett existerande namn längre ("Eva Ann-Mari
    // Ternegren" för rostrets "Eva Ternegren") — om alla tokens i en
    // befintlig posts fulla namn ryms i bilaga-namnet, återanvänd dess id
    // i stället för att syntetisera en dubblett.
    const träff = polData.politiker.find(
      (p: { förnamn: string; efternamn: string; parti: string }) =>
        p.parti === parti &&
        norm(`${p.förnamn} ${p.efternamn}`)
          .split(' ')
          .every((t) => bilagaTokens.includes(t)),
    )
    const id = träff ? träff.id : syntetisktId(namn)
    if (!träff && !polData.politiker.some((p: { id: string }) => p.id === id)) {
      const delar = namn.split(/\s+/)
      polData.politiker.push({
        id,
        förnamn: delar[0],
        efternamn: delar.slice(1).join(' '),
        parti: röster[0].parti,
        email: null,
        uppdrag: [],
        mandatperioder: [{ period: '2022-2026', roll: 'förtroendevald', källa: 'voteringsbilaga' }],
        närstående: null,
        historisk: true,
      })
      syntetiserade++
    }
    for (const r of röster) {
      omatchadeNamn.set(namn, (omatchadeNamn.get(namn) || 0) - 1)
      räddadeRöster++
      newEdges.push({
        from: `politiker-${id}`,
        to: r.paragrafId,
        typ: `röstade_${r.röst}`,
        data: { mandatperiod: '2022-2026', datum: r.datum, bilagaÄrende: r.ärende },
      })
    }
  }
  if (syntetiserade > 0 || räddadeRöster > 0) {
    polData.antal = polData.politiker.length
    writeFileSync(join(DATA_DIR, 'politiker/goteborg.json'), JSON.stringify(polData, null, 2))
    console.log(
      `\n   🏛  ${syntetiserade} historiska personer syntetiserade ur voteringsbilagor (${räddadeRöster} röster räddade) → rostret: ${polData.antal}`,
    )
  }

  console.log(`\n📊 ${totalVoteringar} bilagor, ${totalHuvud} huvudvoteringar`)
  console.log(`   ${newEdges.length} röstade-edges genererade`)
  if (omatchadeParagrafer > 0) console.log(`   ⚠️ ${omatchadeParagrafer} voteringar utan §-träff`)
  const kvarOmatchade = [...omatchadeNamn.entries()].filter(([, antal]) => antal > 0)
  if (kvarOmatchade.length > 0) {
    console.log(`   ⚠️ omatchade namn (${kvarOmatchade.length}):`)
    for (const [namn, antal] of kvarOmatchade.sort((a, b) => b[1] - a[1]).slice(0, 10)) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
