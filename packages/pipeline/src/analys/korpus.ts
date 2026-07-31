/**
 * Uppslagsverk över hela materialet — verktyget analytiker-subagenten arbetar
 * med (se .claude/agents/beslutsanalytiker.md).
 *
 * Subagenten får inte materialet serverat i sin prompt; den söker själv, precis
 * som en granskande journalist skulle. Det är poängen: en fråga om en detaljplan
 * leder till andra källor än en fråga om en klimatbudget, och den kopplingen går
 * inte att skriva i kod i förväg.
 *
 * Kör:
 *   npx tsx .../korpus.ts sok "klimatbudget utsläpp" [--typ=paragraf] [--limit=8]
 *   npx tsx .../korpus.ts hamta kf-2026-06-11-§237
 *   npx tsx .../korpus.ts arende SLK-2025-00122
 *   npx tsx .../korpus.ts ko [antal]     # ärenden som väntar på analys
 *
 * Indexet byggs om vid varje anrop (~1,2 s för 46 700 poster). Ingen cache:
 * en stale cache mot färska protokoll är en dyrare bugg än sekunden kostar.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA = join(import.meta.dirname, '../../../../data')

interface Post {
  id: string
  typ: string
  label: string
  text: string
  ärendeNr?: string
  datum?: string
}

/** Hela materialet som ett sökbart index. ~40 MB JSON, 2 s att bygga. */
export function byggKorpus(dataDir = DATA): { poster: Post[]; kanter: Map<string, string[]> } {
  const poster: Post[] = []
  const kanter = new Map<string, string[]>()
  const lägg = (från: string, rad: string) => {
    const fanns = kanter.get(från)
    if (fanns) fanns.push(rad)
    else kanter.set(från, [rad])
  }

  for (const fil of readdirSync(join(dataDir, 'graf')).filter((f) => f.endsWith('.json'))) {
    const graf = JSON.parse(readFileSync(join(dataDir, 'graf', fil), 'utf-8'))
    for (const nod of graf.nodes ?? []) {
      const d = nod.data ?? {}
      poster.push({
        id: nod.id,
        typ: nod.typ,
        label: nod.label ?? nod.id,
        // Belopp och nyckeltal ligger i data-fältet, inte i fulltexten — ta med
        // hela objektet så att en sökning på "kommunbidrag" träffar budgetnoder.
        text: [d.fulltext, d.handlingText, JSON.stringify(d)].filter(Boolean).join('\n'),
        ärendeNr: d.ärendeNr ? String(d.ärendeNr) : undefined,
        datum: d.datum,
      })
    }
    for (const e of graf.edges ?? []) {
      lägg(e.from, `${e.typ} → ${e.to}${e.label ? ` (${e.label})` : ''}`)
      lägg(e.to, `${e.typ} ← ${e.from}`)
    }
  }

  // Anförandenas ordagranna text ligger i data/debatter/, inte i grafen.
  for (const fil of readdirSync(join(dataDir, 'debatter')).filter((f) => /^k[fs]-\d/.test(f))) {
    const möte = JSON.parse(readFileSync(join(dataDir, 'debatter', fil), 'utf-8'))
    for (const [i, a] of (möte.anföranden ?? []).entries()) {
      poster.push({
        id: `anforande-${möte.datum}-${i}`,
        typ: 'anförande',
        label: `${a.talare ?? 'okänd'}${a.parti ? ` (${a.parti})` : ''} — ${a.ärende ?? ''}`,
        text: a.text ?? '',
        datum: möte.datum,
      })
    }
  }

  for (const d of JSON.parse(readFileSync(join(dataDir, 'dokument/index.json'), 'utf-8'))) {
    poster.push({
      id: d.id,
      typ: `dokument/${d.typ}`,
      label: d.titel,
      text: readFileSync(join(dataDir, 'dokument', d.fil), 'utf-8'),
      datum: d.datum,
    })
  }

  return { poster, kanter }
}

/** Alla ord måste finnas; rankas på antal träffar. Trubbigt men förutsägbart. */
export function sök(poster: Post[], q: string, typ?: string, limit = 12) {
  const ord = q.toLowerCase().split(/\s+/).filter(Boolean)
  const träffar: { post: Post; poäng: number }[] = []
  for (const post of poster) {
    if (typ && !post.typ.startsWith(typ)) continue
    const hö = `${post.label}\n${post.text}`.toLowerCase()
    let poäng = 0
    for (const o of ord) {
      const n = hö.split(o).length - 1
      if (n === 0) {
        poäng = 0
        break
      }
      poäng += n
    }
    if (poäng > 0) träffar.push({ post, poäng })
  }
  return träffar
    .sort((a, b) => b.poäng - a.poäng)
    .slice(0, limit)
    .map(({ post, poäng }) => {
      const i = post.text.toLowerCase().indexOf(ord[0])
      return {
        id: post.id,
        typ: post.typ,
        label: post.label,
        datum: post.datum,
        ärendeNr: post.ärendeNr,
        träffar: poäng,
        utdrag:
          i < 0
            ? post.text.slice(0, 300)
            : `…${post.text.slice(Math.max(0, i - 150), i + 350).replace(/\s+/g, ' ')}…`,
      }
    })
}

/** Ärenden som väntar på AI-analys: prognosvärda, utan färdig fil. */
export function kö(dataDir = DATA, antal = 20) {
  const analyser = JSON.parse(readFileSync(join(dataDir, 'analys/beslut.json'), 'utf-8'))
  const klara = new Set(
    existsSync(join(dataDir, 'analys/ai'))
      ? readdirSync(join(dataDir, 'analys/ai')).map((f) => f.replace(/\.json$/, ''))
      : [],
  )
  return analyser.ärenden
    .filter(
      (ä: { prognos_kandidat?: { värd: boolean }; ärendeNr: string }) =>
        ä.prognos_kandidat?.värd && !klara.has(ä.ärendeNr),
    )
    .map((ä: { ärendeNr: string; rubrik: string; prognos_kandidat: { skäl: string } }) => ({
      ärendeNr: ä.ärendeNr,
      rubrik: ä.rubrik,
      skäl: ä.prognos_kandidat.skäl,
    }))
    .slice(0, antal)
}

/**
 * Arbetsloggen — vad som är analyserat och vad som återstår, i klartext och i
 * git-historiken. Härledd ur filerna på disk, aldrig handredigerad: det finns
 * bara en sanning om vad som är gjort, och det är vilka filer som existerar.
 *
 * Analyserna körs ett ärende i taget. En avbruten körning ska kosta ett ärende,
 * inte en hel batch, och nästa session ska kunna läsa loggen och fortsätta.
 */
export function arbetslogg(dataDir = DATA) {
  const { ärenden } = JSON.parse(readFileSync(join(dataDir, 'analys/beslut.json'), 'utf-8'))
  const aiDir = join(dataDir, 'analys/ai')
  const klara = (existsSync(aiDir) ? readdirSync(aiDir) : [])
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(aiDir, f), 'utf-8')))
    .sort((a, b) => String(b.genererad).localeCompare(String(a.genererad)))
  const kvar = kö(dataDir, 10)
  const totalt = ärenden.filter(
    (ä: { prognos_kandidat?: { värd: boolean } }) => ä.prognos_kandidat?.värd,
  ).length

  const rad = (c: unknown[]) => `| ${c.join(' | ')} |`
  return [
    '# Arbetslogg — AI-analyser',
    '',
    '<!-- Genererad av `korpus.ts logg`. Redigera inte för hand: statusen ÄR',
    '     filerna i data/analys/ai/. Kör om kommandot efter varje analys. -->',
    '',
    `Uppdaterad ${new Date().toISOString().slice(0, 10)}. ` +
      `**${klara.length} av ${totalt}** prognosvärda ärenden analyserade, ${totalt - klara.length} återstår.`,
    '',
    'Ett ärende i taget — en avbruten körning ska kosta ett ärende, inte en batch:',
    '',
    '```bash',
    'npx tsx packages/pipeline/src/analys/korpus.ts ko 1   # nästa ärende',
    '# kör subagenten beslutsanalytiker på det ärendenumret, sedan:',
    'npx tsx packages/pipeline/src/analys/korpus.ts logg   # uppdatera den här filen',
    '```',
    '',
    '## Klara',
    '',
    rad(['Ärende', 'Datum', 'Riktning', 'Säkerhet', 'Granskad', 'Rubrik']),
    rad(['---', '---', '---', '---', '---', '---']),
    ...klara.map((a) =>
      rad([
        a.ärendeNr,
        a.genererad,
        a.riktning,
        a.confidence,
        a.granskad_av ?? '—',
        String(a.rubrik).slice(0, 70),
      ]),
    ),
    '',
    '## Näst på tur',
    '',
    rad(['Ärende', 'Skäl att analysera', 'Rubrik']),
    rad(['---', '---', '---']),
    ...kvar.map((ä: { ärendeNr: string; skäl: string; rubrik: string }) =>
      rad([ä.ärendeNr, ä.skäl, ä.rubrik.slice(0, 70)]),
    ),
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kommando, arg] = process.argv.slice(2)
  const flagga = (namn: string) =>
    process.argv.find((a) => a.startsWith(`--${namn}=`))?.split('=')[1]
  const ut = (v: unknown) => console.log(JSON.stringify(v, null, 1))

  if (kommando === 'logg') {
    const fil = join(DATA, 'analys/ARBETSLOGG.md')
    writeFileSync(fil, arbetslogg())
    console.error(`✓ ${fil}`)
  } else if (kommando === 'ko') {
    ut(kö(DATA, Number(arg) || 20))
  } else if (kommando === 'sok') {
    const { poster } = byggKorpus()
    ut(sök(poster, arg ?? '', flagga('typ'), Number(flagga('limit')) || 12))
  } else if (kommando === 'hamta') {
    const { poster, kanter } = byggKorpus()
    const post = poster.find((p) => p.id === arg)
    if (!post) {
      console.error(`Ingen post med id ${arg}`)
      process.exit(1)
    }
    ut({ ...post, kopplingar: kanter.get(post.id) ?? [] })
  } else if (kommando === 'arende') {
    const { poster } = byggKorpus()
    const analyser = JSON.parse(readFileSync(join(DATA, 'analys/beslut.json'), 'utf-8'))
    const analys = analyser.ärenden.find((ä: { ärendeNr: string }) => ä.ärendeNr === arg)
    const paragrafer = poster
      .filter((p) => p.ärendeNr === arg && p.typ === 'paragraf')
      .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))
    if (!analys && !paragrafer.length) {
      console.error(`Inget ärende ${arg}`)
      process.exit(1)
    }
    ut({ deterministisk_analys: analys, paragrafer })
  } else {
    console.error(
      'Kommandon: sok <ord> [--typ= --limit=] | hamta <id> | arende <nr> | ko [antal] | logg',
    )
    process.exit(1)
  }
}
