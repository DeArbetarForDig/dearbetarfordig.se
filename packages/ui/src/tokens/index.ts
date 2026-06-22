/**
 * @daf/ui — Design Tokens
 *
 * Design foundations:
 * - 8px spacing grid
 * - Light/dark themes (no pure white/black)
 * - Status colors for DV
 * - Party colors as categorical palette
 */

export const partyColors = {
  S: '#ED1B34',
  M: '#213A8F',
  SD: '#FBC700',
  C: '#114838',
  V: '#DA291C',
  KD: '#231977',
  MP: '#4C983E',
  L: '#0077C8',
  D: '#1B1B1B',
  '-': '#888888',
} as const

export const voteColors = {
  ja: '#16A34A',
  nej: '#DC2626',
  avstår: '#EAB308',
  frånvarande: '#64748B',
} as const

export const statusColors = {
  positive: '#16A34A',
  negative: '#DC2626',
  warning: '#EAB308',
  info: '#2563EB',
  neutral: '#64748B',
} as const

export const theme = {
  light: {
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    text: '#1E293B',
    textMuted: '#64748B',
    border: '#E2E8F0',
    primary: '#2563EB',
    accent: '#7C3AED',
  },
  dark: {
    bg: '#0F172A',
    surface: '#1E293B',
    text: '#F1F5F9',
    textMuted: '#94A3B8',
    border: '#334155',
    primary: '#60A5FA',
    accent: '#A78BFA',
  },
} as const

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

export type PartyCode = keyof typeof partyColors
export type VotePosition = keyof typeof voteColors
