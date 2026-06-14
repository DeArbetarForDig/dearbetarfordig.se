/**
 * @daf/ui — Design Tokens
 *
 * Alla färger, spacing och typografi som CSS custom properties.
 * Kommun-teman överrider dessa via :root eller data-theme.
 */

export const partyColors = {
  S: '#ED1B34',
  M: '#52BDEC',
  SD: '#DDDD00',
  C: '#009933',
  V: '#DA291C',
  KD: '#005DA6',
  MP: '#83CF39',
  L: '#006AB3',
  '-': '#94A3B8', // Partilösa
} as const

export const voteColors = {
  ja: '#16A34A',
  nej: '#DC2626',
  avstår: '#EAB308',
  frånvarande: '#6B7280',
} as const

export const theme = {
  light: {
    background: '#FFFFFF',
    text: '#1E293B',
    primary: '#2563EB',
    secondary: '#7C3AED',
    muted: '#64748B',
  },
  dark: {
    background: '#0F172A',
    text: '#F1F5F9',
    primary: '#60A5FA',
    secondary: '#A78BFA',
    muted: '#94A3B8',
  },
} as const

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '2rem',
  kpi: '2.5rem',
} as const

export type PartyCode = keyof typeof partyColors
export type VotePosition = keyof typeof voteColors
