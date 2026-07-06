/**
 * Merge duplicate organisation nodes into canonical nämnd-* nodes.
 * Post-processing step: runs after loading all JSON, before DB insert.
 */

const CANONICAL: Record<string, string> = {
  förskolenämnden: 'nämnd-förskolenämnden',
  grundskolenämnden: 'nämnd-grundskolenämnden',
  utbildningsnämnden: 'nämnd-utbildningsnämnden',
  'socialnämnden nordost': 'nämnd-socialnämnden-nordost',
  'socialnämnden centrum': 'nämnd-socialnämnden-centrum',
  'socialnämnden sydväst': 'nämnd-socialnämnden-sydväst',
  'socialnämnden hisingen': 'nämnd-socialnämnden-hisingen',
  kulturnämnden: 'nämnd-kulturnämnden',
  'idrotts- och föreningsnämnden': 'nämnd-idrotts-och-föreningsnämnden',
  stadsmiljönämnden: 'nämnd-stadsmiljönämnden',
  stadsbyggnadsnämnden: 'nämnd-stadsbyggnadsnämnden',
  exploateringsnämnden: 'nämnd-exploateringsnämnden',
  'miljö- och klimatnämnden': 'nämnd-miljö-och-klimatnämnden',
  kommunstyrelsen: 'nämnd-kommunledningen',
  'nämnden för funktionsstöd': 'nämnd-nämnden-för-funktionsstöd',
  'nämnden för arbetsmarknad och vuxenutbildning':
    'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
  'inköps- och upphandlingsnämnden': 'nämnd-inköps-och-upphandlingsnämnden',
  'nämnden för intraservice': 'nämnd-nämnden-för-intraservice',
  'nämnden för demokrati och medborgarservice': 'nämnd-nämnden-för-demokrati-och-medborgarservice',
  stadsfastighetsnämnden: 'nämnd-stadsfastighetsnämnden',
  'kretslopp- och vattennämnden': 'nämnd-kretslopp-och-vattennämnden',
  'kretslopp och vattennämnden': 'nämnd-kretslopp-och-vattennämnden',
  valnämnden: 'nämnd-valnämnden',
  'äldre samt vård- och omsorgsnämnden': 'nämnd-äldre-samt-vård-och-omsorgsnämnden',
  arkivnämnden: 'nämnd-arkivnämnden',
}

// Broken source ids → canonical. The direktör scraper polluted one nämnd
// slug with the ansvar text ("Kretslopp och vatten, Västsvenska paketet").
const ID_ALIASES: Record<string, string> = {
  'nämnd-kretslopp-och-vatten-västsvenska-paketet': 'nämnd-kretslopp-och-vattennämnden',
}

interface Node {
  id: string
  typ: string
  label: string
  data: Record<string, any>
}
interface Edge {
  from: string
  to: string
  typ: string
  label?: string
  data?: any
}

function normalize(label: string): string | null {
  let name = label
    .replace(/\n/g, ' ')
    .replace(/göteborgs stads\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (name.match(/nämnd$/) && !name.endsWith('nämnden')) name += 'en'

  if (CANONICAL[name]) return name
  for (const key of Object.keys(CANONICAL)) {
    if (key.startsWith(name) && name.length >= 10) return key
    if (name.startsWith(key)) return key
  }
  return null
}

export function mergeOrganisations(nodes: Node[], edges: Edge[]) {
  const mergeMap = new Map<string, string>(Object.entries(ID_ALIASES))

  for (const node of nodes) {
    if (node.typ !== 'organisation' || node.id.startsWith('nämnd-')) continue
    const match = normalize(node.label)
    if (match) mergeMap.set(node.id, CANONICAL[match])
  }

  // Enrich canonical nodes. The canonical year-less ids (nämnd-<slug>) exist
  // in NO source file — only year-suffixed budget nodes (nämnd-<slug>-2026)
  // do — so merging used to DELETE the org node while rewriting its edges to
  // a nonexistent id: every hänvisar_till/uppdrag_till from KF-§§ and every
  // direktör leder-edge silently dropped on the FK at seed. Create the
  // canonical node from the best merged source instead.
  const canonicals = new Map<string, Node>()
  for (const n of nodes) {
    if (n.id.startsWith('nämnd-')) canonicals.set(n.id, { ...n, typ: 'organisation' })
  }
  // Label from the canonical NAME key, not from merged source labels — org
  // node labels are NÄMND_RE captures out of running protocol text and the
  // longest is reliably the noisiest ("kommunstyrelsen till förskolenämnden
  // respektive grundskolenämnden").
  const labelByCid = new Map<string, string>()
  for (const [namn, cid] of Object.entries(CANONICAL)) {
    const label = namn.charAt(0).toUpperCase() + namn.slice(1)
    if (!labelByCid.has(cid) || label.length < (labelByCid.get(cid) as string).length) {
      labelByCid.set(cid, label)
    }
  }
  for (const cid of new Set(mergeMap.values())) {
    if (!canonicals.has(cid)) {
      canonicals.set(cid, {
        id: cid,
        typ: 'organisation',
        label: labelByCid.get(cid) || cid.replace(/^nämnd-/, ''),
        data: {},
      })
    }
  }

  for (const node of nodes) {
    const cid = mergeMap.get(node.id)
    if (!cid) continue
    const c = canonicals.get(cid)
    if (!c) continue
    c.data.aliases = [...((c.data.aliases as string[]) || []), node.id]
  }

  const filteredNodes = nodes.filter((n) => !mergeMap.has(n.id))
  for (const [id, node] of canonicals) {
    const idx = filteredNodes.findIndex((n) => n.id === id)
    if (idx >= 0) filteredNodes[idx] = node
    else if (node.label) filteredNodes.push(node)
  }

  const rewrittenEdges = edges
    .map((e) => ({ ...e, from: mergeMap.get(e.from) || e.from, to: mergeMap.get(e.to) || e.to }))
    .filter((e) => e.from !== e.to)

  // Last resort for year-less nämnd-targets nobody created (a leder-edge to
  // a nämnd that never appears as an organisation node in any source, e.g.
  // arkivnämnden): synthesize a node from the slug rather than dropping the
  // edge at seed.
  const known = new Set(filteredNodes.map((n) => n.id))
  for (const e of rewrittenEdges) {
    for (const id of [e.from, e.to]) {
      if (known.has(id) || !id.match(/^nämnd-[^\d]+$/)) continue
      const label = id
        .replace(/^nämnd-/, '')
        .replace(/-/g, ' ')
        .replace(/^./, (c) => c.toUpperCase())
      filteredNodes.push({ id, typ: 'organisation', label, data: { syntetisk: true } })
      known.add(id)
    }
  }

  return { nodes: filteredNodes, edges: rewrittenEdges, mergeCount: mergeMap.size }
}
