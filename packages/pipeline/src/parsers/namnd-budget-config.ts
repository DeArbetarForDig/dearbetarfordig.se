/**
 * Nämnd Budget Parser Config
 *
 * Varje nämnd kan ha sin egen PDF-tabellformatering.
 * Om default regex inte matchar — lägg till nämnd-specifik pattern här.
 */

export interface NämndConfig {
  namn: string
  /** URL-encoded value in goteborg.se select */
  selectValue: string
  /** Meeting month to look for budget (usually nov/dec) */
  meetingPattern: RegExp
  /** PDF filename pattern to find in documents */
  pdfPattern: RegExp
  /** Regex to extract budget rows: group 1 = name, group 2 = amount */
  tableRegex: RegExp
  /** Minimum amount to include (filters noise) */
  minAmount: number
  /** Skip rows matching this pattern */
  skipPattern?: RegExp
}

export const DEFAULT_TABLE_REGEX = /^\s{3,}(.{5,50}?)\s{3,}(-?[\d ]{3,})\s*$/
export const DEFAULT_SKIP = /^\d|sida|datum|totalt|summa.*budget|^budget\s/i

export const NÄMND_CONFIGS: NämndConfig[] = [
  {
    namn: 'Grundskolenämnden',
    selectValue: 'Grundskolen%C3%A4mnden',
    meetingPattern: /2025-12/,
    pdfPattern: /budget/i,
    tableRegex: DEFAULT_TABLE_REGEX,
    minAmount: 10,
  },
  {
    namn: 'Utbildningsnämnden',
    selectValue: 'Utbildningsn%C3%A4mnden',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    // Utbildning uses tighter columns
    tableRegex: /^\s{2,}(.{5,45}?)\s{2,}(-?[\d ]{4,})\s*$/,
    minAmount: 100,
  },
  {
    namn: 'Socialnämnden Nordost',
    selectValue: 'Socialn%C3%A4mnden+Nordost',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: /^\s{2,}(.{5,45}?)\s{2,}(-?[\d ]{4,})\s*$/,
    minAmount: 50,
  },
  {
    namn: 'Socialnämnden Centrum',
    selectValue: 'Socialn%C3%A4mnden+Centrum',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: /^\s{2,}(.{5,45}?)\s{2,}(-?[\d ]{4,})\s*$/,
    minAmount: 50,
  },
  {
    namn: 'Socialnämnden Hisingen',
    selectValue: 'Socialn%C3%A4mnden+Hisingen',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: /^\s{2,}(.{5,45}?)\s{2,}(-?[\d ]{4,})\s*$/,
    minAmount: 50,
  },
  {
    namn: 'Socialnämnden Sydväst',
    selectValue: 'Socialn%C3%A4mnden+Sydv%C3%A4st',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: /^\s{2,}(.{5,45}?)\s{2,}(-?[\d ]{4,})\s*$/,
    minAmount: 50,
  },
  {
    namn: 'Stadsmiljönämnden',
    selectValue: 'Stadsmilj%C3%B6n%C3%A4mnden',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: DEFAULT_TABLE_REGEX,
    minAmount: 10,
  },
  {
    namn: 'Kulturnämnden',
    selectValue: 'Kulturn%C3%A4mnden',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    // Kultur has minimal tables, more text-based
    tableRegex: /^\s{2,}(.{5,40}?)\s{2,}(-?[\d ]{3,})\s*$/,
    minAmount: 5,
  },
  {
    namn: 'Idrotts- och föreningsnämnden',
    selectValue: 'Idrotts-+och+f%C3%B6reningsn%C3%A4mnden',
    meetingPattern: /2025-1[12]/,
    pdfPattern: /budget/i,
    tableRegex: DEFAULT_TABLE_REGEX,
    minAmount: 10,
  },
  {
    namn: 'Förskolenämnden',
    selectValue: 'F%C3%B6rskolen%C3%A4mnden',
    meetingPattern: /2025-12/,
    pdfPattern: /budget|genomförandeplan/i,
    tableRegex: DEFAULT_TABLE_REGEX,
    minAmount: 10,
  },
]
