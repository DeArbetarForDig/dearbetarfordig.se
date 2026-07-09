/**
 * Berikar data/graf/leverantorsutfall-namnder.json: söker igenom fulltexten
 * i alla KF/KS-paragrafer efter varje topp-leverantörs namn. Detta är en
 * FYND-mekanism ("nämns leverantören i något beslut?"), INTE en orsaks-länk
 * ("detta beslut orsakade den här betalningen") — de allra flesta
 * leverantörsfakturor är rutinköp under redan gällande ramavtal, utan ett
 * enskilt beslut per betalning. Ett träffat beslut kan lika gärna vara en
 * ospecifik omnämning (t.ex. leverantören listad i en interpellation) som
 * det faktiska upphandlingsbeslutet — läsaren avgör relevansen själv, se
 * utdraget.
 *
 * Körs efter leverantorsfakturor-namnd.ts (läser dess output, skriver
 * tillbaka till samma fil — laddar inte om några CSV:er).
 *
 * Användning: npx tsx packages/pipeline/src/scrapers/leverantorer-i-beslut.ts
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const GRAF_DIR = join(DATA_DIR, 'graf')
const OUTPUT_PATH = join(GRAF_DIR, 'leverantorsutfall-namnder.json')

// Samma normalisering som normalizeBolagNamn i leverantorsfakturor.ts /
// merge-organisations.ts — strippar bolagsform så "SKANSKA SVERIGE AB" blir
// en sökbar kärna utan att raka bindestreck/gemener/versaler stör matchen.
function coreName(namn: string): string {
  return namn
    .toLowerCase()
    .replace(/\(publ\)/g, '')
    .replace(/\b(aktiebolag|ekonomisk förening|ideell förening)\b/g, '')
    .replace(/\bab\b\.?/g, '')
    .replace(/\(fb\)/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Bolag vars kärnnamn (efter att bolagsformen strippats bort) råkar
// sammanfalla med ett vanligt svenskt ord — inget generellt filter fångar
// detta tillförlitligt (kort och distinkt är svårt att skilja algoritmiskt
// utan en ordlista), så kända fall listas explicit när de upptäcks. "Rubrik
// AB" gav två träffar som bara var administrativ boilerplate ("…anmälda
// under denna rubrik…"), inte ett omnämnande av bolaget.
const GENERISKA_ORD_KÄRNNAMN = new Set(['rubrik'])

interface BeslutRef {
  id: string
  label: string
  datum: string
  organ: string
  fulltext: string
}

function loadAllaBeslut(): BeslutRef[] {
  const beslut: BeslutRef[] = []
  for (const file of readdirSync(GRAF_DIR)) {
    if (!/^k[sf]-\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue
    const data = JSON.parse(readFileSync(join(GRAF_DIR, file), 'utf-8'))
    for (const n of data.nodes || []) {
      if (n.typ !== 'paragraf' || !n.data?.fulltext) continue
      beslut.push({
        id: n.id,
        label: n.label,
        datum: n.data.datum,
        organ: n.data.organ || (n.id.startsWith('kf-') ? 'Kommunfullmäktige' : 'Kommunstyrelsen'),
        fulltext: n.data.fulltext,
      })
    }
  }
  return beslut
}

function utdrag(fulltext: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 60)
  const end = Math.min(fulltext.length, matchIndex + 100)
  return `${start > 0 ? '…' : ''}${fulltext.slice(start, end).replace(/\s+/g, ' ').trim()}…`
}

function findOmnämnanden(
  supplierName: string,
  allaBeslut: BeslutRef[],
): Array<{ beslutId: string; label: string; datum: string; organ: string; utdrag: string }> {
  const core = coreName(supplierName)
  // Korta/generiska kärnnamn (t.ex. efter att ha strippat bolagsform till
  // nästan inget) ger för mycket brus för att vara en meningsfull sökterm.
  if (core.length < 5 || GENERISKA_ORD_KÄRNNAMN.has(core)) return []
  const isWordChar = (ch: string | undefined) => !!ch && /[a-zåäö]/i.test(ch)
  const matches: Array<{
    beslutId: string
    label: string
    datum: string
    organ: string
    utdrag: string
  }> = []
  for (const b of allaBeslut) {
    const haystack = b.fulltext.toLowerCase()
    let from = 0
    // En träff per beslut (det första ordgräns-giltiga fyndet) — inte en
    // per förekomst, frågan är "nämns leverantören i det här beslutet?".
    while (from <= haystack.length) {
      const idx = haystack.indexOf(core, from)
      if (idx === -1) break
      // Ordgräns i båda ändar av HELA träffen — annars matchar t.ex. "ra
      // bygg" (kärnan av leverantören "RA BYGG") mitt i "konvertera
      // byggnadens" (ordgränsen mellan "konvertera" och "byggnadens" ligger
      // inuti träffen, inte i dess kanter — en riktig sammanträffning, inte
      // ett omnämnande).
      if (isWordChar(haystack[idx - 1]) || isWordChar(haystack[idx + core.length])) {
        from = idx + 1
        continue
      }
      matches.push({
        beslutId: b.id,
        label: b.label,
        datum: b.datum,
        organ: b.organ,
        utdrag: utdrag(b.fulltext, idx),
      })
      break
    }
  }
  return matches
}

async function main() {
  console.log('🔎 Leverantörer omnämnda i KF/KS-beslut\n')

  const graf = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as {
    nodes: Array<{ id: string; typ: string; data: any }>
    edges: unknown[]
  }
  const allaBeslut = loadAllaBeslut()
  console.log(`   ${allaBeslut.length} paragrafer att söka i`)

  // Global cache: samma leverantör kan förekomma i flera nämnders topplistor
  // — sök en gång per unikt namn, inte en gång per förekomst.
  const cache = new Map<
    string,
    Array<{ beslutId: string; label: string; datum: string; organ: string; utdrag: string }>
  >()
  let checked = 0
  let withMatches = 0

  for (const node of graf.nodes) {
    if (node.typ !== 'leverantörsutfall') continue
    for (const l of node.data.topLeverantörer || []) {
      if (!cache.has(l.namn)) {
        cache.set(l.namn, findOmnämnanden(l.namn, allaBeslut))
        checked++
      }
      const omnämnanden = cache.get(l.namn)!
      if (omnämnanden.length > 0) {
        l.omnämndIBeslut = omnämnanden
        withMatches++
      }
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(graf, null, 2))
  console.log(
    `\n✅ ${OUTPUT_PATH} — ${checked} unika leverantörer sökta, ${withMatches} förekomster med minst en träff`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { coreName, findOmnämnanden, loadAllaBeslut }
