const API_BASE = import.meta.env.API_URL || 'http://localhost:3000'

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json() as Promise<T>
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
  beslut: {
    id: string
    datum: string
    beslut: string
    rubrik: string
    röster?: { namn: string; parti: string; röst: string }[]
    jäv?: string[]
  }
  kopplingar: {
    typ: string
    riktning: string
    nod: { id: string; typ: string; label: string } | null
  }[]
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
}

export async function getPolitiker(): Promise<Politiker[]> {
  const data = await fetchApi<{ politiker: Politiker[] }>('/api/v1/goteborg/politiker?limit=200')
  return data.politiker
}

export async function getBeslut(limit = 200): Promise<Beslut[]> {
  const data = await fetchApi<{ beslut: Beslut[] }>(`/api/v1/goteborg/beslut?limit=${limit}`)
  return data.beslut
}

export async function getBeslutDetail(id: string): Promise<BeslutDetail> {
  return fetchApi<BeslutDetail>(`/api/v1/goteborg/beslut/${encodeURIComponent(id)}`)
}

export async function getStats(): Promise<Stats> {
  return fetchApi<Stats>('/api/v1/goteborg/stats')
}

export async function getMöten(): Promise<Möte[]> {
  const data = await fetchApi<{ möten: Möte[] }>('/api/v1/goteborg/möten')
  return data.möten
}

export async function getMetrics() {
  return fetchApi<any>('/api/v1/goteborg/metrics')
}

export async function getBudget() {
  return fetchApi<{ kommun: string; år: number; totalMnkr: number; nämnder: any[] }>('/api/v1/goteborg/budget?%C3%A5r=2026')
}

export async function getBudgetYear(år: number) {
  return fetchApi<{ kommun: string; år: number; totalMnkr: number; styre: string; nämnder: any[] }>(`/api/v1/goteborg/budget?%C3%A5r=${år}`)
}

export async function getPolitikerDetail(id: string) {
  return fetchApi<any>(`/api/v1/goteborg/politiker/${id}`)
}

export async function getPolitikerArvode(id: string) {
  return fetchApi<any>(`/api/v1/goteborg/politiker/${id}/arvode`)
}

export async function getPolitikerGraf(id: string) {
  return fetchApi<{ node: any; edges: any[]; related: any[] }>(`/api/v1/goteborg/graf/node/politiker-${id}`)
}

export async function getFörvaltningar() {
  return fetchApi<{ förvaltningar: any[] }>('/api/v1/goteborg/forvaltningar')
}

export async function getFörvaltningDetail(id: string) {
  return fetchApi<any>(`/api/v1/goteborg/forvaltningar/${id}`)
}

export async function getAnföranden(beslutId: string) {
  return fetchApi<{ beslutId: string; antal: number; anföranden: any[] }>(`/api/v1/goteborg/beslut/${encodeURIComponent(beslutId)}/anforanden`)
}
