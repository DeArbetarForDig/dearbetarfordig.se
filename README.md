# De Arbetar För Dig

> Dina politiker. Deras beslut. Dina pengar. Öppet för alla.

**dearbetarfordig.se** — en öppen demokratiplattform som gör kommunalpolitiken tillgänglig, sökbar och begriplig för alla medborgare.

---

## Vad är det här?

Sveriges 290 kommuner fattar tusentals beslut varje år som påverkar ditt liv — skola, vård, skatt, infrastruktur. Idag publiceras dessa beslut som PDF:er, dolda i byråkratiska webbsystem. Det här projektet ändrar på det.

**De Arbetar För Dig** samlar, strukturerar och visualiserar:

- 👥 **Politiker** — vem de är, vad de gör, hur de röstar
- 📋 **Beslut** — alla beslut med full historik och voteringsdata
- 🎤 **Debatter** — transkriberade fullmäktigemöten, sökbara
- 💰 **Pengar** — var skattepengar hamnar, vilka leverantörer som får kontrakt

## Principer

- **Öppet** — all kod AGPL-3.0, all data fritt tillgänglig via API
- **Tillgängligt** — fungerar utan JavaScript, WCAG 2.1 AA, mobilt först
- **Suveränt** — EU-hostat, ingen US-cloud, inga trackers
- **Curl-friendly** — `curl dearbetarfordig.se/politiker/anna-svensson` → HTML med data

## Tech stack

| Lager | Teknik | Licens |
|-------|--------|--------|
| Språk | **TypeScript 5.7** (strict, hela stacken) | Apache-2.0 |
| Runtime | **Node.js 22 LTS** | MIT |
| Frontend | Astro 5 (static-first SSG) | MIT |
| Styling | Tailwind CSS 4 | MIT |
| Grafer | Observable Plot + D3.js (SVG) | ISC / BSD |
| Sök | Pagefind (client-side full-text) | MIT |
| API | Hono 4 (lightweight, edge-ready) | MIT |
| ORM | Drizzle (type-safe, PostgreSQL) | Apache-2.0 |
| DB-driver | postgres.js (porsager) | Unlicense |
| Databas | PostgreSQL 16 (schema-per-tenant) | PostgreSQL |
| Transkription | whisper.cpp (self-hosted) | MIT |
| Scraping | Cheerio + Playwright | MIT / Apache-2.0 |
| Validering | Zod (shared types frontend ↔ API) | MIT |
| Test | Vitest | MIT |
| Linting | Biome (ersätter ESLint + Prettier) | MIT |
| Monorepo | pnpm workspaces | MIT |
| Build | tsup (production) / tsx (dev) | MIT |
| Hosting | Hetzner (EU) + Cloudflare CDN | — |
| CI/CD | GitHub Actions | — |

> **Princip:** 100% open-source. Inga proprietära beroenden i core. All kod AGPL-3.0.

## Kom igång (utveckling)

```bash
# Krav: Node 22+, pnpm 9+
git clone https://github.com/YOUR_ORG/dearbetarfordig.se.git
cd dearbetarfordig.se

pnpm install

# Allt på en gång (frontend + API med hot reload)
pnpm dev:all          # → localhost:4321 (web) + localhost:3000 (api)

# Eller separat
pnpm dev              # → localhost:4321 (Astro + Vite HMR)
pnpm api              # → localhost:3000 (Hono + tsx watch)

# Data pipeline
pnpm scrape           # → data/politiker/
pnpm transcribe       # → data/debatter/

# Kodkvalitet
pnpm lint             # Biome check
pnpm lint:fix         # Autofix
pnpm format           # Formatera
```

## Projektstruktur

```
dearbetarfordig.se/
├── packages/
│   ├── web/                # Astro frontend (SSG)
│   │   └── src/
│   ├── api/                # Hono REST API
│   │   └── src/
│   ├── pipeline/           # Scrapers + transcription
│   │   └── src/
│   │       ├── scrapers/
│   │       └── transcription/
│   └── shared/             # Zod schemas, types, constants
│       └── src/
├── data/                   # Output (JSON)
│   ├── politiker/
│   ├── beslut/
│   ├── debatter/
│   └── budget/
├── docs/                   # Dokumentation
│   ├── DESIGN.md
│   ├── SAAS.md
│   └── DATA_MODEL.md
├── public/                 # Statiska filer (fonts, icons)
├── package.json            # Root (pnpm workspace)
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

## Licens

**AGPL-3.0** — fri att använda, modifiera och distribuera. Modifikationer måste delas under samma licens.

## MVP: /goteborg

Vi börjar med **en kommun** — Göteborg. Allt under `/goteborg`:

```
dearbetarfordig.se/goteborg              → Översikt
dearbetarfordig.se/goteborg/politiker    → Alla förtroendevalda
dearbetarfordig.se/goteborg/beslut       → Beslut + voteringar
dearbetarfordig.se/goteborg/debatter     → Transkriberade KF-möten
dearbetarfordig.se/goteborg/budget       → Budgetvisualisering
```

När Göteborg fungerar → lägger vi till fler kommuner under samma struktur (`/malmo`, `/helsingborg`, etc.).

## Kontakt

Konstantin Zykov — Göteborg  
Solution Architect · Civic Tech · Centerpartiet

---

*Public money, public code. Public decisions, public data.*
