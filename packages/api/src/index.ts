import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { ALLOWED_KOMMUNER, sql } from './lib/db.js'
import { rateLimitMiddleware } from './lib/rate-limit.js'
import { beslutRouter } from './routes/beslut.js'
import { budgetRouter } from './routes/budget.js'
import { dokumentRouter } from './routes/dokument.js'
import { forvaltningarRouter } from './routes/forvaltningar.js'
import { grafRouter } from './routes/graf.js'
import { lonRouter } from './routes/lon.js'
import { metricsRouter } from './routes/metrics.js'
import { motenRouter } from './routes/moten.js'
import { politikerRouter } from './routes/politiker.js'
import { sokRouter } from './routes/sok.js'
import { trenderRouter } from './routes/trender.js'

const app = new OpenAPIHono()

// --- Middleware ---
app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))

// Kommun validation
app.use('/v1/:kommun/*', async (c, next) => {
  const kommun = c.req.param('kommun')
  if (!ALLOWED_KOMMUNER.includes(kommun)) {
    return c.json(
      { error: `Kommun '${kommun}' finns inte. Tillgängliga: ${ALLOWED_KOMMUNER.join(', ')}` },
      404,
    )
  }
  await next()
})

app.use('/*', rateLimitMiddleware)

// --- Health ---
app.get('/healthz', async (c) => {
  try {
    await sql`SELECT 1`
    return c.json({ status: 'ok', db: 'connected' })
  } catch {
    return c.json({ status: 'error', db: 'disconnected' }, 503)
  }
})

// --- Routes ---
// Each router below owns one resource area and registers its own full paths
// (e.g. '/v1/{kommun}/politiker'), so mounting at '/' just merges their
// routing tables and OpenAPI registries into `app` — no path rewriting here.
// Relative order between different resource prefixes doesn't affect request
// matching (Hono resolves literal segments before params regardless of
// registration order), except where a module's own comments call out a
// specific ordering requirement (see routes/dokument.ts).
app.route('/', politikerRouter)
app.route('/', motenRouter)
app.route('/', beslutRouter)
app.route('/', budgetRouter)
app.route('/', grafRouter)
app.route('/', sokRouter)
app.route('/', metricsRouter)
app.route('/', dokumentRouter)
app.route('/', lonRouter)
app.route('/', forvaltningarRouter)
app.route('/', trenderRouter)

// --- OpenAPI + Swagger ---
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'De Arbetar För Dig — API',
    version: '0.4.0',
    description: `Öppen demokrati-API — gör svensk kommunalpolitik tillgänglig, sökbar och begriplig. Sverige har 290 kommuner; API:t är strukturerat per kommun (\`/v1/{kommun}/...\`) för att kunna växa bortom den första, **Göteborg**, som just nu är den enda med data.

**HAL Format (Hypertext Application Language):**

Alla svar följer HAL-standarden för hypermedia API:er.

*Listor (collections):*
\`\`\`json
{
  "_embedded": { "items": [...] },
  "_links": { "self": { "href": "/v1/goteborg/politiker" } },
  "total": 125
}
\`\`\`

*Resurser (single item):*
\`\`\`json
{
  "_embedded": {
    "item": { "id": "...", "namn": "..." },
    "related": { "möten": [...] }
  },
  "_links": {
    "self": { "href": "/v1/goteborg/politiker/{id}" },
    "collection": { "href": "/v1/goteborg/politiker" }
  }
}
\`\`\`

**Endpoints:**
- \`/möten?år=\` — Lista sammanträden (KF+KS) med url per möte
- \`/möten/{datum}\` — Enskilt möte: beslut, närvaro, anföranden
- \`/politiker\` — Förtroendevalda (KF-ledamöter, nämnder, bolagsstyrelser) med uppdrag och möten
- \`/politiker/{id}\` — Detaljprofil inkl. lista över möten där politikern talade
- \`/politiker/{id}/anforanden?datum=\` — Anföranden (tal) per möte
- \`/beslut\` — KF/KS-beslut med voteringar och ärendenummer
- \`/möten/{datum}/anföranden\` — Alla anföranden från ett sammanträde (?talare=, ?ärende=, ?q=)
- \`/budget?år=\` — Kommunbudget per nämnd (2022–2026)
- \`/graf\` — Knowledge graph (noder + kanter)
- \`/graf/node/{id}\` — Graf-nod med relaterade noder och kanter
- \`/stats\` — Demokratisk hälsa (Rice-index, Gini, konsensusgrad)
- \`/metrics\` — Beslutskraft och partilojalitet
- \`/sök?q=\` — Fulltextsökning över alla resurser

**Datakällor:** Nämndhandlingar (goteborg.se), Yttrandeprotokoll PDF, Valmyndigheten`,
    license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    contact: {
      name: 'DeArbetarForDig',
      url: 'https://github.com/DeArbetarForDig/dearbetarfordig.se',
    },
  },
  servers: [
    { url: 'https://api.dearbetarfordig.se', description: 'Produktion' },
    { url: 'http://localhost:3000', description: 'Lokal utveckling' },
  ],
})
app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// Samma ikon som packages/web/public/favicon.svg (Lucide "landmark" på
// --color-primary) — inlinead här istället för att läsas från packages/web,
// som Docker-imagen (Dockerfile) inte kopierar in.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#2563eb" />
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" x2="21" y1="22" y2="22" />
    <line x1="6" x2="6" y1="18" y2="11" />
    <line x1="10" x2="10" y1="18" y2="11" />
    <line x1="14" x2="14" y1="18" y2="11" />
    <line x1="18" x2="18" y1="18" y2="11" />
    <polygon points="12 2 20 7 4 7" />
  </g>
</svg>`
// Både .svg (för <link rel="icon"> på '/') och .ico (browsers legacy-fallback
// på sidor utan <link>, t.ex. /docs Swagger UI som vi inte styr <head> för) —
// SVG-innehåll under .ico-sökvägen fungerar fint i moderna webbläsare.
app.get('/favicon.svg', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml' }))
app.get('/favicon.ico', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml' }))

// '/' was a redirect into the JS-rendered Swagger UI, which crawlers and
// AI agents that don't execute JS can't read. This is a static, fully
// server-rendered page instead, so the API is discoverable without JS —
// '/openapi.json' is the machine-readable entry point, '/docs' remains for
// interactive human browsing.
app.get('/', (c) =>
  c.html(`<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>De Arbetar För Dig — API</title>
<meta name="description" content="Öppen demokrati-API för svensk kommunalpolitik. Maskinläsbart, AI-agent-ready.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
<h1>De Arbetar För Dig — API</h1>
<p>Öppen demokrati-API — gör svensk kommunalpolitik tillgänglig, sökbar och begriplig. HAL + OpenAPI 3.1, AGPL-3.0.</p>
<ul>
<li><a href="/openapi.json">OpenAPI-spec (JSON)</a> — maskinläsbar, för AI-agenter och verktyg</li>
<li><a href="/docs">Interaktiv dokumentation (Swagger UI)</a> — för utforskning i webbläsare</li>
<li><a href="/v1/goteborg/politiker">/v1/goteborg/politiker</a> — exempel-endpoint</li>
</ul>
</body>
</html>`),
)

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 API v0.4.0 at http://localhost:${info.port}`)
  console.log(`📖 Docs: http://localhost:${info.port}/docs`)
})
