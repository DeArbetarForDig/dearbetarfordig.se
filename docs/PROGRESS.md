# Progress — 2026-06-15 / 2026-06-17

> Sammanfattning av vad som byggts under denna session.

## Siffror (nuläge)

| Mått | Värde |
|------|-------|
| Politiker (KF Göteborg) | 125 |
| Sammanträden (parsed) | 17 (2025 + 2026) |
| Beslut/Paragrafer | 801 |
| Organisationer | 406 |
| Bolag (allabolag.se) | 167 |
| Graf — totalt nodes | 1525 |
| Graf — totalt edges | 10634 |
| Voteringar (röstade_ja) | 2704 |
| Voteringar (röstade_nej) | 1794 |
| Reservationer | 4782 |
| Yrkanden | 459 |
| Jävsanmälningar | 9 |
| Transkriberade möten | ~38 (pågår) |
| Handlingar (PDF-länkar) | 1835+ |
| API-tester | 22/22 ✅ |

## Arkitektur

```
GitHub (DeArbetarForDig/dearbetarfordig.se)
    │
    ├── packages/pipeline/     ← Scrapers + Parsers + Transcription
    │   ├── scrapers/          politiker.ts, youtube-kf.ts, handlingar.ts, allabolag.ts
    │   ├── parsers/           parse-protokoll.ts, parse-budget.ts, parse-inbox.ts
    │   └── transcription/     run.ts (whisper.cpp, chunked)
    │
    ├── packages/api/          ← Hono + OpenAPI + PostgreSQL
    │   ├── src/index.ts       REST API (9 endpoints + Swagger)
    │   ├── src/db/            schema.ts, seed.ts, index.ts
    │   └── src/tests/         api.test.ts (22 tests)
    │
    ├── data/                  ← JSON (source of truth → seeded to DB)
    │   ├── politiker/         goteborg.json, bolagsengagemang-goteborg.json
    │   ├── beslut/            kf-handlingar-2023.json, 2024.json, 2025.json, 2026.json
    │   ├── debatter/          kf-YYYY-MM-DD.json (38 transcriptions)
    │   └── graf/              kf-YYYY-MM-DD.json (17), budget-2026.json, politiker-komplett.json
    │
    ├── docker/                whisper.Dockerfile
    ├── docker-compose.yml     API + PostgreSQL + whisper (on-demand)
    ├── Dockerfile             API production image
    ├── .github/workflows/     CI/CD (lint → deploy)
    └── scripts/               transcribe-all.sh (batch)
```

## API Endpoints

| Endpoint | Beskrivning |
|----------|-------------|
| GET /healthz | DB connectivity check |
| GET /api/v1/{kommun}/politiker | Lista/filtrera politiker |
| GET /api/v1/{kommun}/politiker/{id} | Enskild politiker |
| GET /api/v1/{kommun}/möten | Lista sammanträden |
| GET /api/v1/{kommun}/beslut | Lista/sök beslut |
| GET /api/v1/{kommun}/beslut/{id} | Beslut med alla kopplingar |
| GET /api/v1/{kommun}/budget | Budget per nämnd |
| GET /api/v1/{kommun}/graf | Graf översikt/filtrering |
| GET /api/v1/{kommun}/graf/node/{id} | Traversera graf |
| GET /api/v1/{kommun}/metrics | Demokratiska nyckeltal |
| GET /api/v1/{kommun}/sök?q= | Fritextsökning |
| GET /docs | Swagger UI |
| GET /openapi.json | OpenAPI 3.1 spec |

## Datamodell (Knowledge Graph)

### Node types (9):
paragraf, organisation, bolag, politiker, möte, leverantör, lag, dokument, budget

### Edge types (14):
sitter_i, röstade_ja, röstade_nej, röstade_avstår, reserverade_sig, yrkat, jävsanmälan, bolagsuppdrag, uppdrag_till, hänvisar_till, beslut_av, finansierar, nämner, regleras_av

## Metrics (automatiska KPI:er)

- **Beslutskraft:** bifall vs bordläggning (med orsaksanalys: tid/interpellation/tidigare)
- **Konsensus:** % beslut utan votering
- **Partilojalitet:** per parti (S 100% ja, SD 0% ja, C 88% swing)
- **Aktivitet:** jävsanmälningar, reservationer, yrkanden

## Kända begränsningar

1. Endast 2025-2026 protokoll parsade (2023-2024 finns som handlingar men ej graph-parsade)
2. Law extraction regex hittar få lagar (behöver förbättras)
3. Speaker attribution ej implementerad (väntar på yttrandeprotokoll-parser)
4. Allabolag: 35/125 politiker ej hittade (vanliga namn, nyvalda)
5. Transkriptionskvalitet: ~6/10 (tillräckligt för search, ej för publicering)

## Nästa steg (prioritetsordning)

1. **Speaker attribution** — parsa yttrandeprotokoll, koppla talare till whisper-text
2. **2023-2024 protokoll** — kör parse-protokoll på alla 24 möten
3. **Deploy** — Hetzner/GleSYS, docker compose up, domän
4. **Frontend** — Astro landing + politician profile page
5. **Förbättra law regex** — fler SFS-referenser
6. **Ratsit.se scraper** — inkomst + fastigheter per politiker
7. **Email-automatisering** — begäran om allmän handling (Alaveteli-inspirerad)

## Referenser (docs/reference/)

| Källa | Relevans |
|-------|----------|
| theyworkforyou | Parlamentarisk transparens (UK) |
| decidim | Medborgardeltagande (Spanien) |
| riksdagskollen | Riksdagsdata (Sverige) |
| abgeordnetenwatch | Bundestag-monitoring (Tyskland) |
| everypolitician | Global politiker-data |
| partiguiden | Riksdagspartier (Sverige) |
| openparlamento | Parlamentet (Italien) |
| unstructured | ETL arkitektur-referens |
| open-source-sverige | Riksdagen motion, DIGG, offentligkod.se |
| alaveteli | FOI request platform (mySociety) |
| forsakringskassan-design | Designsystem/accessibility |
| riksarkivet-htrflow | AI text recognition pipeline |

## Teknisk skuld

- [ ] Vitest hittar test-filer i docs/reference (behöver root vitest.config)
- [ ] `data/` pushas till git (~200MB, bör vara Git LFS vid >500MB)
- [ ] getSchema() returnerar null men alla endpoints kontrollerar ej
- [ ] Inga tester för parsers (bara API)
- [ ] Whisper output har repetitioner på chunk-gränser (behöver overlap/dedup)
