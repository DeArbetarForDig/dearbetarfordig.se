/**
 * @daf/ui — Design Tokens
 *
 * Design foundations:
 * - 8px spacing grid
 * - Light/dark themes (no pure white/black)
 * - Status colors for DV
 * - Party colors as categorical palette
 */

/**
 * Color values live exclusively in CSS custom properties (tokens/css/*.css):
 * --parti-*, --vote-*, --color-*, --chart-*. TS exports only the code lists
 * and types so components can validate/enumerate without duplicating colors.
 */
export const partyCodes = ['S', 'M', 'SD', 'C', 'V', 'KD', 'MP', 'L', 'D', '-'] as const

export const votePositions = ['ja', 'nej', 'avstår', 'frånvarande'] as const

/** 8px spacing grid */
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
} as const

export const fontSize = {
  small: '0.75rem',
  label: '0.875rem',
  body: '1rem',
  h3: '1.25rem',
  h2: '1.5rem',
  h1: '2rem',
  kpi: '2.5rem',
} as const

export type PartyCode = (typeof partyCodes)[number]
export type VotePosition = (typeof votePositions)[number]
