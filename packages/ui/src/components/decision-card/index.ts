/**
 * @daf/ui — Decision Card
 *
 * Displays a single decision/beslut in a feed.
 */

export type BeslutStatus = 'bifall' | 'avslag' | 'remitterad' | 'bordlagd'

export interface DecisionCardConfig {
  id: string
  titel: string
  datum: string
  status: BeslutStatus
  paragraf?: string
  ja?: number
  nej?: number
  avstår?: number
  url: string
}

const statusMeta: Record<BeslutStatus, { icon: string; label: string }> = {
  bifall: { icon: '🟢', label: 'Bifall' },
  avslag: { icon: '🔴', label: 'Avslag' },
  remitterad: { icon: '📋', label: 'Remitterad' },
  bordlagd: { icon: '⏸️', label: 'Bordlagd' },
}

export function generateDecisionCardHTML(config: DecisionCardConfig): string {
  const { titel, datum, status, paragraf, ja, nej, avstår, url } = config
  const meta = statusMeta[status]
  const hasVotes = ja != null && nej != null

  return `<article class="daf-decision-card" data-status="${status}">
  <div class="daf-decision-card__header">
    <span class="daf-decision-card__status">${meta.icon} ${meta.label}</span>
    <time class="daf-decision-card__date" datetime="${datum}">${datum}</time>
  </div>
  <h3 class="daf-decision-card__title"><a href="${url}">${titel}</a></h3>
  ${paragraf ? `<p class="daf-decision-card__ref">${paragraf}</p>` : ''}
  ${hasVotes ? `<p class="daf-decision-card__votes">Ja: ${ja} · Nej: ${nej} · Avstår: ${avstår ?? 0}</p>` : ''}
</article>`
}
