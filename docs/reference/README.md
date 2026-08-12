# Reference Sources — dearbetarfordig.se

> Analoger, källkod och arkitekturbeslut från civic tech-världen.
> Källkodsmappar ligger i `.gitignore` — klona lokalt vid behov.

## Kloning

```bash
# Allt på en gång (≈800 MB)
git clone --depth 1 https://github.com/mysociety/theyworkforyou.git docs/reference/theyworkforyou
git clone --depth 1 https://github.com/demokratie-live/bundestag.io.git docs/reference/abgeordnetenwatch
git clone --depth 1 https://github.com/decidim/decidim.git docs/reference/decidim
git clone --depth 1 https://github.com/OAndell/Riksdagskollen.git docs/reference/riksdagskollen
git clone --depth 1 https://github.com/openpolis/openparlamento.git docs/reference/openparlamento
git clone --depth 1 https://github.com/Partiguiden/partiguiden.git docs/reference/partiguiden
git clone --depth 1 https://github.com/everypolitician/everypolitician-data.git docs/reference/everypolitician
git clone --depth 1 https://github.com/rotsee/protokollen.git docs/reference/protokollen
git clone --depth 1 https://github.com/okfse/opengovse.git docs/reference/opengovse
git clone --depth 1 https://github.com/isakskogstad/Riksdag-Regering-MCP.git docs/reference/riksdag-regering-mcp
```

---

## Källförteckning

### 1. TheyWorkForYou (mySociety) — 🇬🇧

||
|---|---|
| **Mapp** | `theyworkforyou/` |
| **Repo** | [mysociety/theyworkforyou](https://github.com/mysociety/theyworkforyou) |
| **Stack** | PHP, Perl (parser), MySQL |
| **Licens** | BSD |
| **Storlek** | ~169 MB |

**Vad det är:** Huvudreferensen — parlamentsövervakning för Storbritannien. Visar debatter, voteringar, ledamöters anföranden. Gör Hansard (parlamentsprotokoll) läsbart.

**Vad vi tar med oss:**

- Parser-arkitekturen (eget repo [parlparse](https://github.com/mysociety/parlparse))
- Filosofin "gör parlamentet begripligt för folk"
- URL-design: `/mp/anna-svensson` → politikersida
- Angreppssättet för debatt- och voteringsdata
- Curl-friendly HTML (inspiration för vårt eget angreppssätt)

**Nyckelfiler:**

- `www/docs/api/` — API-design
- `classes/` — datamodeller (Member, Division, Debate)
- `scripts/` — hämtning och parsning av Hansard

---

### 2. Bundestag.io / DEMOCRACY (demokratie-live) — 🇩🇪

||
|---|---|
| **Mapp** | `abgeordnetenwatch/` |
| **Repo** | [demokratie-live/bundestag.io](https://github.com/demokratie-live/bundestag.io) |
| **Stack** | Node.js, GraphQL, MongoDB |
| **Licens** | Apache 2.0 |
| **Storlek** | ~1 MB |
| **Status** | ⚠️ Archived → flyttat till [democracy-development monorepo](https://github.com/demokratie-live/democracy-development) |

**Vad det är:** GraphQL-API för Bundestag-data. Backend till appen DEMOCRACY, som låter medborgare rösta parallellt med parlamentet.

**Vad vi tar med oss:**

- GraphQL-schema för parlamentsdata
- Modellen: Procedure, Vote, Period
- Angreppssättet för att skrapa bundestag.de
- Monorepo-arkitektur (flyttades senare till ett enda repo)

**Nyckelfiler:**

- `src/graphql/schemas/` — GraphQL-typer
- `src/services/` — affärslogik
- `docker-compose.yml` — infrastruktur

---

### 3. Decidim — 🇪🇸

||
|---|---|
| **Mapp** | `decidim/` |
| **Repo** | [decidim/decidim](https://github.com/decidim/decidim) |
| **Stack** | Ruby on Rails, PostgreSQL |
| **Licens** | AGPL-3.0 |
| **Storlek** | ~115 MB |

**Vad det är:** Den största open source-plattformen för participatory democracy. Används av Barcelona, Helsingfors och hundratals städer. Inte bara övervakning — aktivt medborgardeltagande.

**Vad vi tar med oss:**

- Multi-tenant-arkitektur (organization = tenant)
- Modularitet: komponenter som gems (proposals, meetings, budgets, debates)
- System för auktorisering och verifiering av deltagare
- i18n-angreppssätt (flerspråkighet direkt ur lådan)
- Designsystem och tillgänglighet

**Nyckelfiler:**

- `decidim-core/` — plattformens kärna
- `decidim-proposals/` — förslag (motsvarar våra motioner)
- `decidim-budgets/` — budgetering
- `decidim-meetings/` — sammanträden
- `docs/` — arkitektur och filosofi
- `decidim-api/` — GraphQL-API

---

### 4. Riksdagskollen — 🇸🇪

||
|---|---|
| **Mapp** | `riksdagskollen/` |
| **Repo** | [OAndell/Riksdagskollen](https://github.com/OAndell/Riksdagskollen) |
| **Stack** | Android (Java/Kotlin) |
| **Licens** | MIT |
| **Storlek** | ~14 MB |
| **Status** | ⚠️ Underhålls inte längre |

**Vad det är:** Android-app för att följa Sveriges riksdag. Visar beslut, voteringar, dokument — precis det vi gör, men på nationell nivå och enbart för Android.

**Vad vi tar med oss:**

- Förståelse för Riksdagens API (data.riksdagen.se)
- Datamodeller: beslut, voteringar, partier, dokument
- UX-mönster för svensk politisk information
- Svensk terminologi (beslut, votering, motion, interpellation)

**Nyckelfiler:**

- `app/src/main/java/se/oandell/riksdagen/` — modeller och UI
- Datastrukturen från Riksdagens öppna data-API

---

### 5. OpenParlamento (Openpolis) — 🇮🇹

||
|---|---|
| **Mapp** | `openparlamento/` |
| **Repo** | [openpolis/openparlamento](https://github.com/openpolis/openparlamento) |
| **Stack** | PHP (Symfony 1.0) |
| **Licens** | GPL-3.0 |
| **Storlek** | ~74 MB |

**Vad det är:** Italiensk plattform för parlamentsövervakning. Visar ledamöters aktivitet, voteringar, lagförslag. Del av Openpolis-ekosystemet.

**Vad vi tar med oss:**

- Angreppssättet med ett "aktivitetsindex" för politiker (närvaro, voteringar, anföranden)
- Visualisering: parlamentssalen → data
- Legacy-kod, men värdefulla datamodeller
- Kopplingen mellan atti (akter), votazioni (voteringar), parlamentari (ledamöter)

**Nyckelfiler:**

- `apps/fe/modules/` — frontend-moduler (politici, atti, votazioni)
- `lib/model/` — ORM-modeller
- `config/schema.yml` — dataschema

---

### 6. Partiguiden — 🇸🇪

||
|---|---|
| **Mapp** | `partiguiden/` |
| **Repo** | [Partiguiden/partiguiden](https://github.com/Partiguiden/partiguiden) |
| **Stack** | Next.js, TypeScript, pnpm, Turbo |
| **Licens** | ISC |
| **Storlek** | ~5.7 MB |

**Vad det är:** Svensk sajt för att jämföra partier utifrån deras ståndpunkter. Använder Riksdagens data. **Närmast oss i stacken** (TypeScript, monorepo, pnpm).

**Vad vi tar med oss:**

- TypeScript + monorepo-struktur (turbo/pnpm) — direkt referens för vår arkitektur
- Integration mot Riksdagens API
- Svenska modeller: partier, ståndpunkter, voteringar
- Frontend-angreppssätt (Next.js, men mönstren går att applicera på Astro)
- UI-komponenter för politisk data

**Nyckelfiler:**

- `apps/web/` — frontend
- `packages/` — delade paket
- `package.json` — monorepo-konfiguration

---

### 7. EveryPolitician (mySociety) — 🌍

||
|---|---|
| **Mapp** | `everypolitician/` |
| **Repo** | [everypolitician/everypolitician-data](https://github.com/everypolitician/everypolitician-data) |
| **Stack** | Data (JSON, CSV), Ruby (tooling) |
| **Licens** | CC0 / Public Domain |
| **Storlek** | ~420 MB |
| **Status** | ⚠️ Pausat sedan 2019 |

**Vad det är:** Global databas över politiker i alla länder, i det standardiserade formatet Popolo. Användes för Gender-Balance.org och andra projekt.

**Vad vi tar med oss:**

- **Popolo-standarden** — internationell standard för politikerdata
- Datastruktur: person, organization, membership, area
- Angreppssättet för data över flera länder
- CSV/JSON-scheman för import/export
- `countries.json` — metaindex över alla länder och lagstiftande församlingar

**Nyckelfiler:**

- `data/Sweden/` — svensk data (Riksdagen)
- `countries.json` — masterindex
- Vilken `data/*/`-mapp som helst — exempel på Popolo-formatet

---

### 8. Protokollen / ProtoCollection (Journalism++ Stockholm) — 🇸🇪

||
|---|---|
| **Mapp** | `protokollen/` |
| **Repo** | [rotsee/protokollen](https://github.com/rotsee/protokollen) |
| **Stack** | Python 2, Selenium, Tesseract OCR, AbiWord/wv, Elasticsearch |
| **Licens** | ej angiven |
| **Storlek** | ~8 MB |
| **Status** | ⚠️ Inaktiv sedan 2015, protokollen.net är nere |

**Vad det är:** Den närmaste direkta föregångaren till vårt projekt. En Vinnova-finansierad harvester som samlade in och tolkade **kommunstyrelse**-protokoll från alla 290 svenska kommuner och publicerade dem som öppen data för sökning och analys. Hittades via katalogen `_tools/protokollen.md` på opengov.se.

**Vad vi tar med oss:**

- Bekräftelse på angreppssättet: fulltextextraktion av protokoll på kommunnivå har redan försökts i Sverige — men stannade vid harvestning av rå text, utan strukturering per ärende/beslut, och projektet överlevde inte 2015
- `harvest.py` — mönster för att gå igenom kommunsajter (Selenium, eftersom många kommuner saknar ett stabilt API eller URL-schema för protokoll)
- `extract.py` + `modules/extractors/` — OCR-/parsningspipeline för olika format (PDF, DOC, RTF) till text och metadata
- `modules/tagger.py`, `modules/documents.py` — försök att dela upp en fil i underdokument (dagordning, protokoll, bilagor)
- Kompanjonrepo [jplusplus/protokollen-queries](https://github.com/jplusplus/protokollen-queries) — `municipalities.md`, en lista över kommunsajter och deras parsningsegenheter (användbar att stämma av mot när nya kommuner läggs till)

**Nyckelfiler:**

- `harvest.py`, `harvest_args.py` — filinsamling
- `extract.py` — text-/metadataextraktion
- `modules/extractors/` — formatspecifika parsers
- `README.md` / `README-database-api.md` — arkitektur och DB-schema

---

### 9. OpenGov.se (Open Knowledge Sverige) — 🇸🇪

||
|---|---|
| **Mapp** | `opengovse/` |
| **Repo** | [okfse/opengovse](https://github.com/okfse/opengovse) |
| **Stack** | Jekyll 4 (Ruby), statisk sajt |
| **Licens** | CC0-1.0 |
| **Storlek** | ~105 MB (mestadels assets och speglade PDF-rapporter) |

**Vad det är:** Ingen övervakningsplattform, utan en katalog/aggregator för svenska transparensinitiativ, driven av Open Knowledge Sverige. Värdet ligger inte i sajtens kod (en Jekyll-mall) utan i den kuraterade datan: listor över öppna portaler, verktyg och case i Sverige/Norden/EU.

**Vad vi tar med oss:**

- `_data/portals.yml` — kuraterad lista över öppna dataportaler (dataportal.se, DIGG, Riksdagens öppna data, SCB, Norden, data.europa.eu, DCAT-AP, OGP)
- `_tools/*.md` — 23 kort över svenska/EU-transparensverktyg med status (active/archived) — källan där `protokollen` (se punkt 8) och `handlingar.se`/`allmanhandling.se` (används redan som referens för vårt FOI-flöde) hittades
- `_cases/*.md` — fallstudier (protokollen, handlingar, vardbetyg, postnummerupproret, eu-data-portal, danish-address-data)
- Kortmönstret: frontmatter `status: active|archived` + `archived_reason` — en användbar modell för vår egen `docs/reference/README.md` om källistan växer

**Nyckelfiler:**

- `_data/portals.yml`, `_data/reports.yml`, `_data/archived-resources.yml`
- `_tools/`, `_cases/`

---

### 10. Riksdag & Regering MCP-server (isakskogstad) — 🇸🇪

||
|---|---|
| **Mapp** | `riksdag-regering-mcp/` |
| **Repo** | [isakskogstad/Riksdag-Regering-MCP](https://github.com/isakskogstad/Riksdag-Regering-MCP) |
| **Stack** | TypeScript, `@modelcontextprotocol/sdk`, Express, Zod, node-cache, winston |
| **Licens** | MIT |
| **Storlek** | ~700 KB |
| **Status** | ✅ Aktiv (publicerad i MCP Registry, senast uppdaterad 2026-05) |

**Vad det är:** Direkt prejudikat för den planerade MCP-servern till dearbetarfordig.se — ger LLM-agenter tillgång till [data.riksdagen.se](https://data.riksdagen.se) (Riksdagens officiella öppna API) och [g0v.se](https://g0v.se) (Regeringskansliets data) via 32 MCP-verktyg: ledamöter, riksdagsdokument (motioner, skriftliga frågor), anföranden, voteringar, regeringsdokument. Hittades via användarens minne av "någons MCP-projekt för riksdagen", inte via opengov.se-katalogen.

**Vad vi tar med oss:**

- **Transport — den viktigaste läxan.** MCP SDK:ets standardtransport är stdio (för lokala klienter som Claude Desktop). För en publik, fjärransluten server byggde de ett eget HTTP-lager (`src/server.ts`, Express) med en enhetlig `POST /mcp` (JSON-RPC 2.0), legacy REST-liknande endpoints (`/mcp/list-tools`, `/mcp/call-tool` — "för ChatGPT" enligt kodkommentaren) och ett `/sse`-fallback för klienter utan stöd för Streamable HTTP. Precis det som behöver tänkas igenom innan vi bygger vår egen MCP-server.
- **Verktyg som separata filer, inte autogenererade från OpenAPI.** Varje tool är en egen `.ts`-fil i `src/tools/` med sitt eget Zod-schema (`zod-to-json-schema` konverterar det till JSON Schema för MCP). Vi har redan Zod-scheman för varje route via `@hono/zod-openapi` — de går att återanvända direkt i stället för att kopiera fil-per-verktyg-mönstret.
- `src/utils/cache.ts`, `src/utils/rateLimiter.ts` — cache (5 min TTL, node-cache) och rate limit ovanpå det externa API:et, relevant även för vårt eget API om MCP-servern blir en egen process framför det.
- `Dockerfile` — multi-stage build, non-root-användare, health check — mönster som går rakt av att applicera på vår `docker-compose.yml`/GHCR-pipeline.
- `README.md`, `mcp/USAGE_GUIDE.md`, `mcp/API_REFERENCE.md` — hur en MCP-server dokumenteras för olika klienter (Claude Desktop, Cursor, ChatGPT, fjärranslutning utan installation).

**Nyckelfiler:**

- `mcp/src/server.ts` — HTTP/SSE-transport, health check, rate limit
- `mcp/src/core/mcpServer.ts` — registrering av verktyg och resurser
- `mcp/src/tools/*.ts` — 20+ verktyg, ett eget modul per verktyg
- `mcp/Dockerfile`, `mcp/package.json` — deploy och beroenden

---

## Jämförelsematris

| Projekt | Nivå | Stack | Multi-tenant | API | Debatter | Voteringar | Budget |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| TheyWorkForYou | Nationell | PHP | ❌ | ✅ REST | ✅ | ✅ | ❌ |
| Bundestag.io | Nationell | Node/GraphQL | ❌ | ✅ GraphQL | ❌ | ✅ | ❌ |
| Decidim | Kommunal+ | Ruby/Rails | ✅ | ✅ GraphQL | ✅ | ✅ | ✅ |
| Riksdagskollen | Nationell | Android | ❌ | (använder Riksdagens API) | ✅ | ✅ | ❌ |
| OpenParlamento | Nationell | PHP/Symfony | ❌ | ❌ | ✅ | ✅ | ❌ |
| Partiguiden | Nationell | Next.js/TS | ❌ | ❌ | ❌ | ✅ | ❌ |
| EveryPolitician | Global | Data/Ruby | N/A | ✅ JSON | ❌ | ❌ | ❌ |
| Protokollen (2015) | Kommunal (kommunstyrelse) | Python/OCR-harvester | ❌ | ❌ (rå text) | ❌ | ❌ | ❌ |
| **dearbetarfordig.se** | **Kommunal** | **TS/Astro/Hono** | **✅** | **✅ REST** | **✅** | **✅** | **✅** |

---

## Vad som är unikt med dearbetarfordig.se

1. **Fokus på kommun** — av de aktiva analogerna arbetar ingen på svensk kommunnivå; det enda försöket (Protokollen, Journalism++) stannade vid rå harvestning av kommunstyrelse-protokoll och överlevde inte 2015
2. **Hela stacken i TypeScript** — samma språk för frontend, API, pipeline
3. **Static-first + curl-friendly** — HTML som API (som TheyWorkForYou, men ännu renare)
4. **Strukturerade fulltextanföranden** — Yttrandeprotokoll (officiell PDF) för KF-möten, uppdelade per ärende/beslut (Protokollen extraherade bara löpande text utan den strukturen)
5. **Budgetvisualisering** — kombinerar Decidims angreppssätt med ekonomisk transparens
6. **EU-sovereign** — Hetzner, ingen US-cloud, GDPR by design

---

## Ytterligare resurser (ej klonade)

| Projekt | URL | Vad som är intressant |
|---|---|---|
| Kolada (RKA/SKR) | [kolada.se](https://www.kolada.se/) | Svensk kommunal statistik — API för benchmarking |
| Riksdagens öppna data | [data.riksdagen.se](https://data.riksdagen.se/) | Riksdagens officiella API |
| Open Knowledge Foundation | [okfn.org](https://okfn.org/) | Standarder för öppna data |
| OpenGov Inc. | [opengov.com](https://opengov.com) | Kommersiell (proprietär) SaaS för amerikansk local government: budgetering, permitting, procurement, tax & revenue, CRM. Inget GitHub-repo — inte för kloning, men användbar som en bild av en govtech-plattforms funktionsutbud utan vårt fokus på transparens kring beslut |
| protokollen-queries (jplusplus) | [GitHub](https://github.com/jplusplus/protokollen-queries) | Kompanjonrepo till Protokollen (punkt 8 ovan) — `municipalities.md` med en lista över kommunsajter och deras protokollsidors egenheter |
| Popolo standard | [popoloproject.com](http://www.popoloproject.com/) | Dataformat för politiker (används av EveryPolitician) |
| mySociety philosophy | [mysociety.org/about](https://www.mysociety.org/about/) | Civic tech-filosofi |
| democracy-development | [GitHub](https://github.com/demokratie-live/democracy-development) | Aktuellt DEMOCRACY-monorepo (ersätter bundestag.io) |
