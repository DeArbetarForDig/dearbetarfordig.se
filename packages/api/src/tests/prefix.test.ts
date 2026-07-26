/**
 * Prefixtröskeln i fritextsökningen (routes/sok.ts).
 *
 * Regeln — prefixmatcha bara ord vars *stam* är minst fem tecken och som ger
 * ett enda lexem — går inte att mäta via HTTP: totalerna mättas av kapet per
 * träfftyp. Här testas den direkt mot samma Postgres-konfiguration som
 * indexen använder.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { sql } from '../lib/db.js'
import { prefixbaraOrd } from '../routes/sok.js'

afterAll(async () => {
  await sql.end()
})

describe('Prefixmatchning: vilka ord som får :*', () => {
  it('Långa stammar prefixas, korta inte', async () => {
    const ord = ['bojkott', 'upphandling', 'israel', 'varor', 'jäv', 'bil', 'stad']
    const prefix = await prefixbaraOrd(ord)
    // bojkott → 'bojkot' (6), upphandling → 'upphandling', israel → 'israel'
    expect([...prefix].sort()).toEqual(['bojkott', 'israel', 'upphandling'])
    // varor → 'var' (3) matchar annars vara/varandra, bil → 'bil' matchar
    // bilaga/bilagor (845 anföranden i stället för 20), jäv → 'jäv' (3)
    for (const kort of ['varor', 'jäv', 'bil', 'stad']) {
      expect(prefix.has(kort), kort).toBe(false)
    }
  })

  it('Ord som ger flera lexem prefixas inte (datum)', async () => {
    // "2024-06-13" blir '2024' & '-06' & '-13'; :* hade hamnat på det sista,
    // korta lexemet och matchat allt som börjar med "-13".
    const prefix = await prefixbaraOrd(['2024-06-13', 'SLK-2024-00604'])
    expect(prefix.size).toBe(0)
  })

  it('Stoppord prefixas inte (tom tsquery)', async () => {
    const prefix = await prefixbaraOrd(['och', 'eller', 'varit'])
    expect(prefix.size).toBe(0)
  })
})
