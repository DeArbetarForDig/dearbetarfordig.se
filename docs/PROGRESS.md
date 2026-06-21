# Progress — senast uppdaterad 2026-06-21

## Siffror

| Mått | Värde |
|------|-------|
| **Graf — nodes** | 17 917 |
| **Graf — edges** | 31 126 |
| Politiker | 125 |
| Anföranden (talare-kopplade) | 16 476 |
| Paragrafer (beslut) | 801 |
| Organisationer (merged) | 161 |
| Bolag (allabolag.se) | 167 |
| Budgetposter (drill-down) | 151 |
| Möten (parsed) | 17 |
| Transkriberade möten | 41 |
| Speaker-attributions | 39 |
| Handlingar (PDF-länkar) | 1835+ |
| API-tester | 22/22 ✅ |

## Edge types (15)

| Typ | Antal | Beskrivning |
|-----|-------|-------------|
| talade_i | 16 476 | politiker → anförande |
| reserverade_sig | 4 782 | politiker → paragraf |
| röstade_ja | 2 704 | politiker → paragraf |
| röstade_nej | 1 794 | politiker → paragraf |
| hänvisar_till | 1 267 | paragraf → organisation |
| sitter_i | 1 078 | politiker → organisation |
| uppdrag_till | 890 | paragraf → organisation |
| beslut_av | 801 | möte → paragraf |
| yrkat | 459 | politiker → paragraf |
| inlämnade_motion | 286 | politiker → paragraf |
| bolagsuppdrag | 233 | politiker → bolag |
| fördelat_till | 180 | budget → budgetpost |
| finansierar | 36 | budget → nämnd |
| röstade_avstår | 95 | politiker → paragraf |
| detaljer_i | 10 | nämnd → drill-down budget |

## Senaste milstolpar

- ✅ **Merge 245 duplicate orgs** — politiker↔budget nu fully connected
- ✅ **10/10 nämnd-budgetar** — drill-down från 43 mdr till enskilda poster
- ✅ **Speaker attribution** — 16 476 anföranden kopplade till politiker
- ✅ **Motioner** — 286 motioner länkade till inlämnare
- ✅ **Allabolag** — 167 bolag, 90 politiker med bolagsuppdrag
- ✅ **Registrator-emails** — 16 verifierade adresser i graf-noder
- ✅ **Begäran skickad** — Intraservice + Inköp & upphandling (väntar svar)

## Pågående / väntar

- ⏳ **Svar på begäran** — väntar 1-5 arbetsdagar (skickat 2026-06-21)
- ⏳ **2023-2024 protokoll** — handlingar scraped, ej parsade genom parse-protokoll
- ⏳ **Deploy** — Hetzner/GleSYS (väntar beslut)

## Nästa steg (prioritet)

1. **Parsa svar från begäran** — kör parse-inbox.ts på mottagna avtalslister
2. **2023-2024 protokoll** — kör parse-protokoll batch (24 möten)
3. **Deploy** — docker compose up på Hetzner
4. **Frontend** — Astro minimal UI (sal-vy + politician profile)
5. **Conflict detection** — automatisk flaggning (politiker→bolag + beslut→bolag)

## Arkitektur

```
GitHub (DeArbetarForDig/dearbetarfordig.se)
├── packages/pipeline/
│   ├── scrapers/     politiker, youtube-kf, handlingar, allabolag
│   ├── parsers/      parse-protokoll, parse-budget, parse-speakers, parse-inbox
│   │                 namnd-budget-config, merge-organisations
│   └── transcription/ run.ts (whisper, chunked, speaker-based)
├── packages/api/
│   ├── src/index.ts   REST API (OpenAPI 3.1 + Swagger UI)
│   ├── src/db/        schema, seed (med merge), merge-organisations
│   └── src/tests/     22 tests (smoke + investigation + integration)
├── packages/ui/
│   └── src/tokens/css/ global.css (partifärger), svg.css, light/dark
├── data/
│   ├── politiker/     goteborg.json, bolagsengagemang-goteborg.json
│   ├── beslut/        kf-handlingar-2023/2024/2025/2026.json
│   ├── debatter/      41 transcriptions + 39 speaker files
│   └── graf/          32 graph files (beslut, budget, politiker, anföranden)
├── public/            chamber SVG, icons (Lucide), seat.svg
├── docs/              PROGRESS, API, HOSTING, BEGARAN, SPEC, DATA_MODEL
├── scripts/           transcribe-all.sh
├── docker-compose.yml API + PostgreSQL + whisper (on-demand)
└── .github/workflows/ CI/CD
```

## Konfiguration

- **Font:** Inter (sans), JetBrains Mono (mono)
- **Icons:** Lucide (31 st, self-hosted SVG)
- **Partifärger:** Verifierade från partisajter (global.css)
- **DB:** PostgreSQL 16 (Docker) + Drizzle schema
- **Tests:** Vitest (22 pass)
- **Deploy:** Dockerfile + docker-compose (ej live ännu)

## Teknisk skuld

- [ ] 2023-2024 protokoll ej parsade (voteringar/yrkanden saknas för dessa)
- [ ] Whisper repetitioner på chunk-gränser (behöver overlap/dedup)
- [ ] Förskolenämnden budget — manuellt fixad (regex parsade fel)
- [ ] Idrotts budget — kort PDF, begränsat data
- [ ] `data/` i git (~500MB+, bör vara Git LFS)
- [ ] Tests hittar filer i docs/reference (vitest root config behövs)
- [ ] Allabolag: 35/125 politiker ej hittade
