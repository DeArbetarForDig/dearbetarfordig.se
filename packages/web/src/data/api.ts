const API_BASE = import.meta.env.API_URL || 'http://localhost:3000'

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

// HAL response types
interface HalCollection<T> {
  _embedded: { items: T[] }
  _links: Record<string, { href: string }>
  total: number
}

interface HalResource<T, R = Record<string, unknown>> {
  _embedded: { item: T; related?: R }
  _links: Record<string, { href: string }>
}

export interface Politiker {
  id: string
  namn: string
  parti: string
  email: string | null
  antalUppdrag: number
  aktivSedan: string | null
}

export interface Beslut {
  id: string
  paragraf: string | null
  rubrik: string
  datum: string
  beslut: 'bifall' | 'avslag' | 'bordläggning' | null
  votering?: { ja: number; nej: number; avstår: number }
  ärendeNr?: string
}

export interface BeslutDetail {
  id: string
  datum: string
  beslut: string
  rubrik: string
  röster?: { namn: string; parti: string; röst: string }[]
  jäv?: string[]
}

export interface Stats {
  kommun: string
  politiker: number
  partier: Record<string, number>
  graf: { nodes: number; edges: number }
}

export interface Möte {
  datum: string
  label: string
  antalBeslut: number
  url?: string
  videoUrl?: string
}

export async function getPolitiker(): Promise<Politiker[]> {
  const data = await fetchApi<HalCollection<Politiker>>('/api/v1/goteborg/politiker?limit=1000')
  return data._embedded.items
}

export async function getBeslut(limit = 200): Promise<Beslut[]> {
  const data = await fetchApi<HalCollection<Beslut>>(`/api/v1/goteborg/beslut?limit=${limit}`)
  return data._embedded.items
}

export async function getBeslutDetail(id: string): Promise<{ beslut: BeslutDetail; kopplingar: any[] }> {
  const data = await fetchApi<HalResource<BeslutDetail, { kopplingar: any[] }>>(`/api/v1/goteborg/beslut/${encodeURIComponent(id)}`)
  return {
    beslut: data._embedded.item,
    kopplingar: data._embedded.related?.kopplingar || [],
  }
}

export async function getStats(): Promise<Stats> {
  return fetchApi<Stats>('/api/v1/goteborg/stats')
}

export async function getMöten(): Promise<Möte[]> {
  const data = await fetchApi<HalCollection<Möte>>('/api/v1/goteborg/möten')
  return data._embedded.items
}

export async function getMetrics() {
  return fetchApi<any>('/api/v1/goteborg/metrics')
}

export interface BudgetNämnd {
  namn: string
  kommunbidragMnkr: number
  driftMnkr?: number
  investeringMnkr?: number
}

export interface BudgetYear {
  år: number
  totalMnkr: number
  styre?: string
  nämnder: BudgetNämnd[]
}

export async function getBudget(): Promise<BudgetYear> {
  const data = await fetchApi<HalResource<{ år: number; totalMnkr: number; styre?: string }, { nämnder: BudgetNämnd[] }>>('/api/v1/goteborg/budget?%C3%A5r=2026')
  return {
    ...data._embedded.item,
    nämnder: data._embedded.related?.nämnder || [],
  }
}

export async function getBudgetYear(år: number): Promise<BudgetYear> {
  const data = await fetchApi<HalResource<{ år: number; totalMnkr: number; styre?: string }, { nämnder: BudgetNämnd[] }>>(`/api/v1/goteborg/budget?%C3%A5r=${år}`)
  return {
    ...data._embedded.item,
    nämnder: data._embedded.related?.nämnder || [],
  }
}

export async function getMöteAnföranden(datum: string, filters?: { talare?: string; ärende?: string; q?: string }) {
  const params = new URLSearchParams()
  if (filters?.talare) params.set('talare', filters.talare)
  if (filters?.ärende) params.set('ärende', filters.ärende)
  if (filters?.q) params.set('q', filters.q)
  const query = params.toString() ? `?${params.toString()}` : ''
  const data = await fetchApi<HalCollection<any>>(`/api/v1/goteborg/möten/${datum}/anföranden${query}`)
  return {
    antal: data.total,
    anföranden: data._embedded.items,
  }
}

export async function getPolitikerDetail(id: string) {
  const data = await fetchApi<HalResource<any, { möten?: any[] }>>(`/api/v1/goteborg/politiker/${id}`)
  return {
    ...data._embedded.item,
    möten: data._embedded.related?.möten || [],
  }
}

export async function getPolitikerArvode(id: string) {
  const data = await fetchApi<HalResource<any>>(`/api/v1/goteborg/politiker/${id}/arvode`)
  return data._embedded.item
}

export async function getPolitikerGraf(id: string) {
  return fetchApi<{ node: any; edges: any[]; related: any[] }>(`/api/v1/goteborg/graf/node/politiker-${id}`)
}

export async function getFörvaltningar() {
  const data = await fetchApi<HalCollection<any>>('/api/v1/goteborg/forvaltningar')
  return data._embedded.items
}

export async function getFörvaltningDetail(id: string) {
  const data = await fetchApi<HalResource<any, any>>(`/api/v1/goteborg/forvaltningar/${id}`)
  return {
    ...data._embedded.item,
    ...data._embedded.related,
  }
}

export async function getAnföranden(beslutId: string) {
  const data = await fetchApi<HalCollection<any>>(`/api/v1/goteborg/beslut/${encodeURIComponent(beslutId)}/anforanden`)
  return {
    beslutId,
    antal: data.total,
    anföranden: data._embedded.items,
  }
}

export async function getPolitikerAnföranden(politikerId: string, datum?: string) {
  const url = datum
    ? `/api/v1/goteborg/politiker/${politikerId}/anforanden?datum=${datum}`
    : `/api/v1/goteborg/politiker/${politikerId}/anforanden`
  const data = await fetchApi<HalCollection<any>>(url)
  return {
    antal: data.total,
    anföranden: data._embedded.items,
  }
}
