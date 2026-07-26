/**
 * @daf/ui — Party Tag (HTML-sträng)
 *
 * Samma visuella tagg som PartyTag.astro, men som HTML-sträng för de ställen
 * där en cell renderas via set:html (DataTable) och Astro-komponenter inte kan
 * användas. Färgerna kommer från CSS-variablerna --parti-<kod>, med
 * --parti-ovriga som fallback för partier utanför de etablerade.
 */

/** Etablerade partiers namn — samma som PartyTag.astro visar */
export const PARTY_NAMES: Record<string, string> = {
  S: 'Socialdemokraterna',
  M: 'Moderaterna',
  SD: 'Sverigedemokraterna',
  C: 'Centerpartiet',
  V: 'Vänsterpartiet',
  KD: 'Kristdemokraterna',
  MP: 'Miljöpartiet',
  L: 'Liberalerna',
  D: 'Demokraterna',
}

export interface PartyTagConfig {
  parti: string
  /** Visningsnamn — används för koder utanför PARTY_NAMES (småpartier, lokala listor) */
  namn?: string
  /** Visa partinamnet efter kodrutan */
  full?: boolean
  size?: 'sm' | 'md'
}

/** Fullständigt partinamn: etablerad förkortning först, annars registrerad beteckning */
export function partyName(parti: string, namn?: string): string {
  return PARTY_NAMES[parti] || namn?.trim() || parti
}

export function generatePartyTagHTML(config: PartyTagConfig): string {
  const { parti, namn, full = false, size = 'md' } = config
  const box = size === 'sm' ? 'w-[18px] h-[18px] text-[11px]' : 'w-[22px] h-[22px] text-[13px]'
  const färg = `var(--parti-${parti.toLowerCase()}, var(--parti-ovriga))`
  return `<span class="inline-flex items-center gap-1.5" title="${partyName(parti, namn)}"><span aria-hidden="true" class="inline-flex items-center justify-center rounded-sm text-white font-bold tracking-tight shrink-0 bg-(--parti-color) ${box}" style="--parti-color:${färg}">${parti}</span>${full ? `<span class="text-sm text-(--color-text-muted)">${partyName(parti, namn)}</span>` : ''}</span>`
}
