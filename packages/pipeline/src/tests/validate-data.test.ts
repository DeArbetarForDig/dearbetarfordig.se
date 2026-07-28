/**
 * Blockande CI-validering av datafilerna (docs/ANALYS-2026-07.md, punkt 4).
 *
 * Veckoautomationen skriver om data/ utan människa i loopen — scraper- eller
 * parserdrift får inte tyst kunna committa trasiga filer. Schemana bor i
 * @daf/shared (RosterSchema, GrafFilSchema) och beskriver de FAKTISKA
 * formaten på disk.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AiAnalysSchema, GrafFilSchema, RosterSchema } from '@daf/shared'
import { describe, expect, it } from 'vitest'

const DATA_DIR = join(import.meta.dirname, '../../../../data')

describe('data/politiker/goteborg.json', () => {
  const roster = JSON.parse(readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'))

  it('följer RosterSchema', () => {
    const res = RosterSchema.safeParse(roster)
    if (!res.success) {
      const first = res.error.issues.slice(0, 5)
      expect.fail(`${res.error.issues.length} schemafel, första: ${JSON.stringify(first, null, 2)}`)
    }
  })

  it('antal stämmer med listan och ids är unika', () => {
    expect(roster.antal).toBe(roster.politiker.length)
    const ids = new Set(roster.politiker.map((p: { id: string }) => p.id))
    expect(ids.size).toBe(roster.politiker.length)
  })

  it('rostret har inte krympt under rimlig nivå', () => {
    // 734 aktuella + historiska; en scrape-körning som tappar en stor del av
    // rostret (sajtomläggning, trasig discovery) ska fastna här — inte i main.
    expect(roster.politiker.length).toBeGreaterThan(700)
  })
})

describe('data/graf/*.json', () => {
  const grafDir = join(DATA_DIR, 'graf')
  const files = readdirSync(grafDir).filter((f) => f.endsWith('.json'))

  it('finns i förväntad mängd', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('varje fil följer GrafFilSchema', () => {
    for (const f of files) {
      const graf = JSON.parse(readFileSync(join(grafDir, f), 'utf-8'))
      const res = GrafFilSchema.safeParse(graf)
      if (!res.success) {
        expect.fail(`${f}: ${JSON.stringify(res.error.issues.slice(0, 3), null, 2)}`)
      }
    }
  })

  it('kf-filer har unika §-noder (dubbletter lät en justering-stub skriva över riktiga §§)', () => {
    for (const f of files.filter((f) => f.match(/^kf-\d{4}-\d{2}-\d{2}\.json$/))) {
      const graf = JSON.parse(readFileSync(join(grafDir, f), 'utf-8'))
      const ids = graf.nodes
        .filter((n: { typ: string }) => n.typ === 'paragraf')
        .map((n: { id: string }) => n.id)
      expect(new Set(ids).size, `${f} har dubbla §-noder`).toBe(ids.length)
    }
  })

  it('röstade-edges i politiker-komplett pekar från politiker och håller volymen', () => {
    const pk = JSON.parse(readFileSync(join(grafDir, 'politiker-komplett.json'), 'utf-8'))
    const röstade = pk.edges.filter((e: { typ: string }) => e.typ.startsWith('röstade_'))
    // 27,5k KF-röster efter punkt 18/19 — ett tapp under golvet betyder att en
    // regenerering gått snett trots parse-voteringars egen 90%-spärr.
    expect(röstade.length).toBeGreaterThan(25000)
    for (const e of röstade) {
      if (!e.from.startsWith('politiker-')) {
        expect.fail(`röstade-edge med icke-politiker-källa: ${JSON.stringify(e)}`)
      }
    }
  })
})

describe('data/analys/ai/*.json', () => {
  // AI-analyserna skrivs av en subagent, inte av en parser — desto viktigare
  // att formen valideras innan de seedas till produktion.
  const dir = join(DATA_DIR, 'analys/ai')
  const filer = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []

  it.each(filer)('%s följer AiAnalysSchema', (fil) => {
    const analys = JSON.parse(readFileSync(join(dir, fil), 'utf-8'))
    const res = AiAnalysSchema.safeParse(analys)
    if (!res.success) expect.fail(JSON.stringify(res.error.issues.slice(0, 5), null, 2))
    expect(res.data?.ärendeNr).toBe(fil.replace(/\.json$/, ''))
  })

  it('varje analys hör ihop med ett känt ärende', () => {
    if (!filer.length) return
    const { ärenden } = JSON.parse(readFileSync(join(DATA_DIR, 'analys/beslut.json'), 'utf-8'))
    const kända = new Map(
      ärenden.map((ä: { ärendeNr: string; källa_hash: string }) => [ä.ärendeNr, ä.källa_hash]),
    )
    for (const fil of filer) {
      const nr = fil.replace(/\.json$/, '')
      expect(kända.has(nr), `${nr} finns inte i data/analys/beslut.json`).toBe(true)
    }
  })
})
