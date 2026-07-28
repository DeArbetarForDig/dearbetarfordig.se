import { z } from 'zod'

// --- Kommun (tenant) ---
export const KommunSchema = z.object({
  id: z.string(),
  namn: z.string(),
  invånare: z.number(),
  url: z.string().url(),
})
export type Kommun = z.infer<typeof KommunSchema>

// --- Parti ---
export const PARTIER = {
  S: { namn: 'Socialdemokraterna', färg: '#ED1B34' },
  M: { namn: 'Moderaterna', färg: '#52BDEC' },
  SD: { namn: 'Sverigedemokraterna', färg: '#DDDD00' },
  C: { namn: 'Centerpartiet', färg: '#009933' },
  V: { namn: 'Vänsterpartiet', färg: '#DA291C' },
  KD: { namn: 'Kristdemokraterna', färg: '#005DA6' },
  MP: { namn: 'Miljöpartiet', färg: '#83CF39' },
  L: { namn: 'Liberalerna', färg: '#006AB3' },
} as const
export type Parti = keyof typeof PARTIER

// --- Politiker ---
export const SocialMediaSchema = z.object({
  twitter: z.string().optional(),
  facebook: z.string().optional(),
  instagram: z.string().optional(),
  linkedin: z.string().optional(),
})
export type SocialMedia = z.infer<typeof SocialMediaSchema>

export const PolitikerSchema = z.object({
  id: z.string().uuid(),
  kommunId: z.string(),
  förnamn: z.string(),
  efternamn: z.string(),
  parti: z.string(),
  fotoUrl: z.string().optional(),
  email: z.string().email().optional(),
  sociala: SocialMediaSchema.optional(),
  uppdrag: z.array(
    z.object({
      organisationId: z.string().uuid(),
      roll: z.string(),
      från: z.string(),
      till: z.string().nullable(),
    }),
  ),
})
export type Politiker = z.infer<typeof PolitikerSchema>

// --- Organisation (nämnd/bolag) ---
export const OrganisationSchema = z.object({
  id: z.string().uuid(),
  kommunId: z.string(),
  namn: z.string(),
  typ: z.enum(['nämnd', 'bolag', 'styrelse', 'råd', 'fullmäktige']),
  förälderId: z.string().uuid().nullable(),
})
export type Organisation = z.infer<typeof OrganisationSchema>

// --- Ärende / Beslut ---
export const ÄrendeSchema = z.object({
  id: z.string().uuid(),
  kommunId: z.string(),
  möteId: z.string().uuid(),
  paragraf: z.string().optional(),
  rubrik: z.string(),
  typ: z.string().optional(),
  beslut: z.enum(['bifall', 'avslag', 'bordläggning', 'återremiss']).optional(),
  beslutDatum: z.string().optional(),
  votering: z
    .object({
      ja: z.number(),
      nej: z.number(),
      avstår: z.number(),
      perLedamot: z
        .array(
          z.object({
            politikerId: z.string().uuid(),
            röst: z.enum(['ja', 'nej', 'avstår', 'frånvarande']),
          }),
        )
        .optional(),
    })
    .optional(),
})
export type Ärende = z.infer<typeof ÄrendeSchema>

// --- Debatt (anförande, källa: Yttrandeprotokoll) ---
export const AnförandeSchema = z.object({
  politikerId: z.string().uuid(),
  text: z.string(),
})
export const DebattSchema = z.object({
  id: z.string().uuid(),
  kommunId: z.string(),
  möteId: z.string().uuid(),
  ärendeId: z.string().uuid().optional(),
  anföranden: z.array(AnförandeSchema),
})
export type Debatt = z.infer<typeof DebattSchema>
export type Anförande = z.infer<typeof AnförandeSchema>

// --- Datafiler (data/*.json) — de FAKTISKA formaten på disk. Valideras
// blockande i CI (packages/pipeline/src/tests/validate-data.test.ts) så att
// scraper-/parserdrift inte tyst kan skriva trasiga filer. Schemana ovan
// (PolitikerSchema m.fl.) beskriver API-domänmodellen, inte filerna. ---

export const RosterUppdragSchema = z.object({
  organisation: z.string(),
  organisationId: z.string().optional(),
  roll: z.string(),
  från: z.string(),
  till: z.string().nullable(),
})

export const RosterMandatperiodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{4}$/),
  roll: z.string(),
  källa: z.string(),
})

export const RosterPolitikerSchema = z.object({
  id: z.string().uuid(),
  förnamn: z.string().min(1),
  efternamn: z.string(),
  parti: z.string().min(1),
  email: z.string().nullable(),
  uppdrag: z.array(RosterUppdragSchema),
  mandatperioder: z.array(RosterMandatperiodSchema),
  närstående: z.unknown().optional(),
  historisk: z.boolean().optional(),
})

export const RosterSchema = z.object({
  kommun: z.string(),
  källa: z.string(),
  hämtad: z.string(),
  mandatperiod: z.object({ från: z.string(), till: z.string() }).optional(),
  antal: z.number().int(),
  politiker: z.array(RosterPolitikerSchema),
})
export type Roster = z.infer<typeof RosterSchema>

export const GrafNodSchema = z.object({
  id: z.string().min(1),
  typ: z.string().min(1),
  label: z.string(),
  data: z.record(z.unknown()),
})

export const GrafEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  typ: z.string().min(1),
  label: z.string().optional(),
  data: z.unknown().optional(),
})

export const GrafFilSchema = z
  .object({
    nodes: z.array(GrafNodSchema),
    edges: z.array(GrafEdgeSchema),
  })
  .passthrough()
export type GrafFil = z.infer<typeof GrafFilSchema>

/**
 * En AI-analys skriven av beslutsanalytiker-subagenten till
 * data/analys/ai/<ärendeNr>.json. Schemat är blockande i CI: en subagent som
 * skriver trasig JSON ska stoppa bygget, inte seedas till produktion.
 *
 * `maskingenererad` är literal true och `granskad_*` finns alltid med — märkningen
 * av att texten är maskinskriven och ogranskad får inte kunna falla bort på vägen
 * till läsaren.
 */
export const AiAnalysSchema = z.object({
  ärendeNr: z.string().regex(/^[A-ZÅÄÖ]{2,4}-\d{4}-\d{5}$/),
  rubrik: z.string().min(1),
  maskingenererad: z.literal(true),
  modell: z.string().min(1),
  genererad: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granskad_av: z.string().nullable(),
  granskad_datum: z.string().nullable(),
  källa_hash: z.string().min(1),
  riktning: z.enum(['positiv', 'negativ', 'blandad', 'oklar']),
  confidence: z.enum(['low', 'medium', 'high']),
  sammanfattning: z.string().min(1).max(400),
  /**
   * Läsarens första lager: det man måste veta även om man inte läser brödtexten.
   * Teckengränserna är hårda med flit — "fatta dig kort" i en prompt ger inte
   * korta punkter, en maxlängd gör det. En invånare ska kunna skumma fliken på
   * tjugo sekunder och ändå ha fått det väsentliga.
   */
  nyckelpunkter: z
    .array(
      z.object({
        // varning = något läsaren bör se upp med, styrka = något som håller,
        // fakta = neutralt men avgörande för att förstå beslutet.
        ton: z.enum(['varning', 'styrka', 'fakta']),
        text: z.string().min(1).max(160),
      }),
    )
    .min(2)
    .max(4),
  talar_för: z.array(z.object({ text: z.string().min(1).max(180), källa: z.string().min(1) })).max(4),
  talar_emot: z
    .array(z.object({ text: z.string().min(1).max(180), källa: z.string().min(1) }))
    .max(4),
  analys_md: z.string().min(200),
  källor: z
    .array(
      z.object({
        typ: z.enum(['internt', 'webb']),
        ref: z.string().min(1),
        vad: z.string().min(1),
      }),
    )
    .min(1),
})
export type AiAnalys = z.infer<typeof AiAnalysSchema>

// Regeln "motstående belägg ⇒ inte confidence: high" står i prompten och i
// granskningschecklistan, inte här: den kräver att man läser beläggen och
// bedömer om de bär. Ett regex mot rubriken hade fällt nästan varje analys,
// eftersom subagenten ska skriva ut även när den letat och inte funnit något.

export { renderaMarkdown } from './markdown.js'
