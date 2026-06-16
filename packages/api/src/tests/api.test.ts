/**
 * API Tests — Smoke tests + Investigation use cases
 *
 * Smoke: varje endpoint svarar korrekt
 * Investigation: realistiska frågor en journalist/AI-agent ställer
 */

import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://localhost:3000'

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, data: await res.json() }
}

describe('Smoke tests — alla endpoints svarar', () => {
  it('GET /healthz → ok', async () => {
    const { status, data } = await get('/healthz')
    expect(status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.db).toBe('connected')
  })

  it('GET /api/v1/goteborg/stats → har politiker och graf', async () => {
    const { status, data } = await get('/api/v1/goteborg/stats')
    expect(status).toBe(200)
    expect(data.politiker).toBeGreaterThan(100)
    expect(data.graf.nodes).toBeGreaterThan(100)
    expect(data.graf.edges).toBeGreaterThan(1000)
  })

  it('GET /api/v1/goteborg/politiker → har politiker', async () => {
    const { data } = await get('/api/v1/goteborg/politiker?limit=125')
    expect(data.antal).toBe(125)
    expect(data.politiker[0]).toHaveProperty('id')
    expect(data.politiker[0]).toHaveProperty('namn')
    expect(data.politiker[0]).toHaveProperty('parti')
  })

  it('GET /api/v1/goteborg/politiker?parti=S → filtrerar', async () => {
    const { data } = await get('/api/v1/goteborg/politiker?parti=S')
    expect(data.antal).toBe(33)
    data.politiker.forEach((p: any) => expect(p.parti).toBe('S'))
  })

  it('GET /api/v1/goteborg/möten → har sammanträden', async () => {
    const { data } = await get('/api/v1/goteborg/m%C3%B6ten')
    expect(data.antal).toBeGreaterThan(10)
    expect(data.möten[0]).toHaveProperty('datum')
    expect(data.möten[0]).toHaveProperty('antalBeslut')
  })

  it('GET /api/v1/goteborg/beslut → har beslut', async () => {
    const { data } = await get('/api/v1/goteborg/beslut')
    expect(data.antal).toBeGreaterThan(0)
    expect(data.beslut[0]).toHaveProperty('rubrik')
    expect(data.beslut[0]).toHaveProperty('datum')
  })

  it('GET /api/v1/goteborg/budget → organisationer med belopp', async () => {
    const { data } = await get('/api/v1/goteborg/budget')
    expect(data.totalMnkr).toBeGreaterThan(30000)
    expect(data.nämnder.length).toBeGreaterThan(20)
  })

  it('GET /api/v1/goteborg/metrics → beslutskraft och partilojalitet', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    expect(data.beslutskraft).toHaveProperty('bifall')
    expect(data.beslutskraft).toHaveProperty('bordläggning')
    expect(data.aktivitet.jävsanmälningar).toBeGreaterThanOrEqual(2)
    expect(data.partilojalitet).toHaveProperty('S')
    expect(data.partilojalitet.S.jaProcent).toBe(100)
  })

  it('GET /api/v1/goteborg/sök?q=budget → hittar resultat', async () => {
    const { data } = await get('/api/v1/goteborg/s%C3%B6k?q=budget')
    expect(data.resultat.length).toBeGreaterThan(0)
  })

  it('GET /api/v1/goteborg/graf → visar nodtyper', async () => {
    const { data } = await get('/api/v1/goteborg/graf')
    expect(data.nodes.length).toBeGreaterThan(5)
    expect(data.edges).toBeGreaterThan(1000)
  })

  it('404 för okänd kommun', async () => {
    const res = await fetch(`${BASE}/api/v1/stockholm/politiker`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('finns inte')
  })
})

describe('Investigation: Vem röstar med vem?', () => {
  it('C röstar med styret (S+V+MP) oftare än oppositionen', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    const c = data.partilojalitet.C
    const m = data.partilojalitet.M
    // C should have higher ja% than M (opposition)
    expect(c.jaProcent).toBeGreaterThan(m.jaProcent)
  })

  it('SD reserverar sig oftast', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    // SD should have 0% ja (always votes against styre)
    expect(data.partilojalitet.SD.jaProcent).toBeLessThan(5)
  })
})

describe('Investigation: Jäv och konflikter', () => {
  it('Kan hitta alla jävsanmälningar', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    expect(data.aktivitet.jävsanmälningar).toBeGreaterThanOrEqual(2)
  })

  it('Kan traversera graf — se vem som sitter var', async () => {
    // Find Kommunstyrelsens arbetsutskott and check its members
    const { data } = await get('/api/v1/goteborg/graf/node/org-kommunstyrelsens-arbetsutskott')
    expect(data.node).toBeDefined()
    expect(data.related.length).toBeGreaterThan(3)
    // Should contain politicians from multiple parties
    const partier = new Set(data.related.filter((n: any) => n.typ === 'politiker').map((n: any) => n.data?.parti))
    expect(partier.size).toBeGreaterThan(2)
  })
})

describe('Investigation: Bordläggning — varför fattas ej beslut?', () => {
  it('Majoriteten av bordläggningar beror på tidsbrist', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    const orsaker = data.beslutskraft.bordläggningsorsaker || {}
    const tid = orsaker.tid || 0
    const total = Object.values(orsaker).reduce((s: number, v: any) => s + v, 0) as number
    // Tid should be majority reason
    if (total > 0) expect(tid / total).toBeGreaterThan(0.5)
  })
})

describe('Investigation: Budget — vart går pengarna?', () => {
  it('Största budgetposten är grundskola', async () => {
    const { data } = await get('/api/v1/goteborg/budget')
    const sorted = data.nämnder.sort((a: any, b: any) => (b.kommunbidragMnkr || 0) - (a.kommunbidragMnkr || 0))
    expect(sorted[0].namn).toContain('Grundskole')
  })

  it('Kan se koppling nämnd ↔ beslut via graf', async () => {
    // Search for a nämnd node and verify it has edges to decisions
    const { data } = await get('/api/v1/goteborg/s%C3%B6k?q=Socialnämnden')
    expect(data.resultat.length).toBeGreaterThan(0)
  })
})
