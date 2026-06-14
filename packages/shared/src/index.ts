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
export const PolitikerSchema = z.object({
  id: z.string().uuid(),
  kommunId: z.string(),
  förnamn: z.string(),
  efternamn: z.string(),
  parti: z.string(),
  fotoUrl: z.string().optional(),
  email: z.string().email().optional(),
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

// --- Debatt (transkription) ---
export const AnförandeSchema = z.object({
  politikerId: z.string().uuid(),
  startTid: z.string(),
  slutTid: z.string(),
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
