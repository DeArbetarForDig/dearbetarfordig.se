import { describe, expect, it } from 'vitest'
import { mergeOrganisations } from '../db/merge-organisations.js'

function orgNode(id: string, label: string) {
  return { id, typ: 'organisation', label, data: {} }
}

describe('mergeOrganisations', () => {
  it('mergar "X nämnd"-etiketter (trailing nämnd) till kanonisk nod', () => {
    const nodes = [orgNode('org-förskolenämnden', 'Förskolenämnden')]
    const edges = [{ from: 'politiker-x', to: 'org-förskolenämnden', typ: 'ledamot_i' }]
    const { nodes: out, edges: outEdges } = mergeOrganisations(nodes, edges)
    expect(out.some((n) => n.id === 'nämnd-förskolenämnden')).toBe(true)
    expect(out.some((n) => n.id === 'org-förskolenämnden')).toBe(false)
    expect(outEdges[0].to).toBe('nämnd-förskolenämnden')
  })

  it('mergar "Göteborgs Stads nämnd för X"-etiketter (mid-string nämnd, ANALYS punkt 21)', () => {
    // Regressionsfallet: avtal-noder från FOI-svar hängde upphandlat_av-edges
    // på org-noden med denna etikettform, som aldrig mergades — avtalen blev
    // onåbara från /forvaltning/{id}.
    const cases: Array<[string, string, string]> = [
      [
        'org-göteborgs-stads-nämnd-för-intraservice',
        'Göteborgs Stads nämnd för Intraservice',
        'nämnd-nämnden-för-intraservice',
      ],
      [
        'org-nämnd-för-funktionsstöd',
        'Göteborgs Stads nämnd för funktionsstöd',
        'nämnd-nämnden-för-funktionsstöd',
      ],
      [
        'org-nämnd-för-arbetsmarknad',
        'Göteborgs Stads nämnd för arbetsmarknad och vuxenutbildning',
        'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
      ],
      [
        'org-nämnd-för-demokrati',
        'Göteborgs Stads nämnd för demokrati och medborgarservice',
        'nämnd-nämnden-för-demokrati-och-medborgarservice',
      ],
    ]
    for (const [orgId, label, canonical] of cases) {
      const edges = [{ from: 'avtal-x', to: orgId, typ: 'upphandlat_av' }]
      const { nodes: out, edges: outEdges } = mergeOrganisations([orgNode(orgId, label)], edges)
      expect(
        out.some((n) => n.id === canonical),
        label,
      ).toBe(true)
      expect(outEdges[0].to, label).toBe(canonical)
    }
  })

  it('behåller redan kanoniska etiketter ("Nämnden för X") som förut', () => {
    const { nodes: out } = mergeOrganisations(
      [orgNode('org-nämnden-för-intraservice', 'Nämnden för Intraservice')],
      [],
    )
    expect(out.some((n) => n.id === 'nämnd-nämnden-för-intraservice')).toBe(true)
  })

  it('rör inte organisationer utan kanonisk motsvarighet', () => {
    const nodes = [orgNode('org-boplats-göteborg', 'Boplats Göteborg AB')]
    const { nodes: out } = mergeOrganisations(nodes, [])
    expect(out.some((n) => n.id === 'org-boplats-göteborg')).toBe(true)
  })
})
