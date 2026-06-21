# Progress — senast uppdaterad 2026-06-21

## Siffror

| Mått | Värde |
|------|-------|
| **Graf — nodes** | 18 880 |
| **Graf — edges** | 76 096 |
| **Protokoll parsade** | 41 (2023-01 → 2026-05) |
| **Paragrafer (beslut)** | 1 731 |
| Politiker | 125 (100% med arvodesdata) |
| Anföranden (talare-kopplade) | 16 476 (94% → paragraf) |
| Organisationer (merged) | 168 |
| Bolag (allabolag.se) | 167 |
| Budgetposter (drill-down) | 151 |
| Möten (parsade) | 41 |
| Individuella röster | 17 210 (27 möten med voteringsbilagor) |
| Närvaroregistreringar | 3 243 (41 möten) |
| Transkriberade möten | 41 |
| Speaker-attributions | 39 |
| API-tester | 22/22 ✅ |

## Edge types (23)

| Typ | Antal | Beskrivning |
|-----|-------|-------------|
| talade_i | 16 476 | politiker → anförande |
| vid_möte | 16 029 | anförande → möte |
| diskuterade | 15 555 | anförande → paragraf (94% link rate) |
| röstade_ja | 8 134 | politiker → paragraf |
| röstade_nej | 5 172 | politiker → paragraf |
| närvarade | 3 243 | politiker → möte (med ankom/utgick-tid) |
| hänvisar_till | 2 801 | paragraf → organisation |
| uppdrag_till | 1 947 | paragraf → organisation |
| beslut_av | 1 784 | möte → paragraf |
| reserverade_sig | 1 616 | politiker → paragraf |
| sitter_i | 1 050 | politiker → organisation (merged nämnd) |
| yrkat | 975 | politiker → paragraf |
| röstade_avstår | 394 | politiker → paragraf |
| inlämnade_motion | 286 | politiker → paragraf |
| bolagsuppdrag | 198 | politiker → bolag |
| fördelat_till | 180 | budget → budgetpost |
| arvoderas_enligt | 125 | politiker → arvode-regler (kr/mån) |
| finansierar | 36 | budget → nämnd |
| röstade_frånvarande | 35 | politiker → paragraf |
| jävsanmälan | 26 | politiker → paragraf |
| regleras_av | 19 | paragraf → lag |
| detaljer_i | 10 | nämnd → drill-down budget |
| nämner | 5 | paragraf → leverantör |

## Milstolpar (denna session)

- ✅ **Budget-graf fixad** — top→drill-down linked (detaljer_i edges)
- ✅ **245→372 duplicate orgs merged** — politiker↔budget fully connected
- ✅ **Registrator-emails** — 16 verifierade adresser i graf-noder + docs/BEGARAN.md
- ✅ **Arvoden 2026** — 125/125 politiker med beräknad ersättning (PDF-verifierad)
- ✅ **23 nya protokoll** (2023-2024) — parser fixad för gammalt format (§ N NNNN/YY)
- ✅ **parse-voteringar.ts** — dedicated parser, 17210 individuella röster, 27 möten
- ✅ **parse-narvaro.ts** — 3243 närvaroregistreringar, 41 möten
- ✅ **Anförande→paragraf** — 94% link rate (rubrik-matching + ordinal + budget-fallback)
- ✅ **Conflict detection** — framework klar, 0 bekräftade konflikter (kommunala bolag exkluderade)
- ✅ **3 begäran skickade** — Intraservice, Inköp & upphandling, Stadsledningskontoret

## Begäran status

| Mottagare | Ämne | Skickat | Svar |
|-----------|------|---------|------|
| Intraservice | Alla IT-avtal | 2026-06-21 | Väntar |
| Inköp & upphandling | Centrala avtalslistan | 2026-06-21 | Väntar |
| Stadsledningskontoret | Förvaltningschefer + omplaceringar | 2026-06-21 | Väntar |

## Conflict detection — status

- **Metod:** Text-matching av bolagsnamn i KF-beslut rubriker
- **Resultat:** 0 bekräftade konflikter (alla false positives)
- **False positives borttagna:**
  - Kommunala bolag (Stadshus AB, Higab, etc.) — jäv gäller ej per KL 6:28§
  - Kommunala dotterbolag (Bygga Hem, Liseberg Skår, etc.)
  - Politikers namn = bolagsnamn (Cecilia Magnusson AB)
- **Nästa steg:** Leverantörsdata (via begäran) → matcha med politikers privata bolag
- **Verkligt test:** politiker.bolag == leverantör som fått avtal + politiker röstade

## Arkitektur

```
packages/pipeline/src/
├── scrapers/
│   ├── politiker.ts          # 125 KF-ledamöter (cheerio)
│   ├── youtube-kf.ts         # KF-videor (yt-dlp)
│   ├── handlingar.ts         # Handlingar + PDF-länkar (playwright)
│   └── allabolag.ts          # Bolagsengagemang (90/125 politiker)
├── parsers/
│   ├── parse-protokoll.ts    # KF-protokoll → paragraf + org + lagar (2023+2025 format)
│   ├── parse-voteringar.ts   # Voteringsbilagor → individuella röster (dedicated)
│   ├── parse-narvaro.ts      # Bilaga 1 → närvarodata (dedicated)
│   ├── parse-budget.ts       # Budget-PDF → nämnder + belopp
│   ├── parse-speakers.ts     # Yttrandeprotokoll → anföranden
│   ├── parse-inbox.ts        # Begäran-svar → leverantörer, avtal
│   └── namnd-budget-config.ts
└── transcription/
    └── run.ts                # whisper.cpp (speaker-based chunking)

packages/api/src/
├── index.ts                  # Hono REST API (OpenAPI 3.1, Swagger UI)
├── db/
│   ├── seed.ts               # JSON → PostgreSQL (med merge)
│   ├── merge-organisations.ts # Dedup org nodes at seed time
│   └── schema.ts
└── tests/api.test.ts         # 22 tests

data/graf/                    # 59 JSON-filer
├── kf-YYYY-MM-DD.json        # 41 protokoll (paragrafer, org, lagar)
├── politiker-komplett.json   # Alla politik-edges (röstade, sitter_i, bolag, jäv)
├── anforanden.json           # 16476 anföranden (talade_i, vid_möte, diskuterade)
├── arvoden-2026.json         # 125 arvodesedges (fast + förrättning)
├── narvaro.json              # 3243 närvaroedges
├── konflikter.json           # Conflict detection (0 bekräftade)
├── budget-2026.json          # Top-level budget (36 nämnder)
└── budget-*-2026.json        # 10 drill-down budgetar
```

## API endpoints

| Endpoint | Beskrivning |
|----------|-------------|
| GET /politiker | Lista (filter: parti, limit) |
| GET /politiker/:id | Detalj med uppdrag |
| GET /politiker/:id/arvode | Fast + förrättningsarvode (PDF-verifierat) |
| GET /möten | Alla sammanträden |
| GET /beslut | Sök/filtrera paragrafer |
| GET /beslut/:id | Paragraf med kopplingar |
| GET /budget | Nämnder med belopp |
| GET /graf | Översikt / filtrering per typ |
| GET /graf/node/:id | Traversering med alla edges |
| GET /sök | Fritext (politiker + nodes) |
| GET /stats | Antal politiker, partier, graf-storlek |
| GET /metrics | Beslutskraft, konsensus, partilojalitet |

## Nästa steg

1. **Parsa begäran-svar** — leverantörsdata → riktig conflict detection
2. **SNI-koder** för alla 167 bolag — bransch-matching
3. **Deploy** — Hetzner, docker compose up, domain
4. **Frontend** — Astro (politician profile + budget explorer)
5. **Ratsit** — födelseår + inkomst per politiker

## Future features

- **AgensGraph** (PostgreSQL graph extension) — Cypher queries istället för SQL joins. Relevant vid 290 kommuner / miljontals edges. https://github.com/bitnine-oss/agensgraph
- **Alla 290 kommuner** — generalisera scrapers + parsers
- **Kammarkollegiet API** — valkampanjfinansiering (öppet data)
- **Email-automation** — Proton Mail Plus / Fastmail SMTP → automatiska begäran
- **AI-sammanfattning** — LLM summary per politician portfolio
- **Webhooks** — notifikation vid nytt protokoll / nytt beslut

## Teknisk skuld

- [ ] parse-protokoll.ts: voteringsbilagor-parser broken (workaround: parse-voteringar.ts)
- [ ] `data/` i git (~large, bör vara Git LFS)
- [ ] Närvaro: bara Bilaga 1 parsad (ej frånvarande-lista explicit)
- [ ] 6% anföranden utan paragraf-koppling (frågestund utan §)
- [ ] Allabolag: 35/125 politiker ej hittade
- [ ] Allabolag-matchning kan vara felaktig för vanliga namn (bekräftat: Pär Johansson)

## Instruktioner — datainsamling per politiker

Vid Ratsit-verifiering **samla alltid**:
1. `fullständigt_namn` — alla förnamn + efternamn (t.ex. "Isabell Marina Johansson")
2. `tilltalsnamn` — det namn personen kallas (t.ex. "Marina")
3. `födelsedatum` — YYYY-MM-DD (från Ratsit URL)
4. `ålder` — nuvarande
5. `adress` — gatuadress + postnummer + ort
6. `ratsit_url` — fullständig permalink till personens Ratsit-sida
7. `inkomst` — 3 år (lön + kapital + BA + löneranking)
8. `bolagsengagemang` — alla aktiva bolag med orgnr, befattning, omsättning, vinst
9. `källa` — PDF-filnamn i docs/ratsit/

**Spara i:** `data/graf/arvoden-2026.json` under edge.data.ratsit  
**Uppdatera:** `data/politiker/goteborg.json` med fullständigt_namn

**Verifiering:**
- Kommun MÅSTE vara Göteborg (folkbokförd = valbar per KL 4:3§)
- Ålder ska matcha (±1 år från känd data)
- Tilltalsnamn ska matcha det namn vi har i politiker.goteborg.se
- Om allabolag-URL finns: kontrollera att personkod pekar på rätt person

**Kända felaktiga matchningar:**
- Pär Johansson (S) — allabolag hittade Pär Henrik Johansson, Lidingö (FEL, borttagen)
