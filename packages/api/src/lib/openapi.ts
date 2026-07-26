/**
 * Delade OpenAPI-byggstenar.
 *
 * Felsvaren nedan produceras av middleware i index.ts, inte av route-handlers,
 * och saknades därför i varje routes `responses` — en klient genererad ur
 * spec:en visste inte att 404 (okänd kommun) och 429 (rate limit) fanns.
 * Sprid in `standardFel` först i responses-objektet så kan varje route
 * fortfarande skriva över 404 med sitt eget resursspecifika svar.
 */
import type { Hook } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import type { Env } from 'hono'

export const FelSchema = z.object({ error: z.string() }).openapi('Fel')

export const standardFel = {
  400: {
    content: { 'application/json': { schema: FelSchema } },
    description: 'Ogiltig parameter',
  },
  404: {
    content: { 'application/json': { schema: FelSchema } },
    description: 'Okänd kommun (eller resurs som inte finns)',
  },
  429: {
    content: { 'application/json': { schema: FelSchema } },
    description: 'Rate limit överskriden (200 anrop/minut per IP)',
  },
} as const

/**
 * Heltalsparameter i query (limit/offset).
 *
 * Tidigare `z.string()` + parseInt: `limit=abc` blev tyst 20 och `offset=-5`
 * blev tyst 0, dvs. API:t låtsades att klienten inte hade skickat något fel.
 * Regexen ger 400 i stället; taket hanteras fortfarande i handlern (för stora
 * värden kapas, de är inte fel).
 */
export function heltalParam(beskrivning: string, min: 0 | 1 = 0) {
  // limit=0 gav tidigare tyst 20 rader (parseInt('0') || 20), vilket är ett
  // annat svar än klienten bad om — min=1 för limit, min=0 för offset.
  return z
    .string()
    .regex(min === 1 ? /^[1-9]\d*$/ : /^\d+$/, `måste vara ett heltal ≥ ${min}`)
    .optional()
    .openapi({ description: beskrivning })
}

/**
 * Gemensam defaultHook för alla routers: zod-valideringsfel ska svara med
 * samma `{ error }`-form som resten av API:t, inte med zods råa issue-träd
 * (som dessutom läcker fältnamn och interna typnamn).
 */
export const valideringsHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (!result.success) {
    const first = result.error.issues[0]
    const fält = first?.path.join('.') || 'parameter'
    return c.json({ error: `Ogiltig parameter: ${fält} — ${first?.message}` }, 400)
  }
}
