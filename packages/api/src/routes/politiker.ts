import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  anförandenLinks,
  baseUrl,
  halCollection,
  halCollectionSchema,
  halResource,
  halResourceSchema,
  halResourceWithRelatedSchema,
  politikerLinks,
  politikerListLinks,
} from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { capLimit } from '../lib/helpers.js'

export const politikerRouter = new OpenAPIHono()

// --- Schemas ---
const PolitikerSummary = z
  .object({
    id: z.string().uuid(),
    namn: z.string(),
    parti: z.string(),
    email: z.string().nullable(),
    antalUppdrag: z.number(),
  })
  .openapi('PolitikerSummary')
const PolitikerList = halCollectionSchema(PolitikerSummary).openapi('PolitikerList')

const politikerRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker',
  tags: ['Politiker'],
  summary: 'Lista alla politiker',
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({ parti: z.string().optional(), limit: z.string().optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: PolitikerList } }, description: 'OK' },
  },
})
politikerRouter.openapi(politikerRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { parti, limit } = c.req.valid('query')
  const lim = capLimit(limit, 2000)
  const schema = requireSchema(kommun)
  const rows = parti
    ? await sql`SELECT * FROM ${sql(schema)}.politiker WHERE parti = ${parti.toUpperCase()} ORDER BY efternamn LIMIT ${lim}`
    : await sql`SELECT * FROM ${sql(schema)}.politiker ORDER BY efternamn LIMIT ${lim}`
  const [{ total }] = parti
    ? await sql`SELECT count(*)::int as total FROM ${sql(schema)}.politiker WHERE parti = ${parti.toUpperCase()}`
    : await sql`SELECT count(*)::int as total FROM ${sql(schema)}.politiker`
  const items = rows.map((p) => ({
    id: p.id,
    namn: `${p.fornamn} ${p.efternamn}`,
    parti: p.parti,
    email: p.email,
    uppdrag: p.uppdrag,
    antalUppdrag: (p.uppdrag as any[]).length,
    aktivSedan:
      (p.sociala as any)?.mandatperioder?.[0]?.period?.split('-')[0] ||
      ((p.uppdrag as any[]) || []).reduce((earliest: string | null, u: any) => {
        if (!u.från) return earliest
        const y = u.från.slice(0, 4)
        return !earliest || y < earliest ? y : earliest
      }, null),
    _links: politikerLinks(kommun, p.id),
  }))
  return c.json(halCollection(items, politikerListLinks(kommun), total), 200)
})

const PolitikerDetail = z.object({
  id: z.string(),
  namn: z.string(),
  parti: z.string(),
  email: z.string().nullable(),
  foto: z.any(),
  sociala: z.any(),
  uppdrag: z.any(),
})
const PolitikerDetailRelated = z.object({ möten: z.array(z.any()) })

const politikerDetailRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}',
  tags: ['Politiker'],
  summary: 'Enskild politiker med alla uppdrag',
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: halResourceWithRelatedSchema(PolitikerDetail, PolitikerDetailRelated).openapi(
            'PolitikerDetail',
          ),
        },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
politikerRouter.openapi(politikerDetailRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const [person] = await sql`SELECT * FROM ${sql(schema)}.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Möten where this politiker spoke (from talade_i edges)
  const rows = await sql`
    SELECT DISTINCT e.data->>'datum' as datum, n.label as mote
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
    WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i'
    ORDER BY datum DESC`

  const möten = rows.map((r) => ({
    datum: r.datum,
    möte: r.mote,
    _links: {
      anforanden: { href: `/api/v1/${kommun}/politiker/${id}/anforanden?datum=${r.datum}` },
      möte: { href: `/api/v1/${kommun}/möten/${r.datum}` },
    },
  }))

  const item = {
    id: person.id,
    namn: `${person.fornamn} ${person.efternamn}`,
    parti: person.parti,
    email: person.email,
    foto: person.foto,
    sociala: person.sociala,
    uppdrag: person.uppdrag,
  }

  return c.json(halResource(item, politikerLinks(kommun, id), { möten }), 200)
})

// --- Arvode ---
// Beräknar och returnerar ersättning för en enskild politiker.
// Datakällor:
//   1. Fast arvode (presidieuppdrag): arvoderas_enligt-edge i grafen,
//      beräknat vid seed-tid från Göteborgs Stads arvodesregler Bilaga 2.
//   2. Förrättningsarvode (mötesdeltagande): 1 640 kr per KF-möte (heldag),
//      baserat på registrerade röster (= närvaro vid votering).
//   3. Total ersättning = fast arvode/mån + ackumulerat förrättningsarvode.
// Källa: Göteborgs Stads regler för arvoden och ersättningar (KS 2025-12-10 §946)
const ArvodeItem = z.object({
  politiker: z.object({ id: z.string(), namn: z.string(), parti: z.string() }),
  grundarvode_kr: z.number(),
  fast_arvode_kr: z.number(),
  förrättningsarvode_kr: z.number(),
  antal_möten_deltog: z.number(),
  total_ersättning_kr: z.number(),
  källa: z.string(),
})

const arvodesRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}/arvode',
  tags: ['Politiker'],
  summary: 'Ersättning för förtroendevald — fast arvode + förrättningsarvode',
  description: `Beräknar total ersättning baserat på:
- Fast arvode: procent av grundarvodet (80 475 kr/mån 2026) beroende på ordförandeuppdrag
- Förrättningsarvode: 1 640 kr per KF-sammanträde (heldag) baserat på registrerad närvaro
- Källa: Göteborgs Stads regler för arvoden (KS 2025-12-10 §946, Bilaga 2)`,
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        'application/json': { schema: halResourceSchema(ArvodeItem).openapi('Arvode') },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
politikerRouter.openapi(arvodesRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)

  // Hämta politikerns grunddata
  const [person] = await sql`SELECT * FROM ${sql(schema)}.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  // Hämta arvodesedge: politiker-{uuid} → arvode-regler-2026
  // Denna edge innehåller all beräknad arvodesdata (skapas vid seed)
  const arvodesEdge = await sql`
    SELECT data FROM ${sql(schema)}.graf_edges
    WHERE from_id = ${`politiker-${id}`} AND typ = 'arvoderas_enligt'
    LIMIT 1`

  // Grunddata som alltid returneras oavsett om fast arvode finns
  const grundarvode = 80475 // 2026 (från PDF)
  const förrättningPerMöte = 1640 // heldag KF

  const arvodesLinks = {
    self: { href: `${baseUrl(kommun)}/politiker/${id}/arvode` },
    politiker: { href: `${baseUrl(kommun)}/politiker/${id}` },
  }

  if (arvodesEdge.length === 0) {
    // Politiker utan registrerad arvodesdata (ersättare som ej deltagit i votering)
    const item = {
      politiker: { id, namn: `${person.fornamn} ${person.efternamn}`, parti: person.parti },
      grundarvode_kr: grundarvode,
      fast_arvode_kr: 0,
      förrättningsarvode_kr: 0,
      antal_möten_deltog: 0,
      total_ersättning_kr: 0,
      källa: 'Göteborgs Stads regler för arvoden (KS 2025-12-10 §946)',
      notering: 'Ingen registrerad närvaro vid voteringar under perioden',
    }
    return c.json(halResource(item, arvodesLinks), 200)
  }

  const data = arvodesEdge[0].data as any
  const item = {
    politiker: { id, namn: `${person.fornamn} ${person.efternamn}`, parti: person.parti },
    grundarvode_kr: grundarvode,
    fast_arvode_kr: data.fast_arvode_kr || 0,
    förrättningsarvode_kr: data.förrättningsarvode_kr || 0,
    antal_möten_deltog: data.antal_möten_deltog || 0,
    total_ersättning_kr: data.total_ersättning_kr || data.fast_arvode_kr || 0,
    källa: 'Göteborgs Stads regler för arvoden (KS 2025-12-10 §946)',
  }
  return c.json(halResource(item, arvodesLinks, { detaljer: data.detaljer || [] }), 200)
})

// --- Profil (percentil-normerade nyckeltal för radar-diagrammet) ---
// Metodik: varje axel jämförs mot ALLA politiker med tillräckligt underlag
// för just den axeln (se MIN-trösklarna) — inte mot hela rostret på 734
// personer, där de flesta saknar graf-noder helt (se docs/ANALYS-2026-07.md,
// punkt 14). Perceniler räknas som andel av populationen med lägre-eller-lika
// råvärde, så en axel utan tillräckligt underlag för politikern själv
// returneras som `null` (inte 0 — annars ser "ingen data" ut som "sämst").
const MIN_MÖTEN_FÖR_DEBATTAKTIVITET = 3
const MIN_RÖSTER_FÖR_LOJALITET = 5
// Debattaktivitet räknar bara talade_i-edges till möte-noder (den andra
// representationen — edges till anforande-noder — beskriver samma inlägg och
// dubblerade annars alla tal), och exkluderar procedurella mötesledar-inlägg
// ("Tack X, ordet går till Y" — se mark-procedurella.ts och
// docs/ANALYS-2026-07.md, punkt 17). Taket är kvar som säkerhetsnät: värden
// över det behandlas som otillförlitligt underlag snarare än "mest aktiv".
const MAX_RIMLIG_DEBATTAKTIVITET = 20

const ProfilAxis = z.object({
  key: z.string(),
  label: z.string(),
  percentile: z.number().nullable(),
  rawLabel: z.string(),
  populationSize: z.number(),
})
const PolitikerProfil = z.object({
  politiker: z.object({ id: z.string(), namn: z.string(), parti: z.string() }),
  axes: z.array(ProfilAxis),
})

const profilRoute = createRoute({
  method: 'get',
  path: '/api/v1/{kommun}/politiker/{id}/profil',
  tags: ['Politiker'],
  summary:
    'Percentil-normerad profil (närvaro, debattaktivitet, initiativ, partilojalitet) för radardiagram',
  description: `Varje axel är en percentil (0–100) bland politiker med tillräckligt underlag:
- Närvaro: andel av samtliga sammanträden (alla organ) med registrerad närvaro
- Debattaktivitet: anföranden per sammanträde med närvaro (kräver ≥${MIN_MÖTEN_FÖR_DEBATTAKTIVITET} sammanträden)
- Initiativ: antal inlämnade motioner + yrkanden (rått antal — gynnar längre mandattid)
- Partilojalitet: andel egna ja/nej-röster som matchar partiets majoritet per paragraf (kräver ≥${MIN_RÖSTER_FÖR_LOJALITET} röster)`,
  request: { params: z.object({ kommun: z.string(), id: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: halResourceSchema(PolitikerProfil).openapi('PolitikerProfil'),
        },
      },
      description: 'OK',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ej hittad',
    },
  },
})
politikerRouter.openapi(profilRoute, async (c) => {
  const { id } = c.req.valid('param')
  const { kommun } = c.req.valid('param')
  const schema = requireSchema(kommun)
  const nodeId = `politiker-${id}`

  const [person] = await sql`SELECT * FROM ${sql(schema)}.politiker WHERE id = ${id}`
  if (!person) return c.json({ error: 'Politiker inte hittad' }, 404)

  const [{ n: totalMöten }] =
    await sql`SELECT count(*)::int as n FROM ${sql(schema)}.graf_nodes WHERE typ = 'möte'`

  // Per-politiker råtal: närvaro (distinkta möten), anföranden, initiativ
  const perPolitiker = await sql`
    SELECT
      n.id as politiker_id,
      COUNT(DISTINCT CASE WHEN e.typ = 'närvarade' THEN e.to_id END)::int as närvaro,
      COUNT(CASE WHEN e.typ = 'talade_i' AND e.to_id LIKE ${'möte-%'} AND COALESCE(e.data->>'procedurell', '') != 'true' THEN 1 END)::int as anföranden,
      COUNT(CASE WHEN e.typ IN ('inlämnade_motion', 'yrkat') THEN 1 END)::int as initiativ
    FROM ${sql(schema)}.graf_nodes n
    JOIN ${sql(schema)}.graf_edges e ON e.from_id = n.id
    WHERE n.typ = 'politiker'
    GROUP BY n.id`

  // Partiets majoritet per paragraf (samma metodik som röstöverensstämmelse i metrics.ts)
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

  const majoritetPerParagraf: Record<string, Record<string, 'ja' | 'nej'>> = {}
  for (const row of riceData) {
    if (row.ja === row.nej) continue
    if (!majoritetPerParagraf[row.paragraf_id]) majoritetPerParagraf[row.paragraf_id] = {}
    majoritetPerParagraf[row.paragraf_id][row.parti] = row.ja > row.nej ? 'ja' : 'nej'
  }

  // Individuella röster → jämför mot partiets majoritet för lojalitet
  const individuellaRöster = await sql`
    SELECT n.id as politiker_id, n.data->>'parti' as parti, e.to_id as paragraf_id, e.typ as röst
    FROM ${sql(schema)}.graf_edges e
    JOIN ${sql(schema)}.graf_nodes n ON n.id = e.from_id AND n.typ = 'politiker'
    WHERE e.typ IN ('röstade_ja', 'röstade_nej')`

  const lojalitetAgg: Record<string, { matchar: number; totalt: number }> = {}
  for (const row of individuellaRöster) {
    const majoritet = majoritetPerParagraf[row.paragraf_id]?.[row.parti as string]
    if (!majoritet) continue
    const mittRöst = row.röst === 'röstade_ja' ? 'ja' : 'nej'
    if (!lojalitetAgg[row.politiker_id]) lojalitetAgg[row.politiker_id] = { matchar: 0, totalt: 0 }
    lojalitetAgg[row.politiker_id].totalt++
    if (mittRöst === majoritet) lojalitetAgg[row.politiker_id].matchar++
  }

  interface Raw {
    närvaroRate: number | null
    debattaktivitet: number | null
    initiativ: number | null
    lojalitetPct: number | null
  }
  const rawByPolitiker: Record<string, Raw> = {}
  for (const row of perPolitiker) {
    const l = lojalitetAgg[row.politiker_id]
    const debattaktivitetRå =
      row.närvaro >= MIN_MÖTEN_FÖR_DEBATTAKTIVITET ? row.anföranden / row.närvaro : null
    rawByPolitiker[row.politiker_id] = {
      närvaroRate: totalMöten > 0 ? row.närvaro / totalMöten : null,
      debattaktivitet:
        debattaktivitetRå !== null && debattaktivitetRå <= MAX_RIMLIG_DEBATTAKTIVITET
          ? debattaktivitetRå
          : null,
      initiativ: row.närvaro > 0 ? row.initiativ : null,
      lojalitetPct: l && l.totalt >= MIN_RÖSTER_FÖR_LOJALITET ? (l.matchar / l.totalt) * 100 : null,
    }
  }

  function percentilAv(värden: number[], v: number) {
    if (värden.length === 0) return null
    const lägre = värden.filter((x) => x < v).length
    const lika = värden.filter((x) => x === v).length
    return Math.round(((lägre + lika / 2) / värden.length) * 100)
  }

  const axelNycklar = ['närvaroRate', 'debattaktivitet', 'initiativ', 'lojalitetPct'] as const
  const populationer: Record<(typeof axelNycklar)[number], number[]> = {
    närvaroRate: [],
    debattaktivitet: [],
    initiativ: [],
    lojalitetPct: [],
  }
  for (const raw of Object.values(rawByPolitiker)) {
    for (const key of axelNycklar) {
      const v = raw[key]
      if (v !== null) populationer[key].push(v)
    }
  }

  const målRaw = rawByPolitiker[nodeId] || {
    närvaroRate: null,
    debattaktivitet: null,
    initiativ: null,
    lojalitetPct: null,
  }

  const axelMeta: Record<
    (typeof axelNycklar)[number],
    { label: string; format: (v: number) => string }
  > = {
    närvaroRate: { label: 'Närvaro', format: (v) => `${Math.round(v * 100)}%` },
    debattaktivitet: { label: 'Debattaktivitet', format: (v) => `${v.toFixed(1)} anf./möte` },
    initiativ: { label: 'Initiativ', format: (v) => `${v} motioner/yrkanden` },
    lojalitetPct: { label: 'Partilojalitet', format: (v) => `${Math.round(v)}%` },
  }

  const axes = axelNycklar.map((key) => {
    const raw = målRaw[key]
    const percentile = raw !== null ? percentilAv(populationer[key], raw) : null
    return {
      key,
      label: axelMeta[key].label,
      percentile,
      rawLabel: raw !== null ? axelMeta[key].format(raw) : 'Otillräckligt underlag',
      populationSize: populationer[key].length,
    }
  })

  const item = {
    politiker: { id, namn: `${person.fornamn} ${person.efternamn}`, parti: person.parti },
    axes,
  }
  return c.json(
    halResource(item, {
      self: { href: `${baseUrl(kommun)}/politiker/${id}/profil` },
      politiker: { href: `${baseUrl(kommun)}/politiker/${id}` },
    }),
    200,
  )
})

// Anföranden per politiker (from talade_i edges). Procedurella
// mötesledar-inlägg ("Tack X, ordet går till Y") exkluderas — för presidiet
// dränkte de annars de riktiga anförandena tusenfalt (se mark-procedurella.ts).
politikerRouter.get('/api/v1/:kommun/politiker/:id/anforanden', async (c) => {
  const kommun = c.req.param('kommun')
  const schema = requireSchema(kommun)
  const id = c.req.param('id')
  const datum = c.req.query('datum')
  const rows = datum
    ? await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i' AND e.data->>'datum' = ${datum}
          AND COALESCE(e.data->>'procedurell', '') != 'true'
        ORDER BY (e.data->>'ordning')::int`
    : await sql`
        SELECT e.data, n.label as mote, n.data->>'datum' as datum
        FROM ${sql(schema)}.graf_edges e
        JOIN ${sql(schema)}.graf_nodes n ON n.id = e.to_id
        WHERE e.from_id = ${`politiker-${id}`} AND e.typ = 'talade_i'
          AND COALESCE(e.data->>'procedurell', '') != 'true'
        ORDER BY (e.data->>'datum') DESC, (e.data->>'ordning')::int`
  const items = rows.map((r) => {
    const d = (r.data as any) || {}
    return {
      datum: r.datum,
      möte: r.mote,
      ärende: d.ärende,
      ärendeTitel: d.ärendeTitel,
      text: d.text,
      ordning: d.ordning,
      _links: { möte: { href: `${baseUrl(kommun)}/möten/${r.datum}` } },
    }
  })
  return c.json(halCollection(items, anförandenLinks(kommun, 'politiker', id, datum || undefined)))
})
