import { describe, expect, it } from 'vitest'
import { parseMöten } from '../scrapers/moten-molndal'

// Utdrag ur molndal.se:s mötestabell: länkade datum (handlingar finns),
// dubbelkodat &amp;amp; i äldre rader, ett planerat möte i klartext.
const HTML = `
<td><a title="KF 17/9" href="https://webbdiarium.molndal.se/#!/search/?t=1&amp;i=Kommunfullm%C3%A4ktige&amp;d=2026-09-17%2000:00:00&amp;n=KS"><strong>17</strong></a></td>
<td><p class="normal">15</p></td>
<td><a href="https://webbdiarium.molndal.se/#!/search/?t=1&amp;amp;i=Kommunstyrelsen&amp;amp;d=2025-10-22%2000:00:00&amp;amp;n=KS">22</a></td>
<td><a href="https://webbdiarium.molndal.se/#!/search/?t=1&amp;i=Kommunfullm%C3%A4ktige&amp;d=2026-09-17%2000:00:00&amp;n=KS">17</a></td>
`

describe('parseMöten', () => {
  it('plockar länkade möten, avkodar organ, dedupar och sorterar nyast först', () => {
    expect(parseMöten(HTML)).toEqual([
      {
        organ: 'Kommunfullmäktige',
        datum: '2026-09-17',
        url: 'https://webbdiarium.molndal.se/#!/search/?t=1&i=Kommunfullm%C3%A4ktige&d=2026-09-17%2000:00:00&n=KS',
      },
      {
        organ: 'Kommunstyrelsen',
        datum: '2025-10-22',
        url: 'https://webbdiarium.molndal.se/#!/search/?t=1&i=Kommunstyrelsen&d=2025-10-22%2000:00:00&n=KS',
      },
    ])
  })
})
