import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { byggKorpus, sök } from '../korpus.js'

/** Minimalt data/-träd med en nod av varje sort agenten måste kunna nå. */
function fixtur() {
  const dir = mkdtempSync(join(tmpdir(), 'korpus-'))
  for (const d of ['graf', 'debatter', 'dokument']) mkdirSync(join(dir, d))
  writeFileSync(
    join(dir, 'graf/kf-2025-01-01.json'),
    JSON.stringify({
      nodes: [
        {
          id: 'kf-2025-01-01-§1',
          typ: 'paragraf',
          label: '§ 1 Ny simhall',
          data: { ärendeNr: 'SLK-2025-1', datum: '2025-01-01', fulltext: 'Simhallen byggs.' },
        },
        {
          id: 'nämnd-kulturnämnden-2026',
          typ: 'organisation',
          label: 'Kulturnämnden',
          data: { kommunbidragMnkr: 1234 },
        },
      ],
      edges: [{ from: 'kf-2025-01-01-§1', to: 'org-kulturnämnden', typ: 'uppdrag_till' }],
    }),
  )
  writeFileSync(
    join(dir, 'debatter/kf-2025-01-01.json'),
    JSON.stringify({
      datum: '2025-01-01',
      anföranden: [{ talare: 'A B', parti: 'C', ärende: '1', text: 'Simhallen blir för dyr.' }],
    }),
  )
  writeFileSync(
    join(dir, 'dokument/index.json'),
    JSON.stringify([{ id: 'doc-1', titel: 'Årsrapport', typ: 'årsrapport', fil: 'doc.txt' }]),
  )
  writeFileSync(join(dir, 'dokument/doc.txt'), 'Simhallen kostade 90 mnkr.')
  return dir
}

describe('byggKorpus', () => {
  it('samlar protokoll, anföranden och inkomna dokument i ett index', () => {
    const { poster, kanter } = byggKorpus(fixtur())
    expect(poster.map((p) => p.typ).sort()).toEqual([
      'anförande',
      'dokument/årsrapport',
      'organisation',
      'paragraf',
    ])
    // Kanter går åt båda håll, annars kan agenten bara traversera framåt.
    expect(kanter.get('kf-2025-01-01-§1')).toEqual(['uppdrag_till → org-kulturnämnden'])
    expect(kanter.get('org-kulturnämnden')).toEqual(['uppdrag_till ← kf-2025-01-01-§1'])
  })

  it('gör siffror i data-fältet sökbara — de finns inte i någon fulltext', () => {
    const { poster } = byggKorpus(fixtur())
    expect(sök(poster, 'kommunbidragMnkr')[0].id).toBe('nämnd-kulturnämnden-2026')
  })
})

describe('sök', () => {
  const { poster } = byggKorpus(fixtur())

  it('kräver att alla ord förekommer', () => {
    expect(sök(poster, 'simhallen dyr').map((t) => t.typ)).toEqual(['anförande'])
    expect(sök(poster, 'simhallen enhörning')).toEqual([])
  })

  it('hittar över alla källtyper och kan begränsas till en', () => {
    expect(sök(poster, 'simhallen').length).toBe(3)
    expect(sök(poster, 'simhallen', 'dokument').map((t) => t.id)).toEqual(['doc-1'])
  })

  it('ger utdrag runt träffen, inte bara filens början', () => {
    expect(sök(poster, 'kostade')[0].utdrag).toContain('90 mnkr')
  })
})
