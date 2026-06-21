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
| Handlingar-scraper (1835 dokument, 36 möten) | ✅ Klar |
| YouTube KF-videor (41 möten) | ✅ Klar |
| REST API (politiker, beslut, budget, graf, arvode) | ✅ Klar |
| Knowledge Graph — 18 880 noder, 76 096 kanter | ✅ Klar |
| Protokoll parsade (41 st, 2023-2026) | ✅ Klar |
| Individuella voteringar (17 210 röster) | ✅ Klar |
| Närvarodata (3 243 registreringar) | ✅ Klar |
| Arvoden (125/125 politiker, PDF-verifierat) | ✅ Klar |
| Budget drill-down (10 nämnder) | ✅ Klar |
| Anföranden → beslut (94% koppling) | ✅ Klar |
| Bolagsengagemang (90/125 politiker) | ✅ Klar |
| Transkription (whisper.cpp, 41 möten) | ✅ Klar |
| Speaker attribution (39 möten) | ✅ Klar |
| Conflict detection (framework) | ✅ Klar (väntar leverantörsdata) |
| Docker + docker-compose | ✅ Klar |
| GitHub Actions CI/CD | ✅ Klar |
| PostgreSQL + seed + merge | ✅ Klar |
| OpenAPI 3.1 + Swagger UI | ✅ Klar |
| Begäran om allmän handling (3 skickade) | ⏳ Väntar svar |
| Sociala medier-scraping | 🔜 Nästa |
| Frontend (Astro) | 🔜 Nästa |
| Deploy (Hetzner) | 🔜 Nästa |

## Principer

- **Öppet** — all kod AGPL-3.0, all data fritt tillgänglig via API
- **Oberoende** — 100% eget open source, inga proprietära beroenden
- **Suveränt** — EU-hostat (Hetzner), ingen US-cloud, inga trackers
- **Maskinläsbart** — API-first, knowledge graph, AI-agent-ready
- **Curl-friendly** — `curl localhost:3000/api/v1/goteborg/stats` → JSON

## Kom igång

```bash
# Krav: Node 22+, pnpm 9+, pdftotext (poppler)
git clone https://github.com/DeArbetarForDig/dearbetarfordig.se.git
cd dearbetarfordig.se
pnpm install

# === Data pipeline ===
pnpm scrape:politiker     # → 125 politiker → data/politiker/goteborg.json
pnpm scrape:youtube       # → 20 KF-videor → data/debatter/youtube-kf-goteborg.json
pnpm scrape:handlingar   # → 664 dokument → data/beslut/kf-handlingar-2025.json

# === Parsers (PDF → Knowledge Graph) ===
# KF-protokoll → beslut, lagar, organisationer
npx tsx packages/pipeline/src/parsers/parse-protokoll.ts <pdf> <datum>

# Budget-PDF → nämnder, belopp, uppdrag
npx tsx packages/pipeline/src/parsers/parse-budget.ts [pdf|url] [år] [styre]

# Inbox (begäran-dokument) → leverantörer, belopp
# Lägg PDF i data/inbox/, kör:
npx tsx packages/pipeline/src/parsers/parse-inbox.ts

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

## Transkription & Speaker Attribution

KF-möten transkriberas automatiskt med whisper.cpp:

```
YouTube-video (6-7h)
    → yt-dlp (download audio)
    → ffmpeg (split per anförande via yttrandeprotokoll)
    → whisper.cpp (transkribera varje anförande separat)
    → merge → JSON med talare + timestamps + text
    → radera audio (sparar bara text)
```

**Smart chunking:** Istället för naiva 30s-chunks, delar vi audio baserat på
yttrandeprotokollet — varje anförande (1-8 min) blir ett eget chunk. Resultatet:
- Bättre whisper-kvalitet (en talare per chunk, inget cut mitt i mening)
- Direkt koppling: text ↔ politiker ↔ ärende
- Accessibility: fulltext för döva, sökbart för alla

Långa anföranden (>5 min) delas automatiskt i sub-chunks men behåller
speaker-attributionen. Fallback: 30s-chunks om inget yttrandeprotokoll finns.

**Datakällor per anförande:**
| Data | Källa |
|------|-------|
| Vem talar | Yttrandeprotokoll (PDF) |
| Vilken § | Yttrandeprotokoll (PDF) |
| Start/slut-tid | Yttrandeprotokoll (PDF) |
| Vad de sa (text) | whisper.cpp (audio) |
| Video-länk | YouTube (timestamp) |

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
| Budget → graf | Budget-PDF från KF | pdftotext + regex (tabeller) |
| Begäran-dokument | Email (registrator) | data/inbox/ + parse-inbox.ts |
| KF-videor | YouTube "KF Göteborg" | yt-dlp / fallback |
| Transkription | YouTube-videor | whisper.cpp (30s-chunks) |
| Speaker attribution | Yttrandeprotokoll (PDF) | pdftotext → timestamp matching |
| Bolagsengagemang | allabolag.se | Planned (scraper) |
| Inkomst + fastigheter | ratsit.se | Planned (scraper) |
| Sociala medier | Partisidor, X, Facebook | Planned |
| Valkampanjfinansiering | Kammarkollegiet | Planned (öppet API) |

## Politiker-portfolio (per person)

Varje politiker får ett komplett portfolio baserat på öppna data:

```
Anna Svensson (C)
├── Officiellt (politiker.goteborg.se)
│   ├── Uppdrag: KF-ledamot, ordförande Grundskolenämnden
│   ├── Email: anna.svensson@politiker.goteborg.se
│   └── Mandatperiod: 2022-10-15 – 2026-10-14
├── Beslut & röstning (KF-protokoll)
│   ├── Voteringar: 34 st (89% med partiet)
│   ├── Yrkanden: 5 st
│   └── Närvaro: 92%
├── Anföranden (whisper + yttrandeprotokoll)
│   ├── Total talartid: 2h 15min
│   └── Ämnen: budget, skola, integration
├── Ekonomi (ratsit.se)
│   ├── Inkomst: XXX tkr/år
│   ├── Fastigheter: [...]
│   └── Bolagsengagemang: [...]
├── Sociala medier
│   ├── X/Twitter: @annasvensson
│   └── Senaste inlägg: [...]
└── Budget-ansvar
    └── Grundskolenämnden: 10 547 mnkr
```

## Pipeline — schemaläggning

| Scraper | Frekvens | Trigger |
|---------|----------|---------|
| `scrape:politiker` | Veckovis | Automatisk (cron) |
| `scrape:handlingar` | Veckovis | Automatisk (cron) |
| `scrape:youtube` | Veckovis | Automatisk (cron) |
| `parse-protokoll` | Vid nytt protokoll | Efter scrape:handlingar |
| `parse-budget` | Årligen (nov) | Manuell/efter budgetbeslut |
| `transcribe` | Vid nytt video | On-demand (whisper container) |
| `allabolag` | Kvartalsvis | Cron (1 jan, apr, jul, okt) |
| `parse-inbox` | Vid ny begäran | Manuell (lägg PDF i data/inbox/) |

### Trigger-baserad uppdatering
- Om protokoll-parser hittar `jävsanmälan` → automatisk rescan av den politikern på allabolag.se
- Om nytt YouTube-video publiceras → automatisk transcription

## Licens

**AGPL-3.0** — fri att använda, modifiera och distribuera. Modifikationer måste delas under samma licens.

## Kontakt

Konstantin Zykov — Göteborg
Solution Architect · Civic Tech · Centerpartiet

---

*Public money, public code. Public decisions, public data.*
