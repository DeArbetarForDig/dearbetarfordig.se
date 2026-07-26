/**
 * Parser: Yttrandeprotokoll PDF → strukturerade anföranden
 *
 * Ersätter Whisper-transkriptioner med officiell text direkt från
 * yttrandeprotokoll PDF:er (100% korrekt text, gratis, omedelbart).
 *
 * Format i PDF:
 *   N. Ärendetitel
 *   Namn Efternamn (PARTI)
 *   Text text text...
 *   Namn2 Efternamn2 (PARTI2)
 *   Text text...
 *
 * Output: data/debatter/kf-{datum}.json (samma format som speakers-*.json)
 *
 * Användning:
 *   # Parsea ett specifikt möte
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts 2026-06-11
 *
 *   # Parsea alla möten (alla år)
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts --all
 *
 *   # Parsea specifikt år
 *   npx tsx packages/pipeline/src/parsers/parse-yttrandeprotokoll.ts --year 2025
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Typdef för grafsektionen
interface GrafParagraf {
  paragrafNr: string
  rubrik: string
}

interface Anförande {
  talare: string
  parti: string
  ärende: number | null
  ärendeTitel: string
  text: string
  ordning: number
}

interface Meeting {
  datum: string
  titel: string
  källa: string
  hämtad: string
  anföranden: Anförande[]
}

interface Politiker {
  id: string
  förnamn: string
  efternamn: string
  parti: string
}

/**
 * Normalisera namn för matchning: ta bort diakritiska tecken, gemener, kollapsa whitespace
 */
export function normalizeForMatching(name: string): string {
  // Folda diakritiska tecken (ä→a, ö→o, å→a, etc.)
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Ta bort diakritiska kombinationstecken
    .toLowerCase()
    .replace(/\s+/g, ' ') // Kollapsa flera mellanslag till ett
    .trim()
  return normalized
}

/**
 * Normalisera titel för matchning mot § rubriker (samma som parse-anforanden-graf.ts).
 * Gemener, ta bort non-alphanumeriska tecken utom mellanslag, kollapsa whitespace.
 */
function normalizeTitleForMatching(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zåäö0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hämta alla § rubriker för ett specifikt möte från grafdatan.
 */
function getParagraferForDatum(datum: string): GrafParagraf[] {
  const ROOT = join(import.meta.dirname, '../../../..')
  const grafPath = join(ROOT, 'data/graf', `kf-${datum}.json`)

  if (!existsSync(grafPath)) {
    return []
  }

  try {
    const content = JSON.parse(readFileSync(grafPath, 'utf-8'))
    const grafs: GrafParagraf[] = []
    for (const node of content.nodes || []) {
      if (node.typ === 'paragraf' && node.data) {
        grafs.push({
          paragrafNr: String(node.data.paragrafNr || ''),
          rubrik: String(node.data.rubrik || ''),
        })
      }
    }
    return grafs
  } catch {
    return []
  }
}

/**
 * Kontrollera om en titel matchar någon känd § rubrik för mötet.
 * Använder samma matchningslogik som parse-anforanden-graf.ts.
 */
function titleMatchesKnownParagraf(titel: string, paragrafer: GrafParagraf[]): boolean {
  if (!titel || paragrafer.length === 0) return false

  const a = normalizeTitleForMatching(titel).replace(/ /g, '')

  for (const p of paragrafer) {
    const b = normalizeTitleForMatching(p.rubrik).replace(/ /g, '')
    if (!b) continue

    // Exakt matchning
    if (a === b) return true

    // Prefix matchning (minst 13 tecken) — samma som parse-anforanden-graf.ts
    const n = Math.min(a.length, b.length)
    if (n >= 13 && a.slice(0, n) === b.slice(0, n)) {
      return true
    }

    // Reverse prefix match (rubrik är prefix av titel)
    if (b.length >= 5 && a.startsWith(b)) return true

    // Contains match
    if (a.includes(b) || b.includes(a)) return true
  }

  return false
}

/**
 * Damerau-Levenshtein distance: antal editerings-operationer för att transformera s1 → s2
 * Simplified version: vi räknar insertion, deletion, substitution, transposition
 */
function damerauLevenshteinDistance(s1: string, s2: string): number {
  if (s1 === s2) return 0
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0) return len2
  if (len2 === 0) return len1

  // Skapa matris för DP
  const matrix: number[][] = []
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      )
      // Transposition check
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost)
      }
    }
  }

  return matrix[len1][len2]
}

/**
 * Filtrera bort initialer (enstaka bokstäver) från token-listan
 */
function filterInitials(tokens: string[]): string[] {
  return tokens.filter((t) => t.length > 1)
}

/**
 * Skapa en resolver-funktion som matchar talare mot politiker-registret
 */
export function createPolitikerResolver(
  politicians: Politiker[],
): (talare: string, parti: string) => string | null {
  return (talareRaw: string, partiRaw: string): string | null => {
    let talare = talareRaw.trim()
    const partiNorm = normalizeForMatching(partiRaw)

    // Ta bort trailing lowercase tokens (t.ex. "Claudia Nistor Pedrini först" → "Claudia Nistor Pedrini")
    const tokens = talare.split(/\s+/)
    while (tokens.length > 1 && tokens[tokens.length - 1].match(/^[a-zåäö]/)) {
      tokens.pop()
    }
    talare = tokens.join(' ').trim()

    if (!talare || talare === 'okänd') {
      return null
    }

    const normTalare = normalizeForMatching(talare)
    const talareTokensRaw = normTalare.split(/\s+/)
    const talareTokens = filterInitials(talareTokensRaw) // Ta bort initialer

    // Gruppera kandidater per politiker för att kunna detektera ambiguösa matches
    const byId = new Map<string, { parti: string; scores: number[] }>()

    // Försök att matcha mot alla politiker
    for (const pol of politicians) {
      const normFirstName = normalizeForMatching(pol.förnamn)
      const normLastName = normalizeForMatching(pol.efternamn)
      const normFull = `${normFirstName} ${normLastName}`.replace(/\s+/g, ' ').trim()
      const polTokensRaw = normFull.split(/\s+/)
      const polTokens = filterInitials(polTokensRaw) // Ta bort initialer

      const polParti = normalizeForMatching(pol.parti)
      const sameParti = partiNorm === polParti

      // Strategi 1: Exakt matchning (normaliserad)
      if (normTalare === normFull) {
        if (sameParti) {
          // Spara för ambiguity check
          const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
          entry.scores.push(100)
          byId.set(pol.id, entry)
        } else {
          // Spara för potential cross-party match senare
          const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
          entry.scores.push(100)
          byId.set(pol.id, entry)
        }
      }

      if (!sameParti) continue // Resten av strategierna kräver rätt parti

      // Strategi 2: Damerau-Levenshtein distance (full name)
      const fullNameDist = damerauLevenshteinDistance(normTalare, normFull)
      if (fullNameDist <= 1 && fullNameDist > 0) {
        const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
        entry.scores.push(50)
        byId.set(pol.id, entry)
      }

      // Strategi 3: First name typo + surname token match
      // Denna strategi hjälper "Emilia Bönfors" matcha "Emmilia Bönfors Jansson"
      if (talareTokens.length > 0 && polTokens.length > 0) {
        const firstToken = talareTokensRaw[0] || ''
        const registryFirstToken = polTokensRaw[0] || ''
        const firstNameDist = damerauLevenshteinDistance(firstToken, registryFirstToken)

        // Resten av tokens ska matcha som en delmängd
        const protocolSurnameTokens = talareTokens.slice(1)
        const registrySurnameTokens = polTokens.slice(1)

        // Kontrollera om surname tokens matchar (protocol subset of registry eller vice versa)
        let surnameTokensMatch = false
        if (protocolSurnameTokens.length === 0 || registrySurnameTokens.length === 0) {
          surnameTokensMatch = protocolSurnameTokens.length === registrySurnameTokens.length
        } else {
          // Check if protocol surname tokens are subset of registry
          if (protocolSurnameTokens.every((t) => registrySurnameTokens.includes(t))) {
            surnameTokensMatch = true
          }
          // Or registry surname tokens are subset of protocol
          if (registrySurnameTokens.every((t) => protocolSurnameTokens.includes(t))) {
            surnameTokensMatch = true
          }
        }

        if (firstNameDist <= 1 && surnameTokensMatch) {
          const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
          entry.scores.push(45)
          byId.set(pol.id, entry)
        }
      }

      // Strategi 4: Symmetrisk token-set matchning för sammansatta namn
      // Kontrollera om en token-set är en delmängd av den andra
      let isValidTokenMatch = false
      // Protokoll är delmängd av registry
      if (talareTokens.every((t) => polTokens.includes(t))) {
        isValidTokenMatch = true
      }
      // Eller registry är delmängd av protokoll
      if (polTokens.every((t) => talareTokens.includes(t))) {
        isValidTokenMatch = true
      }

      if (isValidTokenMatch && talareTokens.length > 0 && polTokens.length > 0) {
        const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
        entry.scores.push(30)
        byId.set(pol.id, entry)
      }

      // Strategi 5: Mellanslags- och bindestrecks-okänslig förnamnsmatching
      // Hanterar: "AnnaSara Perslow" (protokoll) vs "Anna Sara Hansson Perslow" (registry)
      // Metoden: ta bort mellanslag/bindestrecken från första namn, jämför, sen kontrollera efternamn-tokens
      if (talareTokens.length > 0 && polTokens.length > 0) {
        // Dela registry-namn i förnamn och efternamn
        const regFirstNameTokens = normalizeForMatching(pol.förnamn)
          .split(/\s+/)
          .filter((t) => t.length > 1)
        const regSurnameTokens = normalizeForMatching(pol.efternamn)
          .split(/\s+/)
          .filter((t) => t.length > 1)

        // Ta bort mellanslag/bindestrecken från förnamn
        const regFirstNameNoSpaces = regFirstNameTokens.join('').replace(/-/g, '')
        const protFirstNameNoSpaces = talareTokensRaw[0].replace(/-/g, '')

        // Kontrollera om förnamnen matchar (mellanslags/bindestrecks-okänslig)
        if (regFirstNameNoSpaces === protFirstNameNoSpaces && regFirstNameNoSpaces.length > 0) {
          // Kontrollera efternamn-tokens
          const protSurnameTokens = talareTokens.slice(1)

          let surnameTokensMatch = false
          if (protSurnameTokens.length === 0 && regSurnameTokens.length === 0) {
            surnameTokensMatch = true
          } else if (protSurnameTokens.length > 0 && regSurnameTokens.length > 0) {
            // Kontrollera om protokoll-efternamn är delmängd av registry
            if (protSurnameTokens.every((t) => regSurnameTokens.includes(t))) {
              surnameTokensMatch = true
            }
            // Eller registry är delmängd av protokoll
            if (regSurnameTokens.every((t) => protSurnameTokens.includes(t))) {
              surnameTokensMatch = true
            }
          }

          if (surnameTokensMatch) {
            const entry = byId.get(pol.id) || { parti: pol.parti, scores: [] }
            entry.scores.push(35) // mellan strategi 3 (45) och 4 (30)
            byId.set(pol.id, entry)
          }
        }
      }
    }

    // Filtrera efter parti och ta bästa score
    const samePartyMatches = Array.from(byId.entries())
      .filter(([, v]) => normalizeForMatching(v.parti) === partiNorm)
      .map(([id, v]) => ({
        id,
        parti: v.parti,
        bestScore: Math.max(...v.scores),
      }))

    // Sortera efter score
    samePartyMatches.sort((a, b) => b.bestScore - a.bestScore)

    // Returnera om det finns exakt en match
    if (samePartyMatches.length === 1) {
      return samePartyMatches[0].id
    }

    if (samePartyMatches.length > 1) {
      // Kontrollera om det är en ambiguös match (samma score på flera)
      if (samePartyMatches[0].bestScore === samePartyMatches[1].bestScore) {
        return null // Ambiguous within same party
      }
      // Annars, returnera den bästa
      return samePartyMatches[0].id
    }

    // Strategi 5: Cross-party acceptance om namn är unikt
    // Acceptera om det bara finns en exakt match över alla partier
    const allByScore = Array.from(byId.entries()).map(([id, v]) => ({
      id,
      parti: v.parti,
      bestScore: Math.max(...v.scores),
    }))
    allByScore.sort((a, b) => b.bestScore - a.bestScore)

    const exactMatches = allByScore.filter((m) => m.bestScore === 100)
    if (exactMatches.length === 1) {
      return exactMatches[0].id
    }

    return null
  }
}

/**
 * Extrahera anföranden från yttrandeprotokoll PDF-text
 *
 * Heuristiker för att undvika falska ärenderubriker:
 * 1. Monotonitet: ärendenummer kan aldrig minska. En rubrik med lägre
 *    nummer än nuvarande är ett falskt positiv från en numrerad lista i
 *    anförandet — behåll det nuvarande ärendet.
 * 2. Rubrikvaliditet för helt nytt ärende: Titeln måste börja med stor
 *    bokstav och inte innehålla satsslutpunktuation (= mening från tal).
 *    Denna kontroll är SVAG — den fångar bara uppenbar chat, inte alla
 *    falsktPositiva.
 * 3. Radförsättning: Om nästa rad är indenterad och inte själv en rubrik,
 *    är den en fortsättning av denna rubrik — slå ihop dem.
 * 4. Talare-strikthet: En talare-rad som "Ärende nummer två. Anmälan av..."
 *    är tal, inte ett namn. Validera att det är faktiska namn (2+ tokens,
 *    ingen satsslutpunktuation).
 */
export function parseYttrandeprotokoll(text: string, datum: string): Anförande[] {
  const anföranden: Anförande[] = []
  const lines = text.split('\n')
  const paragrafer = getParagraferForDatum(datum)

  // Pattern: "Namn Efternamn (PARTI)" — speaker line
  // Handles: "Ann Catrine Fogelgren (L)", "R. Mustafa Soyupak (MP)", "Aslan Akbas (S)"
  const speakerRe =
    /^([A-ZÅÄÖ][a-zA-ZåäöÅÄÖé\.\- ]+(?:\s+[A-ZÅÄÖ][a-zA-ZåäöÅÄÖé\.\- ]+)*)\s+\(([A-ZÅÄÖ\-]+)\)\s*$/

  // Pattern: "  N. Ärendetitel" or "N. Ärendetitel"
  const ärendeRe = /^\s*(\d+)\.\s+(.+)$/

  // Snabb validering av titel: måste börja med stor bokstav och inte sluta
  // med meningspunktuation (som "...från tal.") eller kolon (som "...nr två: något")
  function mightBeTitle(title: string): boolean {
    if (!title || title.length === 0) return false
    // Måste börja med stor bokstav (undvik "1. från tal om något")
    if (title[0] !== title[0].toUpperCase()) return false
    // Bör inte sluta med . ! ? : (mening/lista-marker)
    if (/[.!?:]$/.test(title)) return false
    return true
  }

  // Validera talare-namn: måste ha minst två ord och ingen satsslutpunktuation
  function isValidSpeaker(name: string): boolean {
    if (!name || name.length === 0) return false
    const tokens = name.trim().split(/\s+/)
    // Måste ha minst två tokens (för- och efternamn)
    if (tokens.length < 2) return false
    // Inga namn slutar med meningspunktuation
    if (/[.!?:]$/.test(name)) return false
    return true
  }

  let currentTalare = ''
  let currentParti = ''
  let currentÄrende: number | null = null
  let currentÄrendeTitel = ''
  let currentText: string[] = []
  let ordning = 0
  let lastValidÄrende: number | null = null

  function flush() {
    const text = currentText.join(' ').replace(/\s+/g, ' ').trim()
    if (currentTalare && text.length > 10) {
      anföranden.push({
        talare: currentTalare,
        parti: currentParti,
        ärende: currentÄrende,
        ärendeTitel: currentÄrendeTitel,
        text,
        ordning: ++ordning,
      })
    }
    currentText = []
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    // Skip page headers/footers
    if (
      line.startsWith('Kommunfullmäktige') ||
      line.startsWith('Göteborgs Stad Kommunfullmäktige') ||
      line.match(/^Yttrandeprotokoll \d{4}$/) ||
      line.match(/^\d+$/) || // page number
      line.match(/^Torsdagen|^Måndagen|^Tisdagen|^Onsdagen|^Fredagen/) ||
      line === ''
    ) {
      continue
    }

    // Ärende heading — med förbättrad monotonitetskontroll
    const ärendeMatch = line.match(ärendeRe)
    if (ärendeMatch && !speakerRe.test(line)) {
      const nr = Number.parseInt(ärendeMatch[1])
      let titel = ärendeMatch[2].trim()

      // MONOTONITETSKONTROLL: ärendenummer kan normalt aldrig minska.
      // UNDANTAG: Om titeln matchar en känd § rubrik för detta möte,
      // acceptera den trots bakåtgåendet. Detta hanterar legitimata fall där
      // mötesprotokollen listar agenda-items på nytt eller där numreringen
      // omstartar. Testresultat: ~69% av bakåtgåenden är äkta rubriker.
      let allowBackwards = false
      if (lastValidÄrende !== null && nr < lastValidÄrende) {
        // Kontrollera om denna titel matchar någon känd § rubrik
        if (titleMatchesKnownParagraf(titel, paragrafer)) {
          // Titeln matchar — acceptera trots bakåtgåendet
          allowBackwards = true
        } else {
          // Falskt positiv från numrerad lista i tal — behandla som talinnehål
          if (currentTalare && line.length > 0) {
            currentText.push(line)
          }
          continue
        }
      }

      // Valideringskontroller för helt ny rubrik
      if (nr >= 1 && nr <= 200 && mightBeTitle(titel)) {
        // Försök att slå ihop med nästa rad om den är en fortsättning
        // En indenterad nästa rad som inte själv är rubrik är en fortsättning
        if (i + 1 < lines.length) {
          const nextRaw = lines[i + 1]
          const nextLine = nextRaw.trim()

          // Om nästa rad börjar med whitespace och inte är en rubrik/talare,
          // är det en fortsättning av denna rubrik — slå ihop
          if (
            nextRaw.length > 0 &&
            nextRaw[0] === ' ' &&
            !nextLine.match(/^\d+\.\s+/) &&
            !speakerRe.test(nextLine)
          ) {
            titel = `${titel} ${nextLine}`
            lines[i + 1] = '' // Markera nästa rad som konsumerad
          }
        }

        currentÄrende = nr
        currentÄrendeTitel = titel
        // Uppdatera lastValidÄrende bara vid framåtgående nummer. Om vi accepterade
        // ett bakåtgående nummer (allowBackwards), uppdatera INTE lastValidÄrende.
        // Detta gör att senare ärenden fortfarande måste respektera det högsta
        // numret vi sett, så vi inte accepterar flera sekvenser av bakåtgånden.
        if (!allowBackwards && (lastValidÄrende === null || nr >= lastValidÄrende)) {
          lastValidÄrende = nr
        }
      } else if (currentTalare && line.length > 0) {
        // Inte en giltig rubrik — behandla som tal-innehål
        currentText.push(line)
      }
      continue
    }

    // Speaker line — med validering
    const speakerMatch = line.match(speakerRe)
    if (speakerMatch) {
      const name = speakerMatch[1].trim()
      // Validera att det är ett faktiskt namn, inte en mening
      if (isValidSpeaker(name)) {
        flush()
        currentTalare = name
        currentParti = speakerMatch[2].trim()
        continue
      }
    }

    // Text content
    if (currentTalare && line.length > 0) {
      currentText.push(line)
    }
  }

  flush()
  return anföranden
}

/**
 * Hämta alla yttrandeprotokoll URLs från handlingar JSON
 */
function getYttrandeUrls(years?: string[]): { datum: string; url: string }[] {
  const ROOT = join(import.meta.dirname, '../../../..')
  const DATA_DIR = join(ROOT, 'data')

  const result: { datum: string; url: string }[] = []
  const targetYears = years || ['2023', '2024', '2025', '2026']

  for (const year of targetYears) {
    const path = join(DATA_DIR, `beslut/kf-handlingar-${year}.json`)
    if (!existsSync(path)) continue
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    for (const s of data.sammanträden || []) {
      for (const h of s.handlingar || []) {
        if (h.titel?.includes('Yttrandeprotokoll')) {
          result.push({ datum: s.datum, url: h.url })
          break
        }
      }
    }
  }
  return result
}

async function parseMeeting(datum: string, url: string): Promise<Meeting | null> {
  const ROOT = join(import.meta.dirname, '../../../..')
  const TMP_DIR = join(ROOT, '.tmp', 'yttrande')

  const pdfPath = join(TMP_DIR, `yttrande-${datum}.pdf`)

  // Download if needed
  if (!existsSync(pdfPath)) {
    console.log(`  ⬇️  ${datum}...`)
    try {
      execSync(`curl -sL -H 'User-Agent: Mozilla/5.0' '${url}' -o '${pdfPath}'`, {
        timeout: 30_000,
      })
    } catch {
      console.error(`  ✗ Download failed: ${datum}`)
      return null
    }
  }

  // Extract text
  let text: string
  try {
    text = execSync(`pdftotext -layout '${pdfPath}' -`, {
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch {
    console.error(`  ✗ pdftotext failed: ${datum}`)
    return null
  }

  const anföranden = parseYttrandeprotokoll(text, datum)
  const parties = [...new Set(anföranden.map((a) => a.parti))]

  console.log(
    `  ✓ ${datum}: ${anföranden.length} anföranden, ${new Set(anföranden.map((a) => a.talare)).size} talare (${parties.join(', ')})`,
  )

  return {
    datum,
    titel: `Kommunfullmäktige ${datum}`,
    källa: url,
    hämtad: new Date().toISOString(),
    anföranden,
  }
}

async function main() {
  const ROOT = join(import.meta.dirname, '../../../..')
  const DATA_DIR = join(ROOT, 'data')
  const TMP_DIR = join(ROOT, '.tmp', 'yttrande')
  const OUTPUT_DIR = join(DATA_DIR, 'debatter')

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const args = process.argv.slice(2)
  const allFlag = args.includes('--all')
  const yearFlag = args.find((a) => a.startsWith('--year=') || a === '--year')
  const yearArg = yearFlag ? args[args.indexOf('--year') + 1] || yearFlag.split('=')[1] : null
  const datumArg = args.find((a) => a.match(/^\d{4}-\d{2}-\d{2}$/))

  let meetings: { datum: string; url: string }[]

  if (datumArg) {
    // Single date — find URL from handlingar
    const all = getYttrandeUrls()
    const match = all.find((m) => m.datum === datumArg)
    if (!match) {
      console.error(`✗ Inget yttrandeprotokoll för ${datumArg}`)
      process.exit(1)
    }
    meetings = [match]
  } else if (yearArg) {
    meetings = getYttrandeUrls([yearArg])
  } else if (allFlag) {
    meetings = getYttrandeUrls()
  } else {
    // Default: current year
    const year = new Date().getFullYear().toString()
    meetings = getYttrandeUrls([year])
  }

  console.log(`\n📝 Parsear ${meetings.length} yttrandeprotokoll...\n`)

  let ok = 0
  let totalAnföranden = 0

  for (const { datum, url } of meetings.sort((a, b) => a.datum.localeCompare(b.datum))) {
    const outPath = join(OUTPUT_DIR, `kf-${datum}.json`)
    const result = await parseMeeting(datum, url)
    if (result) {
      writeFileSync(outPath, JSON.stringify(result, null, 2))
      ok++
      totalAnföranden += result.anföranden.length
    }
  }

  console.log(`\n✅ ${ok}/${meetings.length} möten parserade, ${totalAnföranden} anföranden totalt`)
}

// main() skriver till data/debatter/ — utan den här vakten räcker det att
// importera modulen (t.ex. från ett test) för att skriva om produktionsdata.
// Samma mönster som parse-voteringar.ts:418 och parse-protokoll.ts:609.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
