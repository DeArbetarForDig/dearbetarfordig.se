/**
 * Merge duplicate organisation nodes into canonical nämnd-* nodes.
 * Post-processing step: runs after loading all JSON, before DB insert.
 */

const CANONICAL: Record<string, string> = {
  'förskolenämnden': 'nämnd-förskolenämnden',
  'grundskolenämnden': 'nämnd-grundskolenämnden',
  'utbildningsnämnden': 'nämnd-utbildningsnämnden',
  'socialnämnden nordost': 'nämnd-socialnämnden-nordost',
  'socialnämnden centrum': 'nämnd-socialnämnden-centrum',
  'socialnämnden sydväst': 'nämnd-socialnämnden-sydväst',
  'socialnämnden hisingen': 'nämnd-socialnämnden-hisingen',
  'kulturnämnden': 'nämnd-kulturnämnden',
  'idrotts- och föreningsnämnden': 'nämnd-idrotts-och-föreningsnämnden',
  'stadsmiljönämnden': 'nämnd-stadsmiljönämnden',
  'stadsbyggnadsnämnden': 'nämnd-stadsbyggnadsnämnden',
  'exploateringsnämnden': 'nämnd-exploateringsnämnden',
  'miljö- och klimatnämnden': 'nämnd-miljö-och-klimatnämnden',
  'kommunstyrelsen': 'nämnd-kommunledningen',
  'nämnden för funktionsstöd': 'nämnd-nämnden-för-funktionsstöd',
  'nämnden för arbetsmarknad och vuxenutbildning': 'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
  'inköps- och upphandlingsnämnden': 'nämnd-inköps-och-upphandlingsnämnden',
  'nämnden för intraservice': 'nämnd-nämnden-för-intraservice',
  'nämnden för demokrati och medborgarservice': 'nämnd-nämnden-för-demokrati-och-medborgarservice',
  'stadsfastighetsnämnden': 'nämnd-stadsfastighetsnämnden',
  'kretslopp- och vattennämnden': 'nämnd-kretslopp-och-vattennämnden',
  'valnämnden': 'nämnd-valnämnden',
}

interface Node { id: string; typ: string; label: string; data: Record<string, any> }
interface Edge { from: string; to: string; typ: string; label?: string; data?: any }

function normalize(label: string): string | null {
  let name = label.replace(/\n/g, ' ').replace(/göteborgs stads\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (name.match(/nämnd$/) && !name.endsWith('nämnden')) name += 'en'

  if (CANONICAL[name]) return name
  for (const key of Object.keys(CANONICAL)) {
    if (key.startsWith(name) && name.length >= 10) return key
    if (name.startsWith(key)) return key
  }
  return null
}

export function mergeOrganisations(nodes: Node[], edges: Edge[]) {
  const mergeMap = new Map<string, string>()

  for (const node of nodes) {
    if (node.typ !== 'organisation' || node.id.startsWith('nämnd-')) continue
    const match = normalize(node.label)
    if (match) mergeMap.set(node.id, CANONICAL[match])
  }

  // Enrich canonical nodes
  const canonicals = new Map<string, Node>()
  for (const n of nodes) { if (n.id.startsWith('nämnd-')) canonicals.set(n.id, { ...n, typ: 'organisation' }) }

  for (const node of nodes) {
    const cid = mergeMap.get(node.id)
    if (!cid) continue
    const c = canonicals.get(cid)
    if (!c) continue
    if (node.label.length > ((c.data.officiellt_namn as string) || '').length) c.data.officiellt_namn = node.label
    c.data.aliases = [...((c.data.aliases as string[]) || []), node.id]
  }

  const filteredNodes = nodes.filter(n => !mergeMap.has(n.id))
  for (const [id, node] of canonicals) {
    const idx = filteredNodes.findIndex(n => n.id === id)
    if (idx >= 0) filteredNodes[idx] = node
  }

  const rewrittenEdges = edges
    .map(e => ({ ...e, from: mergeMap.get(e.from) || e.from, to: mergeMap.get(e.to) || e.to }))
    .filter(e => e.from !== e.to)

  return { nodes: filteredNodes, edges: rewrittenEdges, mergeCount: mergeMap.size }
}
