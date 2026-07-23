/**
 * HAL (Hypertext Application Language) helpers
 * Adds _links to API responses for discoverability
 *
 * Format:
 * - Collections: { _embedded: { items: [...] }, _links, total }
 * - Resources: { _embedded: { item: {...}, related?: {...} }, _links }
 */
import { z } from '@hono/zod-openapi'

export interface HalLink {
  href: string
  title?: string
}

export interface HalLinks {
  self: HalLink
  collection?: HalLink
  [key: string]: HalLink | undefined
}

// HAL Collection response
export interface HalCollection<T> {
  _embedded: {
    items: T[]
  }
  _links: HalLinks
  total: number
}

// HAL Resource response
export interface HalResource<T, R = Record<string, unknown>> {
  _embedded: {
    item: T
    related?: R
  }
  _links: HalLinks
}

/**
 * Create a HAL collection response
 */
export function halCollection<T>(items: T[], links: HalLinks, total?: number): HalCollection<T> {
  return {
    _embedded: { items },
    _links: links,
    total: total ?? items.length,
  }
}

/**
 * Create a HAL resource response
 */
export function halResource<T, R = Record<string, unknown>>(
  item: T,
  links: HalLinks,
  related?: R,
): HalResource<T, R> {
  const response: HalResource<T, R> = {
    _embedded: { item },
    _links: links,
  }
  if (related && Object.keys(related).length > 0) {
    response._embedded.related = related
  }
  return response
}

// --- OpenAPI response schemas for the HAL envelopes above ---
//
// NOT z.record()/z.object().passthrough()/z.unknown(): under this zod
// (3.23.8) + @hono/zod-openapi (0.19.x) combination, any of those forms in a
// route response schema makes @hono/zod-openapi's ExtractContent type infer
// the whole response as `never`, and every handler mismatches with an
// opaque "TypedResponse<never, ...>" error (confirmed by isolated repro).
// _links only needs `self` declared — HalLinks' extra optional keys are
// still assignable to the narrower schema type since it's never checked as
// an object literal here.
export const HalLinkSchema = z.object({ href: z.string(), title: z.string().optional() })
export const HalLinksSchema = z.object({ self: HalLinkSchema })

export function halCollectionSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    _embedded: z.object({ items: z.array(item) }),
    _links: HalLinksSchema,
    total: z.number(),
  })
}

export function halResourceSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    _embedded: z.object({ item }),
    _links: HalLinksSchema,
  })
}

export function halResourceWithRelatedSchema<T extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  item: T,
  related: R,
) {
  return z.object({
    _embedded: z.object({ item, related: related.optional() }),
    _links: HalLinksSchema,
  })
}

// Base URL builder
export function baseUrl(kommun: string): string {
  return `/v1/${kommun}`
}

// Politiker links
export function politikerLinks(kommun: string, id: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/politiker/${id}` },
    collection: { href: `${base}/politiker` },
    anforanden: { href: `${base}/politiker/${id}/anforanden` },
    arvode: { href: `${base}/politiker/${id}/arvode` },
    graf: { href: `${base}/graf/node/politiker-${id}` },
  }
}

// Politiker list links (for collection response)
export function politikerListLinks(kommun: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/politiker` },
  }
}

// Möte links
export function möteLinks(kommun: string, datum: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/möten/${datum}` },
    collection: { href: `${base}/möten` },
    anföranden: { href: `${base}/möten/${datum}/anföranden` },
    beslut: { href: `${base}/beslut?datum=${datum}` },
  }
}

// Möten list links
export function mötenListLinks(kommun: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/möten` },
  }
}

// Beslut links
export function beslutLinks(kommun: string, id: string, datum?: string): HalLinks {
  const base = baseUrl(kommun)
  const encodedId = encodeURIComponent(id)
  return {
    self: { href: `${base}/beslut/${encodedId}` },
    collection: { href: `${base}/beslut` },
    anforanden: { href: `${base}/beslut/${encodedId}/anforanden` },
    möte: datum ? { href: `${base}/möten/${datum}` } : undefined,
    graf: { href: `${base}/graf/node/${encodedId}` },
  }
}

// Beslut list links
export function beslutListLinks(kommun: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/beslut` },
  }
}

// Förvaltning links
export function förvaltningLinks(kommun: string, id: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/forvaltningar/${encodeURIComponent(id)}` },
    collection: { href: `${base}/forvaltningar` },
    direktör: { href: `${base}/lon/direktorer` },
  }
}

// Förvaltningar list links
export function förvaltningarListLinks(kommun: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: `${base}/forvaltningar` },
  }
}

// Budget links
export function budgetLinks(kommun: string, år?: string): HalLinks {
  const base = baseUrl(kommun)
  return {
    self: { href: år ? `${base}/budget?år=${år}` : `${base}/budget` },
  }
}

// Anföranden links (for politiker or beslut)
export function anförandenLinks(
  kommun: string,
  type: 'politiker' | 'beslut',
  id: string,
  datum?: string,
): HalLinks {
  const base = baseUrl(kommun)
  const encodedId = encodeURIComponent(id)
  if (type === 'politiker') {
    return {
      self: { href: `${base}/politiker/${encodedId}/anforanden${datum ? `?datum=${datum}` : ''}` },
      politiker: { href: `${base}/politiker/${encodedId}` },
    }
  }
  return {
    self: { href: `${base}/beslut/${encodedId}/anforanden` },
    beslut: { href: `${base}/beslut/${encodedId}` },
  }
}
