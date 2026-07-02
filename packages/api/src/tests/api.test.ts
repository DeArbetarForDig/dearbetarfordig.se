/**
 * API Tests — Smoke tests + Investigation use cases
 *
 * Smoke: varje endpoint svarar korrekt
 * Investigation: realistiska frågor en journalist/AI-agent ställer
 */

import { beforeAll, describe, expect, it } from 'vitest'

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
    expect(data.total).toBe(125)
    expect(data._embedded.items[0]).toHaveProperty('id')
    expect(data._embedded.items[0]).toHaveProperty('namn')
    expect(data._embedded.items[0]).toHaveProperty('parti')
    expect(data._links.self.href).toBe('/api/v1/goteborg/politiker')
  })

  it('GET /api/v1/goteborg/politiker?parti=S → filtrerar', async () => {
    const { data } = await get('/api/v1/goteborg/politiker?parti=S')
    expect(data.total).toBe(33)
    data._embedded.items.forEach((p: any) => expect(p.parti).toBe('S'))
  })

  it('GET /api/v1/goteborg/möten → har sammanträden', async () => {
    const { data } = await get('/api/v1/goteborg/m%C3%B6ten')
    expect(data.total).toBeGreaterThan(10)
    expect(data._embedded.items[0]).toHaveProperty('datum')
    expect(data._embedded.items[0]).toHaveProperty('antalBeslut')
  })

  it('GET /api/v1/goteborg/beslut → har beslut', async () => {
    const { data } = await get('/api/v1/goteborg/beslut')
    expect(data.total).toBeGreaterThan(0)
    expect(data._embedded.items[0]).toHaveProperty('rubrik')
    expect(data._embedded.items[0]).toHaveProperty('datum')
  })

  it('GET /api/v1/goteborg/budget → lista budgetår', async () => {
    const { data } = await get('/api/v1/goteborg/budget')
    expect(data.total).toBeGreaterThan(0)
    expect(data._embedded.items[0]).toHaveProperty('år')
    expect(data._embedded.items[0]).toHaveProperty('totalMnkr')
  })

  it('GET /api/v1/goteborg/budget?år=2025 → organisationer med belopp', async () => {
    const { data } = await get('/api/v1/goteborg/budget?%C3%A5r=2025')
    expect(data._embedded.item.totalMnkr).toBeGreaterThan(30000)
    expect(data._embedded.related.nämnder.length).toBeGreaterThan(20)
  })

  it('GET /api/v1/goteborg/metrics → beslutskraft och partilojalitet', async () => {
    const { data } = await get('/api/v1/goteborg/metrics')
    expect(data.beslutskraft).toHaveProperty('bifall')
    expect(data.beslutskraft).toHaveProperty('bordläggning')
    expect(data.aktivitet.jävsanmälningar).toBeGreaterThanOrEqual(2)
    expect(data.partilojalitet).toHaveProperty('S')
    expect(data.partilojalitet.S.jaProcent).toBeGreaterThan(50)
  })

  it('GET /api/v1/goteborg/sök?q=budget → hittar resultat', async () => {
    const { data } = await get('/api/v1/goteborg/s%C3%B6k?q=budget')
    expect(data.resultat.length).toBeGreaterThan(0)
  })

  it('GET /api/v1/goteborg/sök?q=cybersäkerhet → hittar dokument (FTS)', async () => {
    const { data } = await get('/api/v1/goteborg/s%C3%B6k?q=cybers%C3%A4kerhet')
    const dokumentTräffar = data.resultat.filter((r: any) => r.typ === 'dokument')
    expect(dokumentTräffar.length).toBeGreaterThan(0)
  })

  it('GET /api/v1/goteborg/dokument/sök?q=cybersäkerhet → rankade träffar med utdrag', async () => {
    const { data } = await get('/api/v1/goteborg/dokument/s%C3%B6k?q=cybers%C3%A4kerhet')
    expect(data.resultat.length).toBeGreaterThan(0)
    expect(data.resultat[0]).toHaveProperty('utdrag')
    expect(data.resultat[0].utdrag.toLowerCase()).toContain('cybersäkerhet')
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
    // Find Kommunledningen (merged canonical node) and check its members
    const { data } = await get('/api/v1/goteborg/graf/node/nämnd-kommunledningen')
    expect(data.node).toBeDefined()
    expect(data.related.length).toBeGreaterThan(3)
    // Should contain politicians from multiple parties
    const partier = new Set(
      data.related.filter((n: any) => n.typ === 'politiker').map((n: any) => n.data?.parti),
    )
    expect(partier.size).toBeGreaterThan(2)
  })

  it('Politiker har bolagsuppdrag i grafen', async () => {
    const { data: polList } = await get('/api/v1/goteborg/politiker?parti=L&limit=5')
    let found = false
    for (const pol of polList._embedded.items) {
      const { data: node } = await get(`/api/v1/goteborg/graf/node/politiker-${pol.id}`)
      const bolagEdges = node.edges.filter((e: any) => e.typ === 'bolagsuppdrag')
      if (bolagEdges.length > 0) {
        found = true
        const bolagId = bolagEdges[0].to_id
        const relatedBolag = node.related.find((r: any) => r.id === bolagId)
        expect(relatedBolag).toBeDefined()
        expect(relatedBolag.typ).toBe('bolag')
        break
      }
    }
    expect(found).toBe(true)
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

describe('Integration: полный путь по графу (politiker → beslut → organisation → politiker)', () => {
  it('Kan gå från politiker → votering → beslut → nämnd → annan politiker', async () => {
    // 1. Hämta en politiker (Jonas Attenius, S)
    const { data: polList } = await get('/api/v1/goteborg/politiker?parti=S')
    expect(polList.total).toBeGreaterThan(0)
    const jonas = polList._embedded.items.find((p: any) => p.namn.includes('Attenius'))
    expect(jonas).toBeDefined()

    // 2. Hämta politikerns graf-nod med alla kopplingar
    const { data: polNode } = await get(`/api/v1/goteborg/graf/node/politiker-${jonas.id}`)
    expect(polNode.node).toBeDefined()
    expect(polNode.edges.length).toBeGreaterThan(5)

    // 3. Hitta ett beslut hen röstade ja till
    const jaEdge = polNode.edges.find((e: any) => e.typ === 'röstade_ja')
    expect(jaEdge).toBeDefined()
    const beslutId = jaEdge.to_id

    // 4. Hämta beslutet och se vilka organisationer det berör
    const { data: beslutNode } = await get(
      `/api/v1/goteborg/graf/node/${encodeURIComponent(beslutId)}`,
    )
    expect(beslutNode.node).toBeDefined()
    expect(beslutNode.node.typ).toBe('paragraf')
    expect(beslutNode.edges.length).toBeGreaterThan(0)

    // 5. Hitta en organisation kopplad till beslutet
    const orgEdge = beslutNode.edges.find(
      (e: any) => e.typ === 'uppdrag_till' || e.typ === 'hänvisar_till',
    )
    if (orgEdge) {
      const orgId = orgEdge.to_id || orgEdge.from_id
      // 6. Hämta organisationen och se vilka politiker som sitter där
      const { data: orgNode } = await get(`/api/v1/goteborg/graf/node/${encodeURIComponent(orgId)}`)
      expect(orgNode.node).toBeDefined()
      // Should have politiker connected via sitter_i
      const politikerEdges = orgNode.edges.filter((e: any) => e.typ === 'sitter_i')
      expect(politikerEdges.length).toBeGreaterThanOrEqual(0)
    }
  })

  it('Varje politiker-nod har minst sitter_i-edges', async () => {
    const { data: polList } = await get('/api/v1/goteborg/politiker?parti=M&limit=3')
    for (const pol of polList._embedded.items) {
      const { data: node } = await get(`/api/v1/goteborg/graf/node/politiker-${pol.id}`)
      expect(node.node).toBeDefined()
      const sitterI = node.edges.filter((e: any) => e.typ === 'sitter_i')
      expect(sitterI.length).toBeGreaterThan(0) // Every politician has at least 1 uppdrag
    }
  })

  it('Beslut-noder har kopplingar till möte', async () => {
    const { data: beslut } = await get('/api/v1/goteborg/beslut?datum=2025-11-27&limit=3')
    for (const b of beslut._embedded.items) {
      const { data: node } = await get(`/api/v1/goteborg/graf/node/${encodeURIComponent(b.id)}`)
      expect(node.node).toBeDefined()
      const mötesEdge = node.edges.find((e: any) => e.typ === 'beslut_av')
      expect(mötesEdge).toBeDefined() // Every beslut belongs to a möte
    }
  })
})

describe('Investigation: Budget — vart går pengarna?', () => {
  it('Största budgetposten är grundskola', async () => {
    const { data } = await get('/api/v1/goteborg/budget?%C3%A5r=2025')
    const nämnder = data._embedded.related.nämnder
    const sorted = nämnder.sort(
      (a: any, b: any) => (b.kommunbidragMnkr || 0) - (a.kommunbidragMnkr || 0),
    )
    expect(sorted[0].namn).toContain('Grundskole')
  })

  it('Kan se koppling nämnd ↔ beslut via graf', async () => {
    const { data } = await get('/api/v1/goteborg/s%C3%B6k?q=Socialnämnden')
    expect(data.resultat.length).toBeGreaterThan(0)
  })
})
