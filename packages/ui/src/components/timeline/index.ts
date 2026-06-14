/**
 * @daf/ui — Timeline
 *
 * Displays chronological events for a decision's lifecycle.
 */

export interface TimelineEvent {
  datum: string
  titel: string
  beskrivning?: string
  aktör?: string
  status?: 'active' | 'completed' | 'pending'
}

export interface TimelineConfig {
  events: TimelineEvent[]
}

export function generateTimelineHTML(config: TimelineConfig): string {
  const items = config.events
    .map(
      (event, i) => `
    <li class="daf-timeline__item" data-status="${event.status ?? 'completed'}">
      <div class="daf-timeline__marker"></div>
      <div class="daf-timeline__content">
        <time class="daf-timeline__date" datetime="${event.datum}">${event.datum}</time>
        <h4 class="daf-timeline__title">${event.titel}</h4>
        ${event.aktör ? `<p class="daf-timeline__actor">${event.aktör}</p>` : ''}
        ${event.beskrivning ? `<p class="daf-timeline__desc">${event.beskrivning}</p>` : ''}
      </div>
    </li>`,
    )
    .join('\n')

  return `<ol class="daf-timeline" aria-label="Beslutshistorik">${items}\n</ol>`
}
