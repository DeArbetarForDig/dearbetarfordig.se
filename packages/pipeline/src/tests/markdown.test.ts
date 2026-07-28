import { delaKorsreferens, renderaMarkdown } from '@daf/shared'
import { describe, expect, it } from 'vitest'

describe('renderaMarkdown', () => {
  it('gör rubriker, stycken och listor', () => {
    expect(renderaMarkdown('## Pengarna\n\nBeslutet kostar 45 mnkr.\n\n- ett\n- två')).toBe(
      '<h3>Pengarna</h3>\n<p>Beslutet kostar 45 mnkr.</p>\n<ul><li>ett</li><li>två</li></ul>',
    )
  })

  it('länkar nakna URL:er utan att svälja avslutande skiljetecken', () => {
    expect(renderaMarkdown('Se https://gu.se/x, sidan 4.')).toContain(
      '<a href="https://gu.se/x" target="_blank" rel="noopener noreferrer">https://gu.se/x</a>,',
    )
  })

  it('escapar markup — texten är modellgenererad och får inte kunna injicera HTML', () => {
    const ut = renderaMarkdown('<img src=x onerror=alert(1)> och **fetstil**')
    expect(ut).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(ut).not.toContain('<img')
    expect(ut).toContain('<strong>fetstil</strong>')
  })

  it('escapar även inuti länktext och kod', () => {
    expect(renderaMarkdown('`<b>` och https://x.se/<script>')).not.toMatch(/<b>|<script>/)
  })
})

describe('delaKorsreferens', () => {
  it('länkar ett paragraf-id till beslutssidan', () => {
    expect(delaKorsreferens('kf-2026-06-11-§237')).toEqual([
      { text: 'kf-2026-06-11-§237', href: '/goteborg/beslut/kf-2026-06-11-%C2%A7237' },
    ])
  })

  it('länkar båda id:n i en hänvisning som nämner flera', () => {
    const delar = delaKorsreferens('kf-2023-10-12-§17 och kf-2025-06-18-§382')
    expect(delar.filter((d) => d.href).map((d) => d.text)).toEqual([
      'kf-2023-10-12-§17',
      'kf-2025-06-18-§382',
    ])
    expect(delar.map((d) => d.text).join('')).toBe('kf-2023-10-12-§17 och kf-2025-06-18-§382')
  })

  it('lämnar text utan sida olänkad i stället för att peka på en 404', () => {
    expect(delaKorsreferens('utfall-nämnd-miljo-2022 t.o.m. -2025')).toEqual([
      { text: 'utfall-nämnd-miljo-2022 t.o.m. -2025', href: null },
    ])
    // Ärendenumret i parentesen har ingen egen sida; paragrafen bredvid har det.
    const blandat = delaKorsreferens('kf-2024-11-21-§462 (SLK-2024-00378)')
    expect(blandat.map((d) => d.href !== null)).toEqual([true, false])
  })
})
