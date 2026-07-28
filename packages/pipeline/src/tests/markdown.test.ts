import { renderaMarkdown } from '@daf/shared'
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
