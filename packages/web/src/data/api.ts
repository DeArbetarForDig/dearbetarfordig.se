/// <reference types="astro/client" />
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
  uppdrag: Array<{ organisation: string; roll: string; från?: string; till?: string }>
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

export interface BudgetBeslut {
  id: string
  label: string
  datum: string
  _links: { self: { href: string } }
}

export interface BudgetYear {
  år: number
  totalMnkr: number
  styre?: string
  beslut: BudgetBeslut | null
  nämnder: BudgetNämnd[]
}

type BudgetItem = { år: number; totalMnkr: number; styre?: string; beslut: BudgetBeslut | null }

export async function getBudget(): Promise<BudgetYear> {
  const data = await fetchApi<HalResource<BudgetItem, { nämnder: BudgetNämnd[] }>>('/api/v1/goteborg/budget?%C3%A5r=2026')
  return {
    ...data._embedded.item,
    nämnder: data._embedded.related?.nämnder || [],
  }
}

export async function getBudgetYear(år: number): Promise<BudgetYear> {
  const data = await fetchApi<HalResource<BudgetItem, { nämnder: BudgetNämnd[] }>>(`/api/v1/goteborg/budget?%C3%A5r=${år}`)
  return {
    ...data._embedded.item,
    nämnder: data._embedded.related?.nämnder || [],
  }
}

export interface BudgetUtfallNämnd {
  id: string
  nämnd: string
  år: number
  intäkterMnkr: number
  kostnaderMnkr: number
  kommunbidragMnkr: number
  resultatMnkr: number
  budgetMnkr: number
  avvikelseMnkr: number
  status: 'i_balans' | 'överskott' | 'underskott'
  kommentar?: string
}

export async function getBudgetUtfall(år: number): Promise<BudgetUtfallNämnd[]> {
  const data = await fetchApi<HalCollection<BudgetUtfallNämnd>>(`/api/v1/goteborg/budget/utfall?%C3%A5r=${år}`)
  return data._embedded.items
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

export interface PolitikerProfilAxis {
  key: string
  label: string
  percentile: number | null
  rawLabel: string
  populationSize: number
}

export async function getPolitikerProfil(id: string): Promise<PolitikerProfilAxis[]> {
  const data = await fetchApi<HalResource<{ axes: PolitikerProfilAxis[] }>>(
    `/api/v1/goteborg/politiker/${id}/profil`,
  )
  return data._embedded.item.axes
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

export interface TrendDataPunkt {
  år: number
  värde: number | null
}

export interface TrendÄndring {
  från: number
  till: number
  procent: number
  procentReellt?: number
}

export interface TrendKpi {
  id: string
  namn: string
  kategori: string
  enhet: string
  nämndId?: string
  nämndNamn?: string
  göteborg: TrendDataPunkt[]
  utfallÄndring: TrendÄndring | null
  budget?: TrendDataPunkt[]
  budgetÄndring?: TrendÄndring | null
}

export interface Trender {
  kpis: TrendKpi[]
}

// SCB, inte Riksbanken, publicerar KPI-serien — Riksbanken bara targetar den.
// KPI2020M = tabellen med basår 2020, ska användas (1980=100-tabellen slutade uppdateras 2025M12).
const SCB_KPI_URL = 'https://api.scb.se/OV0104/v1/doris/sv/ssd/START/PR/PR0101/PR0101A/KPI2020M'
// "KPI, fastställda tal" (00000808) är null före 2026M01 i den här tabellen — historiken finns
// bara i "KPI, skuggindex" (00000807), vilket SCB:s egen tabellnot anger som konsistent för jämförelser.
const SCB_KPI_CONTENTSCODE = '00000807'

async function fetchScbKpi(): Promise<Record<number, number>> {
  const sistaÅr = new Date().getFullYear()
  const förstaÅr = sistaÅr - 15
  const månader = Array.from({ length: sistaÅr - förstaÅr + 1 }, (_, i) => `${förstaÅr + i}M01`)

  const res = await fetch(SCB_KPI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: [
        { code: 'ContentsCode', selection: { filter: 'item', values: [SCB_KPI_CONTENTSCODE] } },
        { code: 'Tid', selection: { filter: 'item', values: månader } },
      ],
      response: { format: 'json-stat2' },
    }),
  })
  if (!res.ok) throw new Error(`SCB KPI ${res.status}`)
  const data = (await res.json()) as { dimension: { Tid: { category: { index: Record<string, number> } } }; value: (number | null)[] }

  const index: Record<number, number> = {}
  for (const [tid, i] of Object.entries(data.dimension.Tid.category.index)) {
    const värde = data.value[i]
    if (värde !== null) index[Number(tid.slice(0, 4))] = värde
  }
  return index
}

// Räknar om ett nominellt belopp i "årKPI"-prisnivå till "basårKPI"-prisnivå (reellt värde).
function reellt(nominalMnkr: number, årKPI: number, basårKPI: number): number {
  return nominalMnkr * (basårKPI / årKPI)
}

function beräknaProcentReellt(budget: TrendDataPunkt[] | undefined, kpiIndex: Record<number, number>): number | undefined {
  if (!budget) return undefined
  const punkter = budget.filter((p) => p.värde !== null)
  if (punkter.length < 2) return undefined
  const första = punkter[0]
  const sista = punkter[punkter.length - 1]
  const kpiFrån = kpiIndex[första.år]
  const kpiTill = kpiIndex[sista.år]
  if (!kpiFrån || !kpiTill) return undefined

  const förstaReellt = reellt(första.värde as number, kpiFrån, kpiTill)
  return Math.round(((sista.värde! - förstaReellt) / förstaReellt) * 1000) / 10
}

export function divergens(kpi: TrendKpi): number | null {
  if (!kpi.budgetÄndring || !kpi.utfallÄndring) return null
  return kpi.budgetÄndring.procent - kpi.utfallÄndring.procent
}

export function divergensLabel(d: number): { text: string; tone: 'warning' | 'negative' | 'positive' } {
  if (d > 10) return { text: 'Stor divergens — resultat följer inte budgetökning', tone: 'negative' }
  if (d > 5) return { text: 'Måttlig divergens', tone: 'warning' }
  if (d < -5) return { text: 'Resultat överträffar budgettillväxt', tone: 'positive' }
  return { text: 'Proportionellt — resultat följer budget', tone: 'positive' }
}

export async function getTrender(): Promise<Trender> {
  const trender = await fetchApi<Trender>('/api/v1/goteborg/trender')

  let kpiIndex: Record<number, number> = {}
  try {
    kpiIndex = await fetchScbKpi()
  } catch (err) {
    console.warn('SCB KPI-uppslagning misslyckades, visar nominella tal utan realt värde:', err)
  }

  for (const kpi of trender.kpis) {
    if (kpi.budgetÄndring) {
      kpi.budgetÄndring.procentReellt = beräknaProcentReellt(kpi.budget, kpiIndex)
    }
  }

  return trender
}
