# Progress — senast uppdaterad 2026-08-10

> Siffrorna nedan är räknade direkt ur `data/graf/*.json` (129 filer) vid
> uppdateringstillfället, inte handhållna — jämför med `data/analys/ARBETSLOGG.md`
> (genererad av `korpus.ts logg`) för AI-analysläget, som är den egna sanningskällan där.

## Siffror

| Mått | Värde |
|------|-------|
| **Graf — nodes** | 26 425 |
| **Graf — edges** | 105 559 |
| **Graf — JSON-filer** | 129 |
| **Protokoll parsade — KF** | 42 (2023-01 → 2026-06) |
| **Protokoll parsade — KS** | 51 (2024-01 → 2026-06) |
| **Paragrafer (beslut)** | 3 936 |
| **Ärenden med härledd analys** | 1 352 (917 analyserbara, 331 i AI-kön) |
| **AI-analyser skrivna** | 26 (ogranskade — se `data/analys/ARBETSLOGG.md`) |
| Politiker | 125 (100% med arvodesdata) |
| Anföranden (talare-kopplade) | 18 079 |
| Organisationer (noder) | 2 055 |
| Bolag (allabolag.se) | 167 |
| Budgetposter | 134 |
| Möten (parsade, KF+KS) | 93 |
| Individuella röster (ja+nej+avstår+frånvarande) | 30 317 |
| Närvaroregistreringar | 8 663 |
| API-tester | 114 `it()`-block, 4 testfiler ✅ |

Frontend (`packages/web`, Astro) och backend (`packages/api`, Hono) är sedan
länge byggda och live — se "Arkitektur" nedan. De siffrorna ovan speglar bara
datalagret; sid-/route-inventeringen finns i `docs/SPEC.md`.

## Edge types (40)

| Typ | Antal | Beskrivning |
|-----|-------|-------------|
| röstade_ja | 18 548 | politiker → paragraf |
| talade_i | 18 079 | politiker → anförande |
| vid_möte | 18 079 | anförande → möte |
| diskuterade | 13 794 | anförande → paragraf |
| röstade_nej | 10 743 | politiker → paragraf |
| närvarade | 8 663 | politiker → möte (med ankom/utgick-tid) |
| beslut_av | 3 936 | möte → paragraf |
| hänvisar_till | 3 760 | paragraf → organisation/beslut |
| uppdrag_till | 2 104 | paragraf → organisation |
| reserverade_sig | 1 616 | politiker → paragraf |
| avser | 1 613 | paragraf → ärende/dokument |
| yrkat | 975 | politiker → paragraf |
| röstade_avstår | 959 | politiker → paragraf |
| bordlagd_från | 769 | paragraf → tidigare paragraf |
| sitter_i | 518 | politiker → organisation |
| inlämnade_motion | 286 | politiker → paragraf |
| bolagsuppdrag | 190 | politiker → bolag |
| fördelat_till | 180 | budget → budgetpost |
| finansierar | 145 | budget → nämnd |
| arvoderas_enligt | 125 | politiker → arvode-regler (kr/mån) |
| ansvarig | 90 | organisation → förvaltningsdirektör |
| innehåller | 83 | dokument/revision → underenhet |
| utfall_för | 75 | leverantörsutfall → budgetpost/nämnd |
| röstade_frånvarande | 67 | politiker → paragraf |
| jävsanmälan | 26 | politiker → paragraf |
| leder | 22 | förvaltningsdirektör → organisation |
| riktas_mot | 20 | revisionsrapport → organisation |
| regleras_av | 19 | paragraf → lag |
| nämner | 16 | paragraf/dokument → leverantör |
| ingår_i | 16 | tjänst/budgetpost → nämnd |
| levererar_till | 11 | leverantör → organisation |
| upphandlat_av | 11 | avtal → organisation |
| behandlad_i | 6 | ärende → möte |
| tillhör | 4 | budgetpost → nämnd |
| produkt_från | 3 | tjänst → leverantör |
| antagen_genom | 3 | budget/plan → paragraf |
| gift_med | 2 | politiker ↔ politiker (jäv-underlag) |
| löser_öppen_punkt | 1 | paragraf → tidigare öppen fråga |
| beslutad_i | 1 | ärende → paragraf |
| beskriver | 1 | dokument → organisation |

20 nodtyper (mot tidigare odokumenterat antal): `anförande` (18 079),
`paragraf` (3 936), `organisation` (2 055), `leverantörsutfall-månad` (1 478),
`bolag` (167), `leverantörsutfall` (135), `budgetpost` (134), `politiker`
(125), `möte` (93), `utfall` (78), `förvaltningsdirektör` (23), `revision`
(21), `revisionsrapport` (19), `lag` (17), `leverantör` (16), `budget` (15),
`tjänst` (14), `avtal` (11), `dokument` (7), `närstående` (2).

## Milstolpar

Tidiga (juni–juli 2026):

- ✅ **Budget-graf fixad** — top→drill-down linked
- ✅ **245→372 duplicate orgs merged** — politiker↔budget fully connected
- ✅ **Registrator-emails** — 16 verifierade adresser i graf-noder + docs/BEGARAN.md
- ✅ **Arvoden 2026** — 125/125 politiker med beräknad ersättning (PDF-verifierad)
- ✅ **Anförande→paragraf** — länkning (rubrik-matching + ordinal + budget-fallback)
- ✅ **Whisper-transkribering borttagen** — Yttrandeprotokoll (officiell PDF med fullständig text) täcker alla möten och är 100% korrekt utan ljudpipeline; `packages/pipeline/src/transcription/` borttagen

Senare (juli–augusti 2026), tidigare odokumenterat i denna fil:

- ✅ **Frontend byggd och live** — `packages/web` (Astro), 18 sidor, auto-deploy till GitHub Pages på varje push till main (`.github/workflows/ci.yml` job `deploy-pages`); se `docs/SPEC.md`
- ✅ **KS-röstextraktion** — `parse-protokoll-ks.ts` extraherar namngivna voteringar ur Omröstning-sektioner i 51 KS-protokoll (se `docs/SPEC-KS-VOTERINGAR.md`, nu klar)
- ✅ **AI-analyslager** — `beslutsanalytiker`-subagent, 26 ärenden analyserade av 331 i kön (se `docs/SPEC-ANALYS.md`, `data/analys/ARBETSLOGG.md`)
- ✅ **Nya datavyer** — förvaltningsdirektörers löner/resultat, 2026 års valkandidater, revisionsrapporter, Intraservice-avtal, budgetavvikelser (utfall) per nämnd
- ✅ **Fritextsökning** — Postgres FTS (`swedish`-ordbok) via `/v1/{kommun}/sök`, Pagefind medvetet valbort
- ✅ **Generisk graf-lagring i DB** — `graf_nodes`/`graf_edges` (JSONB) ersatte den typade ER-modellen som ursprungligen var planerad (se `docs/DATA_MODEL.md`)

## Begäran status

| Mottagare | Ämne | Skickat | Svar |
|-----------|------|---------|------|
| Intraservice | Alla IT-avtal | 2026-06-21 | ✅ Mottaget och bearbetat (avtal, delårsrapport, årsrapport, Microsoft/OpenAI-licenser i `data/inbox/` och grafen) |
| Stadsledningskontoret | Förvaltningschefer + omplaceringar | 2026-06-21 | Svar mottaget (`stadsledningskontoret_punkt3.pdf`) — **ej ännu parsat till grafen** |
| Inköp & upphandling | Centrala avtalslistan | 2026-06-21 | Väntar |

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
├── scrapers/                     # 15 skript, urval:
│   ├── politiker.ts               # 125 KF-ledamöter (cheerio)
│   ├── alla-fortroendevalda.ts    # alla förtroendevalda, alla nämnder
│   ├── webbtv-kf.ts               # KF-sändningslänkar
│   ├── handlingar.ts              # KF-handlingar + PDF-länkar (playwright)
│   ├── handlingar-ks.ts           # KS-handlingar
│   ├── download-protokoll.ts      # PDF-nedladdning innan parsning
│   ├── allabolag.ts               # Bolagsengagemang (allabolag.se)
│   ├── kandidater.ts              # 2026 års valkandidater
│   ├── kolada.ts                  # Kolada-nyckeltal per nämnd
│   ├── leverantorsfakturor.ts     # Leverantörsutfall per nämnd/månad
│   └── stadsrevisionen.ts         # Revisionsrapporter
├── parsers/                      # 20+ skript, urval:
│   ├── parse-protokoll.ts         # KF-protokoll → paragraf + org + lagar
│   ├── parse-protokoll-ks.ts      # KS-protokoll, inkl. Omröstning-sektioner
│   ├── parse-voteringar.ts        # KF-voteringsbilagor → individuella röster
│   ├── parse-narvaro.ts           # Bilaga 1 → närvarodata
│   ├── parse-budget.ts            # Budget-PDF → nämnder + belopp
│   ├── parse-yttrandeprotokoll.ts # Yttrandeprotokoll → anföranden
│   ├── parse-delarsrapport.ts     # Delårsrapporter (Docling)
│   ├── parse-arsredovisning.ts    # Årsredovisningar
│   ├── parse-revisionsrapport.ts  # Revisionsrapporter
│   ├── parse-anforanden-graf.ts   # Anförande-noder → graf
│   ├── generate-analys.ts         # Steg 1–2 av analyslagret (deterministiskt)
│   ├── generate-organisationsstruktur.ts
│   ├── generate-utfall-historik.ts
│   ├── parse-inbox.ts             # Begäran-svar → leverantörer, avtal
│   └── namnd-budget-config.ts
└── analys/
    └── korpus.ts                  # CLI för beslutsanalytiker-subagenten (sok/hamta/arende/ko/logg)

packages/api/src/
├── index.ts                  # Hono REST API (OpenAPI 3.1 via @hono/zod-openapi, Swagger UI, HAL-svar)
├── routes/                   # politiker, beslut, möten, budget, graf, forvaltningar,
│                              # lon, dokument, kandidater, sök, trender, metrics
├── db/
│   ├── seed.ts                # JSON → PostgreSQL: typade tabeller (politiker, kandidater,
│   │                           # dokument, analys) + generisk graf_nodes/graf_edges (JSONB)
│   └── merge-organisations.ts # Dedup org-noder vid seed
└── tests/                    # 114 it()-block, 4 filer (api, merge-organisations, mark-procedurella, prefix)

packages/web/src/pages/goteborg/   # Astro, 18 sidor — se docs/SPEC.md för full lista
packages/ui/src/                   # Delade komponenter + design-tokens (Chamber, DataTable, charts/)

data/graf/                    # 129 JSON-filer, urval av kategorier:
├── kf-YYYY-MM-DD.json        # 42 KF-protokoll
├── ks-YYYY-MM-DD.json        # 51 KS-protokoll (inkl. voteringar sedan SPEC-KS-VOTERINGAR)
├── budget-*-2026.json        # budget + drill-down
├── utfall-nämnder-*.json     # budgetavvikelser
├── revision*.json            # revisionsrapporter, tidslinje, kopplingar
├── forvaltningsdirektorer-lon-2026.json
├── intraservice-*.json       # årsrapport, delårsrapport, direktupphandlingar, MS/OpenAI-avtal
├── organisationsstruktur.json
└── inbox-dokument.json       # parsade begäran-svar

data/analys/                  # AI-analyslager, separat från data/graf/ (se docs/SPEC-ANALYS.md)
├── beslut.json                # 1352 ärenden, analyserbar/skäl/prognos_kandidat
├── ai/<ärendeNr>.json         # 26 skrivna analyser
└── ARBETSLOGG.md              # genererad kölogg (korpus.ts logg)
```

## API endpoints

`packages/api/src/routes/` — samtliga under `/v1/{kommun}/…`, HAL-svar (`_embedded`/`_links`), full lista i `docs/API.md`:

| Endpoint | Beskrivning |
|----------|-------------|
| GET /politiker, /politiker/:id, /:id/arvode, /:id/profil, /:id/anforanden | Politikerdata |
| GET /möten, /möten/:datum, /möten/:datum/anföranden | KF/KS-sammanträden |
| GET /beslut, /beslut/:id, /beslut/:id/anforanden | Paragrafer + kopplingar + AI-analys |
| GET /budget, /budget/utfall | Nämnder, belopp, avvikelser |
| GET /forvaltningar, /forvaltningar/:id | Förvaltningar |
| GET /lon/direktorer, /lon/direktorer/:id/resultat | Förvaltningsdirektörers löner/resultat |
| GET /dokument, /dokument/sök, /dokument/:id | Begäran-dokument |
| GET /kandidater | 2026 års valkandidater |
| GET /graf, /graf/node/:id | Grafgenomsökning |
| GET /sök | Fritext (Postgres FTS) |
| GET /trender | Kolada-nyckeltal över tid |
| GET /stats, /metrics | Aggregat, demokratiska nyckeltal |

## Nästa steg

1. **Parsa Stadsledningskontoret-svaret** (`stadsledningskontoret_punkt3.pdf`) till grafen
2. **Skicka/följ upp Inköp & upphandling** — enda begäran som fortfarande väntar
3. **SNI-koder** för alla 167 bolag — bransch-matching
4. **Fortsätt AI-analyskön** — 305 av 331 ärenden kvar (`data/analys/ARBETSLOGG.md`)
5. **Ratsit** — födelseår + inkomst per politiker (se instruktioner nedan; hittills bara 1 politiker klar)

Punkterna "Deploy" och "Frontend" som tidigare stod här är gjorda — se Milstolpar.

## Future features

- **AgensGraph** (PostgreSQL graph extension) — Cypher queries istället för SQL joins. Relevant vid 290 kommuner / miljontals edges. https://github.com/bitnine-oss/agensgraph
- **Alla 290 kommuner** — generalisera scrapers + parsers (fortfarande enbart Göteborg hårdkodat, se `docs/SAAS.md`)
- **Kammarkollegiet API** — valkampanjfinansiering (öppet data)
- **Email-automation** — Proton Mail Plus / Fastmail SMTP → automatiska begäran
- **Webhooks** — notifikation vid nytt protokoll / nytt beslut

## Teknisk skuld

- [ ] parse-protokoll.ts: voteringsbilagor-parser broken (workaround: parse-voteringar.ts)
- [ ] `data/` i git (~large, bör vara Git LFS)
- [ ] Närvaro: bara Bilaga 1 parsad (ej frånvarande-lista explicit)
- [ ] Anföranden utan paragraf-koppling (frågestund utan §)
- [ ] Allabolag: en del politiker ej hittade eller möjligen felmatchade på vanliga namn (bekräftat: Pär Johansson)
- [ ] Lager 2 (underlag+ekonomi) i analysmodellen begränsas av att bara 446/917 handlingar är nedladdade — `fetch-handlingar-text.ts` höjer täckningen
- [ ] Ratsit-instruktionerna nedan är i praktiken oanvända (1 politiker klar av 125) — antingen driv igenom eller ta bort avsnittet

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
