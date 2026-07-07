import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { requireSchema, sql } from '../lib/db.js'

export const metricsRouter = new OpenAPIHono()

// --- Stats ---
const statsRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/stats',
  tags: ['Statistik'],
  summary: 'Övergripande statistik',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              kommun: z.string(),
              politiker: z.number(),
              partier: z.any(),
              graf: z.object({ nodes: z.number(), edges: z.number() }),
            })
            .openapi('Stats'),
        },
      },
      description: 'OK',
    },
  },
})
metricsRouter.openapi(statsRoute, async (c) => {
  const schema = requireSchema(c.req.valid('param').kommun)
  const [pol, parties, nodeCount, edgeCount] = await Promise.all([
    sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.politiker`,
    // Official KF mandatfördelning 2022 election (81 seats total)
    // Source: Valmyndigheten resultat 2022-09-11, Göteborgs kommunfullmäktige
    sql`SELECT parti, COUNT(DISTINCT id)::int as antal FROM ${sql(schema)}.politiker
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(uppdrag) u
          WHERE u->>'organisation' ILIKE '%Kommunfullmäktige%'
            AND u->>'roll' NOT ILIKE 'Ersättare%'
        )
        GROUP BY parti ORDER BY antal DESC`,
    sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_nodes`,
    sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_edges`,
  ])
  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      politiker: pol[0].total,
      // Official 2022 election results — Göteborgs kommunfullmäktige (Valmyndigheten 2022-09-11)
      partier: { S: 21, M: 14, V: 13, SD: 9, MP: 5, L: 5, D: 5, KD: 4, C: 5 },
      graf: { nodes: nodeCount[0].total, edges: edgeCount[0].total },
    },
    200,
  )
})

// --- Metrics ---
const metricsRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/metrics',
  tags: ['Statistik'],
  summary: 'Demokratiska nyckeltal',
  description:
    'Automatiskt beräknade KPI:er för kommunfullmäktige: beslutskraft, konsensus, partilojalitet, aktivitet.',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              kommun: z.string(),
              period: z.string(),
              beslutskraft: z.object({
                totalt: z.number(),
                bifall: z.number(),
                bordläggning: z.number(),
                beslutskraftProcent: z.number(),
                bordläggningsorsaker: z.any(),
              }),
              konsensus: z.object({
                totaltÄrenden: z.number(),
                utanVotering: z.number(),
                medVotering: z.number(),
                konsensusgradProcent: z.number(),
              }),
              aktivitet: z.object({
                jävsanmälningar: z.number(),
                reservationer: z.number(),
                yrkanden: z.number(),
              }),
              riceIndex: z.any(),
              röstÖverensstämmelse: z.object({
                partier: z.array(z.any()),
                matris: z.array(z.array(z.number().nullable())),
              }),
              närvaro: z.object({
                registreringar: z.number(),
                möten: z.number(),
                snittPerMöte: z.number(),
              }),
              debatt: z.object({
                giniKoefficient: z.number(),
                anföranden: z.number(),
                djupPerÄrende: z.number(),
                perÅr: z.array(z.any()),
              }),
              partilojalitet: z.any(),
            })
            .openapi('Metrics'),
        },
      },
      description: 'OK',
    },
  },
})
metricsRouter.openapi(metricsRoute, async (c) => {
  const schema = requireSchema(c.req.valid('param').kommun)
  // All metrics computed from edges — no JSONB scanning

  // Beslutskraft
  const beslutTyper =
    await sql`SELECT data->>'beslut' as typ, COUNT(*)::int as antal FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'beslut' IS NOT NULL GROUP BY data->>'beslut'`
  const totalBeslut = beslutTyper.reduce((s, r) => s + r.antal, 0)
  const bifall = beslutTyper.find((r) => r.typ === 'bifall')?.antal || 0
  const bordlagd = beslutTyper.find((r) => r.typ === 'bordläggning')?.antal || 0

  // Bordläggningsorsaker
  const bordOrsaker =
    await sql`SELECT data->>'bordläggningsorsak' as orsak, COUNT(*)::int as antal FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf' AND data->>'beslut' = 'bordläggning' AND data->>'bordläggningsorsak' IS NOT NULL GROUP BY data->>'bordläggningsorsak'`

  // Konsensus (paragraf nodes without any röstade edges = decided without vote)
  const [{ total: totalParagrafer }] =
    await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'paragraf'`
  const [{ antal: medVotering }] =
    await sql`SELECT COUNT(DISTINCT to_id)::int as antal FROM ${sql(schema)}.graf_edges WHERE typ LIKE 'röstade_%'`
  const utanVotering = totalParagrafer - medVotering

  // Parti-statistik from edges (SQL aggregation)
  const partiStats = await sql`
    SELECT
      n.data->>'parti' as parti,
      e.typ,
      COUNT(*)::int as antal
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id AND n.typ = 'politiker'
    WHERE e.typ LIKE 'röstade_%'
    GROUP BY n.data->>'parti', e.typ
    ORDER BY parti`

  // Aggregate per party
  const partier: Record<string, { ja: number; nej: number; avstår: number; total: number }> = {}
  for (const row of partiStats) {
    if (!partier[row.parti]) partier[row.parti] = { ja: 0, nej: 0, avstår: 0, total: 0 }
    partier[row.parti].total += row.antal
    if (row.typ === 'röstade_ja') partier[row.parti].ja += row.antal
    else if (row.typ === 'röstade_nej') partier[row.parti].nej += row.antal
    else if (row.typ === 'röstade_avstår') partier[row.parti].avstår += row.antal
  }

  // Jäv och reservationer
  const [{ antal: jävAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM ${sql(schema)}.graf_edges WHERE typ = 'jävsanmälan'`
  const [{ antal: resAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM ${sql(schema)}.graf_edges WHERE typ = 'reserverade_sig'`
  const [{ antal: yrkAntal }] =
    await sql`SELECT COUNT(*)::int as antal FROM ${sql(schema)}.graf_edges WHERE typ = 'yrkat'`

  // --- Rice Index per parti (avg across all voteringar) ---
  // For each votering, Rice = abs(ja - nej) / (ja + nej) per party
  const riceData = await sql`
    SELECT
      n.data->>'parti' as parti,
      e.to_id as paragraf_id,
      SUM(CASE WHEN e.typ = 'röstade_ja' THEN 1 ELSE 0 END)::int as ja,
      SUM(CASE WHEN e.typ = 'röstade_nej' THEN 1 ELSE 0 END)::int as nej
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id AND n.typ = 'politiker'
    WHERE e.typ LIKE 'röstade_%' AND e.typ != 'röstade_avstår'
    GROUP BY n.data->>'parti', e.to_id
    HAVING SUM(CASE WHEN e.typ IN ('röstade_ja','röstade_nej') THEN 1 ELSE 0 END) > 0`

  const ricePerParti: Record<string, { sum: number; count: number }> = {}
  for (const row of riceData) {
    const rice = row.ja + row.nej > 0 ? Math.abs(row.ja - row.nej) / (row.ja + row.nej) : 1
    if (!ricePerParti[row.parti]) ricePerParti[row.parti] = { sum: 0, count: 0 }
    ricePerParti[row.parti].sum += rice
    ricePerParti[row.parti].count++
  }
  const riceIndex = Object.fromEntries(
    Object.entries(ricePerParti).map(([p, d]) => [p, Math.round((d.sum / d.count) * 100) / 100]),
  )

  // --- Parti × parti röstöverensstämmelse (reuses riceData: ja/nej per parti per paragraf) ---
  // Per paragraf: each party's majority position (ja/nej), skip ties (no clear position).
  // Agreement between two parties = share of shared paragrafer where their majority matched.
  const positionerPerParagraf: Record<string, Record<string, 'ja' | 'nej'>> = {}
  for (const row of riceData) {
    if (row.ja === row.nej) continue
    if (!positionerPerParagraf[row.paragraf_id]) positionerPerParagraf[row.paragraf_id] = {}
    positionerPerParagraf[row.paragraf_id][row.parti] = row.ja > row.nej ? 'ja' : 'nej'
  }

  const parPar: Record<string, { överens: number; totalt: number }> = {}
  for (const positioner of Object.values(positionerPerParagraf)) {
    const partier = Object.keys(positioner)
    for (let i = 0; i < partier.length; i++) {
      for (let j = i + 1; j < partier.length; j++) {
        const [a, b] = [partier[i], partier[j]].sort()
        const key = `${a}|${b}`
        if (!parPar[key]) parPar[key] = { överens: 0, totalt: 0 }
        parPar[key].totalt++
        if (positioner[a] === positioner[b]) parPar[key].överens++
      }
    }
  }

  const röstÖverensstämmelsePartier = [...new Set(riceData.map((r) => r.parti))].sort()
  const röstÖverensstämmelse = {
    partier: röstÖverensstämmelsePartier,
    matris: röstÖverensstämmelsePartier.map((a) =>
      röstÖverensstämmelsePartier.map((b) => {
        if (a === b) return 1
        const [x, y] = [a, b].sort()
        const cell = parPar[`${x}|${y}`]
        return cell && cell.totalt > 0 ? Math.round((cell.överens / cell.totalt) * 100) / 100 : null
      }),
    ),
  }

  // --- Attendance Rate (närvarade edges: politiker → möte) ---
  const [{ total: totalNärvaro }] =
    await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_edges WHERE typ = 'närvarade'`
  const [{ total: totalMöten }] =
    await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'möte'`
  const snittNärvarande = totalMöten > 0 ? Math.round(totalNärvaro / totalMöten) : 0

  // --- Debate Participation Gini (from anförande nodes, grouped by politician name) ---
  // Procedurella mötesledar-inlägg exkluderas (mark-procedurella.ts) — annars
  // domineras fördelningen av presidiets "Tack X, ordet går till Y".
  const speechCounts = await sql`
    SELECT label, COUNT(*)::int as speeches
    FROM ${sql(schema)}.graf_nodes
    WHERE typ = 'anförande' AND COALESCE(data->>'procedurell', '') != 'true'
    GROUP BY label
    ORDER BY speeches DESC`

  // Extract politician name from label "Name (Party) — ..."
  const speakerCounts: Record<string, number> = {}
  for (const row of speechCounts) {
    const match = (row.label as string).match(/^(.+?)\s*\(/)
    const name = match ? match[1].trim() : row.label
    speakerCounts[name] = (speakerCounts[name] || 0) + row.speeches
  }

  let debateGini = 0
  const speakerValues = Object.values(speakerCounts).sort((a, b) => a - b)
  if (speakerValues.length > 1) {
    const n = speakerValues.length
    const mean = speakerValues.reduce((s, v) => s + v, 0) / n
    let sumDiff = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiff += Math.abs(speakerValues[i] - speakerValues[j])
      }
    }
    debateGini = Math.round((sumDiff / (2 * n * n * mean)) * 100) / 100
  }

  // --- Debate Depth (anföranden per ärende med votering) ---
  const [{ total: totalAnföranden }] =
    await sql`SELECT COUNT(*)::int as total FROM ${sql(schema)}.graf_nodes WHERE typ = 'anförande' AND COALESCE(data->>'procedurell', '') != 'true'`
  const debateDepth = medVotering > 0 ? Math.round((totalAnföranden / medVotering) * 10) / 10 : 0

  // Anföranden per år — for trend/sparkline (current year is partial)
  const anförandenPerÅr = await sql`
    SELECT substring(data->>'datum' from 1 for 4) as år, COUNT(*)::int as antal
    FROM ${sql(schema)}.graf_nodes
    WHERE typ = 'anförande' AND data->>'datum' IS NOT NULL
      AND COALESCE(data->>'procedurell', '') != 'true'
    GROUP BY 1 ORDER BY 1`

  return c.json(
    {
      kommun: c.req.valid('param').kommun,
      period: '2022-2026',
      beslutskraft: {
        totalt: totalBeslut,
        bifall,
        bordläggning: bordlagd,
        beslutskraftProcent: totalBeslut > 0 ? Math.round((bifall / totalBeslut) * 100) : 0,
        bordläggningsorsaker: Object.fromEntries(bordOrsaker.map((r) => [r.orsak, r.antal])),
      },
      konsensus: {
        totaltÄrenden: totalParagrafer,
        utanVotering,
        medVotering,
        konsensusgradProcent:
          totalParagrafer > 0 ? Math.round((utanVotering / totalParagrafer) * 100) : 0,
      },
      aktivitet: { jävsanmälningar: jävAntal, reservationer: resAntal, yrkanden: yrkAntal },
      riceIndex,
      röstÖverensstämmelse,
      närvaro: { registreringar: totalNärvaro, möten: totalMöten, snittPerMöte: snittNärvarande },
      debatt: {
        giniKoefficient: debateGini,
        anföranden: totalAnföranden,
        djupPerÄrende: debateDepth,
        perÅr: anförandenPerÅr.map((r) => ({ år: r.år, antal: r.antal })),
      },
      partilojalitet: Object.fromEntries(
        Object.entries(partier).map(([parti, d]) => [
          parti,
          { ...d, jaProcent: d.total > 0 ? Math.round((d.ja / d.total) * 100) : 0 },
        ]),
      ),
    },
    200,
  )
})
