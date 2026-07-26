import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { baseUrl } from '../hal.js'
import { requireSchema, sql } from '../lib/db.js'
import { heltalParam, standardFel, valideringsHook } from '../lib/openapi.js'

export const sokRouter = new OpenAPIHono({ defaultHook: valideringsHook })

// --- Konstanter ---

const UTDRAG_MAX = 300
// StartSel/StopSel tomma: ts_headline markerar annars träffen med <b>-taggar,
// vilket är fel i ett JSON-API (klienten får HTML den inte bett om).
const HEADLINE =
  'MaxWords=34,MinWords=14,MaxFragments=1,ShortWord=2,StartSel="",StopSel="",FragmentDelimiter=" … "'

const TRÄFFTYPER = ['beslut', 'politiker', 'dokument', 'forvaltning', 'anforande'] as const
type Träfftyp = (typeof TRÄFFTYPER)[number]

// Skyddsgränser för frågan. Varje ord blir en egen tsquery-gren (exakt +
// prefix) som ORas in i fem källfrågor, så kostnaden växer linjärt med
// antalet ord: en fråga på 8 000 tecken tog 5,6 sekunder CPU innan taken
// fanns, vilket räckte för att sänka API:t inom rate-limit-budgeten
// (200 req/min i produktion).
const Q_MAX_TECKEN = 200
const MAX_ORD = 12

// --- Hjälpare ---

/**
 * Byter styrtecken mot blanksteg.
 *
 * De kan inte matcha någon lexem, men NUL får Postgres att avbryta frågan
 * ("unsupported Unicode escape sequence") — ett rent klientfel som blev 500.
 * Teckenkoder i stället för regex: biome tillåter inte styrtecken i
 * reguljära uttryck (noControlCharactersInRegex).
 */
function rensaStyrtecken(text: string): string {
  let ut = ''
  for (const tecken of text) {
    const kod = tecken.codePointAt(0) ?? 0
    ut += kod < 0x20 || kod === 0x7f ? ' ' : tecken
  }
  return ut.trim()
}

/** Ord ur frågan (≥2 tecken, max MAX_ORD st) — grunden för OR-sökningen. */
function termer(q: string): string[] {
  const ord = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
  return (ord.length > 0 ? ord : [q.trim()]).slice(0, MAX_ORD)
}

/**
 * Minsta lexemlängd för prefixmatchning. Tröskeln gäller ordets *stam*, inte
 * det skrivna ordet: "varor" stammas till 'var', och `'var':*` matchar
 * vara/varit/varje/variant — ren brusgenerator. "bojkott" → 'bojkot' (6) och
 * "upphandling" → 'upphandling' är däremot specifika nog.
 */
const PREFIX_MIN_LEXEM = 5

/**
 * Vilka av frågans ord som ska prefixmatchas.
 *
 * Svenska stemmern delar inte sammansättningar: "bojkott" matchar inte
 * "bojkottbeslutet" och "upphandling" inte "upphandlingsnämnden", trots att
 * det är samma sak. Prefixmatchning (`'bojkot':*`) täcker det — fortfarande
 * ren textmatchning, ingen fuzzy/semantisk sökning.
 *
 * Stammen hämtas från Postgres (samma `swedish`-konfiguration som indexen)
 * i stället för att gissas i JS. Ord som ger flera lexem — datum som
 * "2024-06-13" → `'2024' & '-06' & '-13'` — prefixas inte: `:*` skulle hamna
 * på det sista, korta lexemet och matcha allt som börjar med "-13".
 */
export async function prefixbaraOrd(ord: string[]): Promise<Set<string>> {
  const rader = await sql<{ ord: string; tq: string }[]>`
    SELECT o AS ord, plainto_tsquery('swedish', o)::text AS tq
    FROM unnest(${ord}::text[]) AS o`
  const ok = new Set<string>()
  for (const r of rader) {
    // Textformen är t.ex. `'bojkot'` för ett lexem, `'2024' & '-06'` för flera.
    const lexem = r.tq.match(/^'((?:[^']|'')*)'$/)?.[1]
    if (lexem && lexem.replace(/''/g, "'").length >= PREFIX_MIN_LEXEM) ok.add(r.ord)
  }
  return ok
}

/** Ett ord som tsquery — exakt, eller prefixmatchat när stammen är lång nog. */
function ordQuery(ord: string, prefix: boolean) {
  const exakt = sql`plainto_tsquery('swedish', ${ord})`
  if (!prefix) return exakt
  // Stoppord ger tom tsquery — ''::tsquery || x fungerar, men ('':*)::tsquery
  // är ett syntaxfel, därav CASE-uttrycket. Prefixfrågan byggs genom att kasta
  // plainto_tsquerys egen textform och lägga på `:*`, i stället för att sätta
  // ihop tsquery-syntax av användarens sträng: citering och escapening görs då
  // av Postgres, inte av oss.
  return sql`CASE WHEN ${exakt}::text = '' THEN ''::tsquery
    ELSE (${exakt}::text || ':*')::tsquery END`
}

/**
 * OR-tsquery av frågans ord: `ord1 || ord2 …`.
 *
 * Varför OR och inte plainto_tsquery(q) (som är AND): "Israel bojkott" ska
 * hitta bojkottbesluten även om ordet "Israel" aldrig står i protokollet —
 * med AND-semantik blir svaret tomt och användaren tror att data saknas.
 * AND-varianten (exakta ord) används i stället som rankningssignal (`alla`
 * nedan), så exakta träffar hamnar över prefixträffar.
 */
function orQuery(ord: string[], prefix: Set<string>) {
  const inner = ord
    .slice(1)
    .reduce(
      (acc, t) => sql`${acc} || ${ordQuery(t, prefix.has(t))}`,
      ordQuery(ord[0], prefix.has(ord[0])),
    )
  // Parenteserna är nödvändiga: fragmentet inlinas rått, och `@@` binder
  // hårdare än `||` — utan dem parsas `vec @@ q1 || q2` som `(vec @@ q1) || q2`
  // (boolean || tsquery → syntaxfel).
  return sql`(${inner})`
}

function klippUtdrag(text: string | null | undefined): string {
  if (!text) return ''
  const rensad = text.replace(/\s+/g, ' ').trim()
  if (rensad.length <= UTDRAG_MAX) return rensad
  const kap = rensad.slice(0, UTDRAG_MAX - 1)
  const sista = kap.lastIndexOf(' ')
  return `${(sista > UTDRAG_MAX * 0.6 ? kap.slice(0, sista) : kap).trimEnd()}…`
}

function organAvId(id: string): 'kf' | 'ks' | 'namnd' {
  if (id.startsWith('kf-')) return 'kf'
  if (id.startsWith('ks-')) return 'ks'
  return 'namnd'
}

interface Träff {
  typ: Träfftyp
  organ: 'kf' | 'ks' | 'namnd' | null
  id: string
  titel: string
  datum: string | null
  parti: string | null
  utdrag: string
  score: number
  /** Frontend-sida (inte API-resurs) — direkt länkbar. null när sidan saknas. */
  url: string | null
  /** Satt när träffen hittades via en annan nod (grafexpansion), se nedan. */
  via?: {
    id: string
    typ: 'revision'
    relation: 'hänvisar_till' | 'behandlad_i'
    label: string | null
  }
  _links: { self: { href: string } }
  // Internt före scoring, tas bort i svaret
  _rank?: number
  _alla?: boolean
}

/**
 * Frontend-URL per träfftyp — sidorna finns i packages/web/src/pages.
 * null när träfftypen inte har någon publicerad sida; klienten får då följa
 * `_links.self` till API-resursen i stället. Att peka `url` på API:t hade
 * gett en länk som 404:ar i webbläsaren.
 */
function webbUrl(kommun: string, typ: Träfftyp, id: string, datum?: string | null): string | null {
  switch (typ) {
    case 'beslut':
      return `/${kommun}/beslut/${encodeURIComponent(id)}`
    case 'politiker':
      return `/${kommun}/politiker/${id}`
    case 'forvaltning':
      return `/${kommun}/forvaltning/${encodeURIComponent(id)}`
    case 'anforande':
      // Anföranden har ingen egen sida — mötessidan listar dem.
      return datum ? `/${kommun}/kf/moten/${datum}` : `/${kommun}/kf/moten`
    case 'dokument':
      // Dokument (begäran om allmän handling) har ingen frontend-sida i dag.
      return null
  }
}

function apiUrl(kommun: string, typ: Träfftyp, id: string, datum?: string | null): string {
  const base = baseUrl(kommun)
  switch (typ) {
    case 'beslut':
      return `${base}/beslut/${encodeURIComponent(id)}`
    case 'politiker':
      return `${base}/politiker/${id}`
    case 'forvaltning':
      return `${base}/forvaltningar/${encodeURIComponent(id)}`
    case 'anforande':
      return datum ? `${base}/möten/${datum}/anföranden` : `${base}/möten`
    case 'dokument':
      return `${base}/dokument/${encodeURIComponent(id)}`
  }
}

// --- Route ---

const TräffSchema = z.object({
  typ: z.enum(TRÄFFTYPER),
  organ: z.enum(['kf', 'ks', 'namnd']).nullable().openapi({
    description:
      'Beslutande organ. null för träfftyper som inte tillhör ett organ (`politiker`, `dokument`).',
  }),
  id: z.string(),
  titel: z.string(),
  datum: z.string().nullable(),
  parti: z.string().nullable().openapi({
    description:
      'Parti för politiker- och anförandeträffar. För beslutsträffar ekar fältet det tillämpade `parti`-filtret (partiet vars ledamöter röstat/yrkat/talat i ärendet) — null när inget filter angetts.',
  }),
  utdrag: z.string(),
  score: z.number().openapi({
    description:
      'Relevans 0–1, relativ inom svaret (normaliserad mot svarets högsta ts_rank) — jämför inte score mellan två olika sökningar.',
  }),
  url: z.string().nullable().openapi({
    description:
      'Frontend-sida för träffen. null för `dokument`, som inte har någon publicerad sida — följ `_links.self` i stället.',
  }),
  via: z
    .object({
      id: z.string(),
      typ: z.literal('revision'),
      relation: z.enum(['hänvisar_till', 'behandlad_i']),
      label: z.string().nullable(),
    })
    .optional()
    .openapi({
      description:
        'Satt när träffen kom med via grafexpansion i stället för en textträff: `id` är noden som matchade och `relation` kanten dit.',
    }),
  _links: z.object({ self: z.object({ href: z.string() }) }),
})

const sökRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/sök',
  operationId: 'search',
  tags: ['Sök'],
  summary: 'Fritextsökning över beslut, politiker, dokument, förvaltningar och anförandemetadata',
  description: `Fulltextsökning (PostgreSQL \`swedish\`-konfiguration) över hela korpusen i ett anrop.

**Träfftyper** (\`typ\`) och vad som är indexerat per typ:

| typ | indexerad text | \`url\` |
|---|---|---|
| \`beslut\` | rubrik + protokollets fulltext (KF/KS-paragrafer) | beslutssidan |
| \`politiker\` | namn, parti, uppdrag | politikersidan |
| \`dokument\` | titel + fulltext (allmänna handlingar) | null — sida saknas |
| \`forvaltning\` | förvaltning, nämnd, revisionsanmärkningar, revisionsrapporter | förvaltningssidan |
| \`anforande\` | talare, ärenderubrik och talets ordagranna text (yttrandeprotokollen) | mötessidan |

För anföranden är \`utdrag\` ett citat ur själva inlägget. Hela inlägget och
dess talarkoppling hämtas via \`/v1/{kommun}/möten/{datum}/anföranden\` (som
också har \`?q=\` och \`?talare=\` inom ett möte).

**Filtret \`organ\`** gäller alla träfftyper, inte bara beslut:

| organ | ger |
|---|---|
| \`kf\` | \`beslut\` (kf-paragrafer) + \`anforande\` |
| \`ks\` | \`beslut\` (ks-paragrafer) |
| \`namnd\` | \`forvaltning\` + \`dokument\` |
| \`all\` (default) | allt, inklusive \`politiker\` |

En politiker tillhör inget organ och faller därför bort så snart \`organ\`
efterfrågas explicit. Samma sak gäller \`parti\`: bara \`beslut\`, \`politiker\`
och \`anforande\` har partikoppling, och datumfilter (\`från\`/\`till\`) utesluter
de datumlösa typerna \`politiker\` och \`forvaltning\`. Kombinationer som
utesluter varandra ger \`200\` med \`total: 0\`, inte fel.

**Nämndnivå:** nämndbeslut finns inte som egna \`beslut\`-objekt (bara KF/KS
protokollförs som paragrafer). De träffas i stället som \`forvaltning\` via
revisionsanmärkningarnas fritext — t.ex. inköps- och upphandlingsnämndens
bojkottbeslut 2024-06-13.

**Grafexpansion:** när en revisionsanmärkning matchar följs dess
\`hänvisar_till\`/\`behandlad_i\`-kanter till berörda KF-beslut, som läggs till
med \`via\` ifyllt. Det gör att t.ex. revisionsberättelsen som beviljade
ansvarsfrihet hittas även om själva sökordet inte står i dess text.

**Ordlogik:** orden ORas (delträff ger träff); träffar som innehåller *alla*
ord exakt rankas högre. \`score\` är relativ inom svaret (0–1), inte ett
absolut mått.

**Prefixmatchning (sammansatta ord):** stemmern (\`swedish\`) delar inte
sammansättningar, så ord vars stam är minst 5 tecken matchas även som prefix.
\`bojkott\` hittar därför "bojkottbeslutet", \`upphandling\` hittar
"upphandlingsnämnden", och en påbörjad sökning (\`upphandlingsn\`) fungerar.
Kortare stammar prefixas inte — "varor" → \`'var'\` hade matchat
vara/varit/varje och dränkt resultatet. Ord som ger flera lexem (datum som
\`2024-06-13\`) prefixas inte heller.

**Kvarstående begränsning:** motsatt riktning fungerar inte — skriver man hela
sammansättningen medan korpusen bara har delarna ger det noll träffar
(\`jävsanmälan\` → 0, medan \`jäv\` ger 100). Det kräver ordledsdelning, som
ligger utanför v1.

**Paginering och \`total\`:** \`total\` är exakt — hela träffmängden rankas i
databasen och räknas med \`count(*)\`, varefter sidan skärs ut med
\`limit\`/\`offset\`. Pagineringen är därför stabil hela vägen genom resultatet
(inget dolt fönster), och \`_links.next\`/\`prev\` finns så länge det finns
fler sidor.

**Svarsformat:** till skillnad från API:ets övriga listor använder \`/sök\` inte
HAL-konventet (\`_embedded.items\`) utan en platt \`resultat\`-array — träffarna
är blandade resurstyper, inte en samling av en typ, och varje träff bär sin
egen \`_links.self\` till rätt API-resurs.

**Tomt resultat** ger \`200\` med \`total: 0\` och \`resultat: []\` — aldrig 404.`,
  request: {
    params: z.object({ kommun: z.string() }),
    query: z.object({
      q: z
        .string()
        .min(2)
        .max(Q_MAX_TECKEN)
        .openapi({
          description: `Fritextfråga, ${2}–${Q_MAX_TECKEN} tecken. Högst ${MAX_ORD} ord används; överskjutande ord ignoreras.`,
          example: 'Israel bojkott',
        }),
      typ: z.enum(TRÄFFTYPER).optional().openapi({ description: 'Begränsa till en träfftyp' }),
      organ: z.enum(['kf', 'ks', 'namnd', 'all']).optional().openapi({
        description:
          'Beslutande organ, default `all`. `kf` → beslut + anföranden, `ks` → beslut, `namnd` → förvaltningar + dokument (nämndnivå). Se tabellen i endpointbeskrivningen.',
      }),
      parti: z.string().optional().openapi({
        description:
          'Partibeteckning, t.ex. `C`. Begränsar till träffar med partikoppling: politiker i partiet, beslut där partiets ledamöter röstat/yrkat/talat, samt partiets anföranden. Dokument- och förvaltningsträffar saknar partikoppling och faller bort.',
      }),
      från: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .openapi({ description: 'Datum från (ISO 8601, YYYY-MM-DD)', example: '2024-01-01' }),
      // ASCII-alias: `från` måste procent-kodas i en query string (curl kodar
      // sökvägen men inte parametrarna, så ett rått å ger 400 från Node innan
      // förfrågan ens når routern). `fran` gör exemplen kopierbara.
      fran: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .openapi({ description: 'Alias för `från` (ASCII, slipper procent-kodning)' }),
      till: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .openapi({ description: 'Datum till (ISO 8601, YYYY-MM-DD)', example: '2024-12-31' }),
      limit: heltalParam('Antal träffar per sida, default 20, max 100 (större värden kapas)', 1),
      offset: heltalParam('Paginering, default 0'),
    }),
  },
  responses: {
    ...standardFel,
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              query: z.string(),
              total: z.number().openapi({
                description:
                  'Exakt antal träffar för frågan och filtren (count(*) över hela träffmängden, inte bara sidan). Paginera med limit/offset — hela listan är sorterad innan sidan skärs ut.',
              }),
              resultat: z.array(TräffSchema),
              _links: z
                .object({
                  self: z.object({ href: z.string() }),
                  next: z.object({ href: z.string() }).optional(),
                  prev: z.object({ href: z.string() }).optional(),
                })
                .openapi({ description: 'next/prev finns bara när det finns fler sidor.' }),
            })
            .openapi('Sökresultat'),
        },
      },
      description: 'OK',
    },
    400: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Ogiltig parameter',
    },
  },
})

sokRouter.openapi(sökRoute, async (c) => {
  const { kommun } = c.req.valid('param')
  const { q: råQ, typ, organ, parti, till, limit, offset } = c.req.valid('query')
  const från = c.req.valid('query').från ?? c.req.valid('query').fran
  const schema = requireSchema(kommun)

  const lim = Math.min(Math.max(Number.parseInt(limit || '20') || 20, 1), 100)
  const off = Math.max(Number.parseInt(offset || '0') || 0, 0)
  const org = organ || 'all'
  // Partibeteckningar lagras versalt ('C', 'MP'); normaliseras som i
  // /politiker och /kandidater så att parti=c ger samma svar som parti=C.
  const part = parti?.toUpperCase()
  const q = rensaStyrtecken(råQ)
  const ord = termer(q)
  const prefixOrd = await prefixbaraOrd(ord)
  const orQ = orQuery(ord, prefixOrd)
  const andQ = sql`plainto_tsquery('swedish', ${q})`
  const harDatumfilter = Boolean(från || till)

  // Vilka träfftyper som är aktuella givet typ- och organfiltret.
  //
  // organ gällde tidigare bara beslut, så ?organ=kf svarade med dokument och
  // anföranden också — filtret såg ut att fungera men gjorde ingenting för
  // fyra av fem träfftyper. Kopplingen typ ↔ organ:
  //   kf    → beslut (kf-paragrafer) + anföranden (yttrandeprotokoll är KF)
  //   ks    → beslut (ks-paragrafer)
  //   namnd → forvaltning + dokument (nämnd-/förvaltningsnivå)
  //   all   → allt, inklusive politiker (en person tillhör inget organ och
  //           faller därför bort så snart ett organ efterfrågas)
  const vill = (t: Träfftyp) => {
    if (typ && typ !== t) return false
    if (org === 'kf') return t === 'beslut' || t === 'anforande'
    if (org === 'ks') return t === 'beslut'
    if (org === 'namnd') return t === 'forvaltning' || t === 'dokument'
    return true
  }
  // Datumlösa träfftyper faller bort när ett datumintervall angetts — annars
  // skulle "vad hände 2024?" returnera politiker och förvaltningar utan att
  // filtret betydde något för dem.
  const villMedDatum = (t: Träfftyp) => vill(t) && !harDatumfilter

  // Förvaltningsnivåns fritext: revisionsanmärkningarnas brister/konsekvens,
  // revisionsrapporternas sammanfattning och nämnd-/förvaltningsnamn.
  const hayFörvaltning = sql`(
    n.label || ' '
    || coalesce(n.data->>'förvaltning', '') || ' '
    || coalesce(n.data->>'nämnd', '') || ' '
    || coalesce(n.data->>'konsekvens', '') || ' '
    || coalesce(n.data->>'sammanfattning', '') || ' '
    || regexp_replace(coalesce(n.data->>'brister', ''), '[\\[\\]"]', ' ', 'g')
  )`

  // ── Fas 1: en enda fråga som rankar, räknar och paginerar ──────────────
  //
  // Tidigare kördes en fråga per träfftyp med LIMIT 100, varefter JS slog ihop
  // och rankade om. Det gav två fel som inte gick att dokumentera bort:
  // `total` var kapad (100 per typ, alltså ofta en bråkdel av sanningen) och
  // paginering bortom fönstret gav tom sida trots att träffar fanns. Nu är
  // alla källor grenar i en UNION, score räknas i SQL (max(rank) OVER () ger
  // samma normalisering som JS gjorde), `count(*) OVER ()` ger exakt total och
  // LIMIT/OFFSET arbetar på den kompletta, sorterade listan.
  //
  // Utdrag (ts_headline) hämtas i fas 2, bara för radernas som faktiskt
  // returneras — annars hade varje träff i korpusen kostat en headline.

  const organFilter =
    org === 'kf' ? sql`AND n.id LIKE 'kf-%'` : org === 'ks' ? sql`AND n.id LIKE 'ks-%'` : sql``
  // Partikoppling för beslut: individuell votering/yrkande/reservation/jäv
  // ELLER anförande (anförande --talade_i-- politiker, --diskuterade-- beslut).
  const partiFilterBeslut = part
    ? sql`AND (
        EXISTS (
          SELECT 1 FROM ${sql(schema)}.graf_edges pe
          JOIN ${sql(schema)}.graf_nodes p ON p.id = pe.from_id AND p.typ = 'politiker'
          WHERE pe.to_id = n.id AND p.data->>'parti' = ${part}
            AND (pe.typ LIKE 'röstade%' OR pe.typ IN ('yrkat', 'reserverade_sig', 'jävsanmälan'))
        )
        OR EXISTS (
          SELECT 1 FROM ${sql(schema)}.graf_edges de
          JOIN ${sql(schema)}.graf_edges te ON te.to_id = de.from_id AND te.typ = 'talade_i'
          JOIN ${sql(schema)}.graf_nodes p2 ON p2.id = te.from_id AND p2.typ = 'politiker'
          WHERE de.to_id = n.id AND de.typ = 'diskuterade' AND p2.data->>'parti' = ${part}
        )
      )`
    : sql``

  const hayPolitiker = sql`(p.fornamn || ' ' || p.efternamn || ' ' || p.parti || ' ' || coalesce(p.uppdrag::text, ''))`
  const namnPolitiker = sql`(p.fornamn || ' ' || p.efternamn || ' ' || p.parti)`
  const hayDokument = sql`(d.titel || ' ' || d.innehall)`

  // Grenar: tom lista = träfftypen är bortfiltrerad. sql`` går inte att
  // UNION:a bort, så grenarna byggs som fragment och fogas ihop nedan.
  const grenar = [] as ReturnType<typeof sql>[]

  if (vill('beslut')) {
    grenar.push(sql`
      SELECT 'beslut' AS typ, n.id, n.label AS titel, n.data->>'datum' AS datum,
        ts_rank(n.fts, ${orQ}, 1) AS rank, (n.fts @@ ${andQ}) AS alla,
        ${part ?? null}::text AS parti, n.id AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM ${sql(schema)}.graf_nodes n
      WHERE n.typ = 'paragraf' AND n.fts @@ ${orQ}
        ${organFilter}
        ${från ? sql`AND n.data->>'datum' >= ${från}` : sql``}
        ${till ? sql`AND n.data->>'datum' <= ${till}` : sql``}
        ${partiFilterBeslut}`)
  }

  if (villMedDatum('politiker')) {
    // Matchning mot namn + parti + uppdrag (så "Johanna Azar inköp" hittar
    // henne via nämnduppdraget), men rankningen tar det bästa av namnet och
    // helheten: med uppdragen inne blir dokumentet långt, och
    // längdnormaliseringen tryckte ner en exakt namnträff under de korta
    // anförandeetiketterna med samma namn.
    grenar.push(sql`
      SELECT 'politiker' AS typ, p.id::text AS id,
        p.fornamn || ' ' || p.efternamn || ' (' || p.parti || ')' AS titel,
        NULL::text AS datum,
        greatest(
          ts_rank(to_tsvector('swedish', ${namnPolitiker}), ${orQ}, 1),
          ts_rank(to_tsvector('swedish', ${hayPolitiker}), ${orQ}, 1)
        ) AS rank,
        (to_tsvector('swedish', ${hayPolitiker}) @@ ${andQ}) AS alla,
        p.parti AS parti, p.id::text AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM ${sql(schema)}.politiker p
      WHERE to_tsvector('swedish', ${hayPolitiker}) @@ ${orQ}
        ${part ? sql`AND p.parti = ${part}` : sql``}`)
  }

  if (vill('dokument') && !part) {
    grenar.push(sql`
      SELECT 'dokument' AS typ, d.id, d.titel, d.datum,
        ts_rank(to_tsvector('swedish', ${hayDokument}), ${orQ}, 1) AS rank,
        (to_tsvector('swedish', ${hayDokument}) @@ ${andQ}) AS alla,
        NULL::text AS parti, d.id AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM ${sql(schema)}.dokument d
      WHERE to_tsvector('swedish', ${hayDokument}) @@ ${orQ}
        ${från ? sql`AND d.datum >= ${från}` : sql``}
        ${till ? sql`AND d.datum <= ${till}` : sql``}`)
  }

  if (vill('forvaltning') && !part && !harDatumfilter) {
    // Nämndbeslut protokollförs inte som paragraf-noder; de finns som fritext
    // i revisionsanmärkningarnas brister/konsekvens. Träffen presenteras som
    // förvaltningen (direktörens sida), medan kall_id är noden som matchade —
    // fas 2 bygger utdraget ur den.
    grenar.push(sql`
      SELECT 'forvaltning' AS typ, f.direktor_id AS id,
        coalesce(f.forvaltning, f.namnd, f.label) AS titel, NULL::text AS datum,
        f.rank, f.alla, NULL::text AS parti, f.id AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM (
        SELECT DISTINCT ON (n.id) n.id, n.label,
          n.data->>'nämnd' AS namnd,
          coalesce(d.id, CASE WHEN n.typ = 'förvaltningsdirektör' THEN n.id END) AS direktor_id,
          d.data->>'förvaltning' AS forvaltning,
          ts_rank(to_tsvector('swedish', ${hayFörvaltning}), ${orQ}, 1) AS rank,
          (to_tsvector('swedish', ${hayFörvaltning}) @@ ${andQ}) AS alla
        FROM ${sql(schema)}.graf_nodes n
        LEFT JOIN ${sql(schema)}.graf_edges e_ansv
          ON e_ansv.from_id = n.id AND e_ansv.typ = 'ansvarig'
        LEFT JOIN ${sql(schema)}.graf_edges e_avser
          ON e_avser.from_id = n.id AND e_avser.typ IN ('avser', 'riktas_mot')
        LEFT JOIN ${sql(schema)}.graf_edges e_leder
          ON e_leder.to_id = e_avser.to_id AND e_leder.typ = 'leder'
        LEFT JOIN ${sql(schema)}.graf_nodes d
          ON d.id = coalesce(e_ansv.to_id, e_leder.from_id,
                             CASE WHEN n.typ = 'förvaltningsdirektör' THEN n.id END)
          AND d.typ = 'förvaltningsdirektör'
        WHERE n.typ IN ('förvaltningsdirektör', 'revision', 'revisionsrapport')
          AND to_tsvector('swedish', ${hayFörvaltning}) @@ ${orQ}
        ORDER BY n.id, rank DESC
      ) f
      WHERE f.direktor_id IS NOT NULL`)
  }

  if (vill('anforande')) {
    // Två grenar (etikett respektive talets text) i stället för ett OR över
    // join:en, så att båda GIN-indexen används. DISTINCT ON i best-steget
    // väljer den som rankade högst.
    // Partiet slås INTE upp här utan i fas 2, för sidans rader. Som korrelerad
    // subquery per kandidatrad kostade det ~1,5 s på breda frågor (tusentals
    // anföranden × två uppslag). Filtreras det på parti behövs kopplingen
    // förstås redan här — då som EXISTS mot graf-kanten eller protokollets
    // egen partiuppgift.
    const partiFilterAnf = part
      ? sql`AND (
          EXISTS (
            SELECT 1 FROM ${sql(schema)}.graf_edges te
            JOIN ${sql(schema)}.graf_nodes p ON p.id = te.from_id AND p.typ = 'politiker'
            WHERE te.to_id = n.id AND te.typ = 'talade_i' AND p.data->>'parti' = ${part}
          )
          OR EXISTS (
            SELECT 1 FROM ${sql(schema)}.anforande_text a2
            WHERE a2.id = n.id AND a2.parti = ${part}
          )
        )`
      : sql``
    grenar.push(sql`
      SELECT 'anforande' AS typ, n.id, n.label AS titel, n.data->>'datum' AS datum,
        ts_rank(n.fts, ${orQ}, 1) AS rank, (n.fts @@ ${andQ}) AS alla,
        NULL::text AS parti, n.id AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM ${sql(schema)}.graf_nodes n
      WHERE n.typ = 'anförande' AND n.fts @@ ${orQ}
        ${från ? sql`AND n.data->>'datum' >= ${från}` : sql``}
        ${till ? sql`AND n.data->>'datum' <= ${till}` : sql``}
        ${partiFilterAnf}`)
    grenar.push(sql`
      SELECT 'anforande' AS typ, n.id, n.label AS titel, a.datum,
        ts_rank(a.fts, ${orQ}, 1) AS rank, (a.fts @@ ${andQ}) AS alla,
        NULL::text AS parti, n.id AS kall_id,
        NULL::text AS via_id, NULL::text AS via_relation, NULL::text AS via_label
      FROM ${sql(schema)}.anforande_text a
      JOIN ${sql(schema)}.graf_nodes n ON n.id = a.id
      WHERE a.fts @@ ${orQ}
        ${från ? sql`AND a.datum >= ${från}` : sql``}
        ${till ? sql`AND a.datum <= ${till}` : sql``}
        ${partiFilterAnf}`)
  }

  // Grafexpansion: revisionsanmärkning → berörda KF-beslut. Revisionsberättelsen
  // som beviljade ansvarsfrihet nämner aldrig sakfrågan i sin text, men är
  // kopplad via behandlad_i — utan expansionen hittar man kritiken men inte hur
  // den hanterades. Rank * 0.4 så en expanderad träff aldrig slår en textträff.
  if (vill('beslut') && !part) {
    grenar.push(sql`
      SELECT 'beslut' AS typ, m.id, m.label AS titel, m.data->>'datum' AS datum,
        r.rank * 0.4 AS rank, false AS alla, NULL::text AS parti, m.id AS kall_id,
        r.id AS via_id, e.typ AS via_relation, e.label AS via_label
      FROM (
        SELECT n.id, ts_rank(to_tsvector('swedish', ${hayFörvaltning}), ${orQ}, 1) AS rank
        FROM ${sql(schema)}.graf_nodes n
        WHERE n.typ IN ('revision', 'revisionsrapport')
          AND to_tsvector('swedish', ${hayFörvaltning}) @@ ${orQ}
      ) r
      JOIN ${sql(schema)}.graf_edges e ON e.from_id = r.id
        AND e.typ IN ('hänvisar_till', 'behandlad_i')
      JOIN ${sql(schema)}.graf_nodes m ON m.id = e.to_id AND m.typ = 'paragraf'
      WHERE true
        ${org === 'kf' ? sql`AND m.id LIKE 'kf-%'` : org === 'ks' ? sql`AND m.id LIKE 'ks-%'` : sql``}
        ${från ? sql`AND m.data->>'datum' >= ${från}` : sql``}
        ${till ? sql`AND m.data->>'datum' <= ${till}` : sql``}`)
  }

  if (grenar.length === 0) {
    return c.json(
      {
        query: q,
        total: 0,
        resultat: [],
        _links: { self: { href: `${baseUrl(kommun)}/sök?q=${encodeURIComponent(q)}` } },
      },
      200,
    )
  }

  const union = grenar
    .slice(1)
    .reduce((acc, gren) => sql`${acc} UNION ALL (${gren})`, sql`(${grenar[0]})`)

  // Titelbonus: alla sökord i rubriken. En rubrikträff är nästan alltid det
  // användaren menade; brödtextträffar är ofta förbigående omnämnanden.
  const titelVillkor = ord
    .slice(1)
    .reduce(
      (acc, o) => sql`${acc} AND lower(b.titel) LIKE ${`%${o.toLowerCase()}%`}`,
      sql`lower(b.titel) LIKE ${`%${ord[0].toLowerCase()}%`}`,
    )

  // CTE:n bryts ut som fragment: sidfrågan och (vid tom sida) räknefrågan
  // måste bygga på exakt samma träffmängd.
  const cte = sql`
    kandidat AS (${union}),
    best AS (
      SELECT DISTINCT ON (typ, id) * FROM kandidat
      ORDER BY typ, id, (via_id IS NULL) DESC, alla DESC, rank DESC
    ),
    poang AS (
      SELECT b.*,
        round(
          least(
            1,
            (CASE WHEN ${ord.length === 1} THEN 0.6 WHEN b.alla THEN 0.72 ELSE 0.5 END)
            + 0.2 * b.rank / greatest(max(b.rank) OVER (), 1e-9)
            + (CASE WHEN ${titelVillkor} THEN 0.05 ELSE 0 END)
            + (CASE b.typ WHEN 'politiker' THEN 0.04 WHEN 'beslut' THEN 0.02
                          WHEN 'forvaltning' THEN 0.02 WHEN 'dokument' THEN 0.01 ELSE 0 END)
          )::numeric,
          4
        ) AS score
      FROM best b
    )`

  const rader = await sql<
    {
      typ: Träfftyp
      id: string
      titel: string
      datum: string | null
      parti: string | null
      kall_id: string
      via_id: string | null
      via_relation: string | null
      via_label: string | null
      score: string
      rank: string
      total: number
    }[]
  >`
    WITH ${cte}
    SELECT typ, id, titel, datum, parti, kall_id, via_id, via_relation, via_label,
      score, rank, count(*) OVER ()::int AS total
    FROM poang
    ORDER BY score DESC, rank DESC, datum DESC NULLS LAST, id
    LIMIT ${lim} OFFSET ${off}`

  // count(*) OVER () finns bara om sidan har rader — vid offset bortom slutet
  // måste totalen hämtas separat, annars rapporteras 0 träffar för en fråga
  // som i själva verket har hundratals.
  const total =
    rader[0]?.total ??
    (off > 0
      ? ((await sql<{ total: number }[]>`WITH ${cte} SELECT count(*)::int AS total FROM poang`)[0]
          ?.total ?? 0)
      : 0)

  // ── Fas 2: utdrag och detaljer, bara för sidans rader ──────────────────
  const idsPerTyp = (t: Träfftyp, nyckel: 'id' | 'kall_id' = 'id') => [
    ...new Set(rader.filter((r) => r.typ === t).map((r) => r[nyckel])),
  ]

  const beslutIds = idsPerTyp('beslut')
  const dokumentIds = idsPerTyp('dokument')
  const förvaltningKällor = idsPerTyp('forvaltning', 'kall_id')
  const anförandeIds = idsPerTyp('anforande')
  const politikerIds = idsPerTyp('politiker')

  const [beslutUtdrag, dokumentUtdrag, förvaltningUtdrag, anförandeDetaljer, politikerDetaljer] =
    await Promise.all([
      beslutIds.length > 0
        ? sql`SELECT id, ts_headline('swedish', coalesce(data->>'fulltext', label), ${orQ}, ${HEADLINE}) AS utdrag
            FROM ${sql(schema)}.graf_nodes WHERE id = ANY(${beslutIds})`
        : [],
      dokumentIds.length > 0
        ? sql`SELECT id, ts_headline('swedish', innehall, ${orQ}, ${HEADLINE}) AS utdrag
            FROM ${sql(schema)}.dokument WHERE id = ANY(${dokumentIds})`
        : [],
      förvaltningKällor.length > 0
        ? sql`SELECT n.id, ts_headline('swedish', ${hayFörvaltning}, ${orQ}, ${HEADLINE}) AS utdrag
            FROM ${sql(schema)}.graf_nodes n WHERE n.id = ANY(${förvaltningKällor})`
        : [],
      anförandeIds.length > 0
        ? sql`SELECT DISTINCT ON (a.id) a.id, a.talare, a.arende,
              coalesce(p.data->>'parti', a.parti) AS parti,
              ts_headline('swedish', a.text, ${orQ}, ${HEADLINE}) AS utdrag
            FROM ${sql(schema)}.anforande_text a
            LEFT JOIN ${sql(schema)}.graf_edges te ON te.to_id = a.id AND te.typ = 'talade_i'
            LEFT JOIN ${sql(schema)}.graf_nodes p ON p.id = te.from_id AND p.typ = 'politiker'
            WHERE a.id = ANY(${anförandeIds})
            ORDER BY a.id, (p.data->>'parti') NULLS LAST`
        : [],
      politikerIds.length > 0
        ? sql`SELECT id::text AS id, uppdrag FROM ${sql(schema)}.politiker WHERE id = ANY(${politikerIds}::uuid[])`
        : [],
    ])

  const utdragMap = new Map<string, string>()
  for (const r of [...beslutUtdrag, ...dokumentUtdrag, ...förvaltningUtdrag]) {
    utdragMap.set(r.id as string, r.utdrag as string)
  }
  const anförandeMap = new Map(anförandeDetaljer.map((r) => [r.id as string, r]))
  const politikerMap = new Map(politikerDetaljer.map((r) => [r.id as string, r]))

  const resultat = rader.map((r) => {
    const via = r.via_id
      ? {
          id: r.via_id,
          typ: 'revision' as const,
          relation: r.via_relation as 'hänvisar_till' | 'behandlad_i',
          label: r.via_label,
        }
      : undefined

    let utdrag = ''
    if (r.typ === 'anforande') {
      const d = anförandeMap.get(r.id)
      utdrag =
        (d?.utdrag as string) || [d?.talare, d?.arende].filter(Boolean).join(' — ') || r.titel
    } else if (r.typ === 'politiker') {
      const uppdrag = politikerMap.get(r.id)?.uppdrag
      const roller = (Array.isArray(uppdrag) ? uppdrag : [])
        .map((u: { roll?: string; organisation?: string }) =>
          [u.roll, u.organisation].filter(Boolean).join(' '),
        )
        .filter(Boolean)
        .join(', ')
      utdrag = roller || r.titel
    } else if (via) {
      // Expanderad träff: kanten beskriver kopplingen bättre än paragraftexten,
      // som inte innehåller sökordet.
      utdrag = r.via_label || r.titel
    } else {
      utdrag = utdragMap.get(r.typ === 'forvaltning' ? r.kall_id : r.id) || r.titel
    }

    const organ: 'kf' | 'ks' | 'namnd' | null =
      r.typ === 'beslut'
        ? organAvId(r.id)
        : r.typ === 'anforande'
          ? 'kf'
          : r.typ === 'forvaltning'
            ? 'namnd'
            : null

    // Etiketten är "Talare (Parti) — Ärende": sista utvägen om varken grafen
    // eller protokollet gav något parti.
    const partiIEtikett = r.titel.match(/\(([^)]+)\)/)?.[1] || null
    const parti =
      r.typ === 'anforande' ? (anförandeMap.get(r.id)?.parti as string) || partiIEtikett : r.parti

    return {
      typ: r.typ,
      organ,
      id: r.id,
      titel: r.titel,
      datum: r.datum,
      parti,
      utdrag: klippUtdrag(utdrag),
      score: Number(r.score),
      url: webbUrl(kommun, r.typ, r.id, r.datum),
      ...(via ? { via } : {}),
      _links: { self: { href: apiUrl(kommun, r.typ, r.id, r.datum) } },
    }
  })

  const länk = (o: number) => {
    const qs = new URLSearchParams({ q })
    if (typ) qs.set('typ', typ)
    if (organ) qs.set('organ', organ)
    if (part) qs.set('parti', part)
    if (från) qs.set('från', från)
    if (till) qs.set('till', till)
    if (limit) qs.set('limit', String(lim))
    if (o) qs.set('offset', String(o))
    return `${baseUrl(kommun)}/sök?${qs.toString()}`
  }
  const _links: { self: { href: string }; next?: { href: string }; prev?: { href: string } } = {
    self: { href: länk(off) },
  }
  if (off + lim < total) _links.next = { href: länk(off + lim) }
  if (off > 0) _links.prev = { href: länk(Math.max(off - lim, 0)) }

  return c.json({ query: q, total, resultat, _links }, 200)
})
