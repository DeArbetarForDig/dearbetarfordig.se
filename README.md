# De Arbetar För Dig

> Dina politiker. Deras beslut. Dina pengar. Öppet för alla.

**dearbetarfordig.se** — en öppen demokratiplattform som gör kommunalpolitiken tillgänglig, sökbar och begriplig för alla medborgare och AI-agenter.

---

## Vad är det här?

Sveriges 290 kommuner fattar tusentals beslut varje år som påverkar ditt liv — skola, vård, skatt, infrastruktur. Idag publiceras dessa beslut som PDF:er, dolda i byråkratiska webbsystem. Det här projektet ändrar på det.

**De Arbetar För Dig** samlar, strukturerar och visualiserar:

- 👥 **Politiker** — vem de är, vad de gör, hur de röstar, vad de skriver i sociala medier
- 📋 **Beslut** — alla beslut med full historik, voteringsdata och koppling till lagar
- 🎤 **Debatter** — transkriberade fullmäktigemöten, sökbara
- 💰 **Pengar** — var skattepengar hamnar, vilka leverantörer som får kontrakt
- 🔗 **Knowledge Graph** — alla beslut, lagar, politiker och organisationer som en sammanlänkad graf

## Status (MVP)

| Komponent | Status |
|-----------|--------|
| Politiker-scraper (125 KF-ledamöter) | ✅ Klar |
| Handlingar-scraper (664 dokument, 12 möten) | ✅ Klar |
| YouTube KF-videor (20 möten) | ✅ Klar |
| REST API (politiker, beslut, debatter, graf) | ✅ Klar |
| Knowledge Graph (PDF → nodes + edges) | ✅ Klar |
| Docker + docker-compose | ✅ Klar |
| GitHub Actions CI/CD | ✅ Klar |
| Transkription (whisper.cpp) | 🔜 Nästa |
| Sociala medier-scraping | 🔜 Nästa |
| Frontend (Astro) | 🔜 Nästa |
| PostgreSQL (prod) | 🔜 Nästa |

## Principer

- **Öppet** — all kod AGPL-3.0, all data fritt tillgänglig via API
- **Oberoende** — 100% eget open source, inga proprietära beroenden
- **Suveränt** — EU-hostat (Hetzner), ingen US-cloud, inga trackers
- **Maskinläsbart** — API-first, knowledge graph, AI-agent-ready
- **Curl-friendly** — `curl localhost:3000/api/v1/goteborg/stats` → JSON

## Kom igång

```bash
# Krav: Node 22+, pnpm 9+
git clone https://github.com/DeArbetarForDig/dearbetarfordig.se.git
cd dearbetarfordig.se
pnpm install

# === Data pipeline ===
pnpm scrape:politiker     # → 125 politiker → data/politiker/goteborg.json
pnpm scrape:youtube       # → 20 KF-videor → data/debatter/youtube-kf-goteborg.json
pnpm scrape:handlingar   # → 664 dokument → data/beslut/kf-handlingar-2025.json

# === API ===
pnpm api                  # → localhost:3000

# === Docker (allt) ===
docker compose up         # → API + PostgreSQL

# === Kodkvalitet ===
pnpm lint                 # Biome check
pnpm lint:fix             # Autofix
```

## API

```bash
# Alla politiker
curl localhost:3000/api/v1/goteborg/politiker

# Filtrera på parti
curl localhost:3000/api/v1/goteborg/politiker?parti=S

# Enskild politiker (med alla uppdrag)
curl localhost:3000/api/v1/goteborg/politiker/{id}

# Sammanträden + dokument
curl localhost:3000/api/v1/goteborg/beslut?år=2025

# YouTube-videor KF
curl localhost:3000/api/v1/goteborg/debatter

# Statistik
curl localhost:3000/api/v1/goteborg/stats

# Knowledge Graph — alla beslut som noder + relationer
curl localhost:3000/api/v1/goteborg/graf?datum=2025-11-27

# Traversera grafen — enskild nod med alla kopplingar
curl localhost:3000/api/v1/goteborg/graf/node/kf-2025-11-27-§491
```

## Knowledge Graph

Varje KF-beslut parseas till en graf med noder och kanter:

```
[möte: KF 2025-11-27] ──beslut_av──→ [§491: Kompletterande budget]
                                        ├── regleras_av ──→ [lag: Kommunallagen 5 kap 50 §]
                                        ├── uppdrag_till ──→ [org: Socialnämnden Centrum]
                                        ├── uppdrag_till ──→ [org: Exploateringsnämnden]
                                        └── bordlagd_från ──→ [§264 (2025-03-27)]
```

**Nodtyper:** `paragraf`, `lag`, `organisation`, `politiker`, `möte`, `dokument`
**Kanttyper:** `beslut_av`, `regleras_av`, `uppdrag_till`, `hänvisar_till`, `bordlagd_från`, `votering`, `inlämnad_av`

## Tech stack

| Lager | Teknik | Licens |
|-------|--------|--------|
| Språk | **TypeScript 5.7** (strict, hela stacken) | Apache-2.0 |
| Runtime | **Node.js 22 LTS** | MIT |
| Frontend | Astro 5 (static-first SSG) | MIT |
| API | Hono 4 (lightweight) | MIT |
| Databas | PostgreSQL 16 | PostgreSQL |
| ORM | Drizzle (type-safe) | Apache-2.0 |
| Scraping | Cheerio + Playwright | MIT / Apache-2.0 |
| Transkription | whisper.cpp (self-hosted) | MIT |
| Validering | Zod | MIT |
| Linting | Biome | MIT |
| Monorepo | pnpm workspaces | MIT |
| Hosting | Hetzner (EU) | — |
| CI/CD | GitHub Actions | — |
| Container | Docker | Apache-2.0 |

> **Princip:** 100% open-source. Inga proprietära beroenden. All kod AGPL-3.0.

## Projektstruktur

```
dearbetarfordig.se/
├── packages/
│   ├── api/                # Hono REST API
│   ├── pipeline/           # Scrapers + parsers + transcription
│   │   └── src/
│   │       ├── scrapers/   # politiker.ts, youtube-kf.ts, handlingar.ts
│   │       ├── parsers/    # parse-protokoll.ts (PDF → knowledge graph)
│   │       └── transcription/
│   ├── shared/             # Zod schemas, types
│   ├── ui/                 # Design system
│   └── web/                # Astro frontend (SSG)
├── data/                   # Collected data (JSON)
│   ├── politiker/          # goteborg.json (125 politiker)
│   ├── beslut/             # kf-handlingar-2025.json (664 docs)
│   ├── debatter/           # youtube-kf-goteborg.json (20 videos)
│   └── graf/               # kf-2025-11-27.json (knowledge graph)
├── .github/workflows/      # CI/CD
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Datakällor

| Data | Källa | Metod |
|------|-------|-------|
| Politiker + uppdrag | politiker.goteborg.se | Cheerio (HTML) |
| KF-handlingar (PDF) | goteborg.se nämndhandlingar | Playwright |
| Protokoll → graf | PDF:er från ovan | pdftotext + regex NER |
| KF-videor | YouTube "KF Göteborg" | yt-dlp / fallback |
| Transkription | YouTube-videor | whisper.cpp (planned) |
| Sociala medier | Partisidor, X, Facebook | Planned |

## Licens

**AGPL-3.0** — fri att använda, modifiera och distribuera. Modifikationer måste delas under samma licens.

## Kontakt

Konstantin Zykov — Göteborg
Solution Architect · Civic Tech · Centerpartiet

---

*Public money, public code. Public decisions, public data.*
