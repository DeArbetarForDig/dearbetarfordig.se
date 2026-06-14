/**
 * @daf/ui — Politician Card
 *
 * Compact card shown on hover in the chamber view.
 * Also usable standalone in lists.
 */

import type { PartyCode } from '../../tokens/index.ts'

export interface PoliticianCardConfig {
  id: string
  namn: string
  parti: PartyCode
  foto?: string
  roll: string
  närvaro?: number
  url: string
}

export function generatePoliticianCardHTML(config: PoliticianCardConfig): string {
  const { namn, parti, foto, roll, närvaro, url } = config

  return `<article class="daf-politician-card" data-party="${parti}">
  ${foto ? `<img src="${foto}" alt="${namn}" class="daf-politician-card__photo" loading="lazy" width="64" height="64" />` : '<div class="daf-politician-card__photo-placeholder"></div>'}
  <div class="daf-politician-card__info">
    <h3 class="daf-politician-card__name">${namn}</h3>
    <p class="daf-politician-card__party">${parti}</p>
    <p class="daf-politician-card__role">${roll}</p>
    ${närvaro != null ? `<p class="daf-politician-card__attendance">Närvaro: ${närvaro}%</p>` : ''}
    <a href="${url}" class="daf-politician-card__link">Visa profil →</a>
  </div>
</article>`
}
