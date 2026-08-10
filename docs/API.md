# API Documentation

> Base URL: `http://localhost:3000` (dev) / `https://api.dearbetarfordig.se` (prod)

## Overview

```bash
curl localhost:3000/
```

`GET /` renders an HTML landing page (links to `/openapi.json` and `/docs`),
not JSON — check `/stats` for machine-readable service info instead. Full
route list, request/response schemas: `GET /openapi.json` (OpenAPI 3.1) or
`GET /docs` (Swagger UI).

Every `GET` under `/v1/*` returns a **HAL envelope**: collections as
`{ _embedded: { items: [...] }, _links, total }`, single resources as
`{ _embedded: { item: {...}, related?: {...} }, _links }`. The examples below
show the raw item/resource shape for readability — wrap it in `_embedded`
per the pattern above. Exceptions that return flat JSON instead of HAL:
`/graf`, `/graf/node/{id}`, `/stats`, `/metrics`.

`POST`/`PUT`/`PATCH`/`DELETE` on `/v1/*` return `405` with an `Allow: GET,
OPTIONS` header — the API is read-only by design. Responses are rate-limited
and served with `ETag` + `Cache-Control: public, max-age=300` (data only
changes on the weekly scraper run).

---

## Politiker

### Lista alla politiker

```
GET /v1/{kommun}/politiker
```

| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| kommun | path | Kommun-ID (`goteborg`) |
| parti | query | Filtrera på parti (`S`, `M`, `V`, `SD`, `L`, `MP`, `D`, `KD`, `C`) |

**Exempel:**
```bash
curl localhost:3000/v1/goteborg/politiker?parti=M
```

**Svar (HAL-collection):**
```json
{
  "_embedded": {
    "items": [
      {
        "id": "1e79ebce-61ef-49f0-bbb1-e9de383224ba",
        "namn": "Anders Sundberg",
        "parti": "M",
        "email": "anders.sundberg@politiker.goteborg.se",
        "antalUppdrag": 7,
        "_links": { "self": { "href": "/v1/goteborg/politiker/1e79ebce-..." } }
      }
    ]
  },
  "_links": { "self": { "href": "/v1/goteborg/politiker?parti=M" } },
  "total": 23
}
```

### Enskild politiker

```
GET /v1/{kommun}/politiker/{id}
```

**Svar:** Full profil med alla uppdrag (organisation, roll, tidsperiod), HAL-resource.

### Övriga politiker-endpoints

| Endpoint | Beskrivning |
|---|---|
| `GET /v1/{kommun}/politiker/{id}/arvode` | Fast + förrättningsarvode (PDF-verifierat) |
| `GET /v1/{kommun}/politiker/{id}/profil` | Uppdrag + möten sammanslaget |
| `GET /v1/{kommun}/politiker/{id}/anforanden` | Alla anföranden av politikern |

---

## Knowledge Graph

### Översikt

```
GET /v1/{kommun}/graf
```

**Svar:**
```json
{
  "nodes": [
    { "typ": "paragraf", "antal": 53 },
    { "typ": "organisation", "antal": 50 },
    { "typ": "nämnd", "antal": 36 }
  ],
  "edges": 244
}
```

`GET /v1/{kommun}/graf` är **en** endpoint med tre olika svarsformer beroende
på query-param (dokumenterat i OpenAPI-schemat som `z.any()` av samma skäl —
det finns ingen gemensam typ att ge dem):

### Graf per datum

```
GET /v1/{kommun}/graf?datum=2025-11-27
```

→ `{ nodes: [...], edges: [...], total }`. Alla noder och kanter relaterade till ett sammanträde (matchar `data->>'datum'` eller mötesnoden).

### Graf per typ

```
GET /v1/{kommun}/graf?typ=paragraf
```

→ `{ antal, total, nodes: [...] }`. Alla noder av angiven typ (paginerad, `limit`/`offset`, default 500 max 5000).

### Graf utan filter

```
GET /v1/{kommun}/graf
```

→ `{ nodes: [{ typ, antal }, ...], edges: <totalt antal> }`. Antal per nodtyp — se `docs/PROGRESS.md` för de 20 typerna och deras aktuella antal.

Gemensamt: `?fulltext=true` tar med paragrafers/anförandens fulltext i svaret
(annars ersätts fältet med `<fält>Tecken`, dess längd — ett fullt möte med
fulltext kan bli >100 MB).

### Traversera graf — enskild nod

```
GET /v1/{kommun}/graf/node/{id}
```

| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| id | path | Node-ID (URL-encoded, t.ex. `kf-2025-11-27-%C2%A7491`) |

**Exempel:**
```bash
curl localhost:3000/v1/goteborg/graf/node/kf-2025-11-27-§491
```

**Svar:**
```json
{
  "node": {
    "id": "kf-2025-11-27-§491",
    "typ": "paragraf",
    "label": "§ 491 Kompletterande budget oktober 2025",
    "data": {
      "paragrafNr": "491",
      "ärendeNr": "SLK-2025-00636",
      "beslut": "bifall",
      "votering": { "ja": 40, "nej": 37, "avstår": 3 },
      "röster": [
        { "namn": "Aslan Akbas", "parti": "S", "röst": "ja" },
        { "namn": "Axel Josefson", "parti": "M", "röst": "nej" }
      ]
    }
  },
  "edges": [
    { "from_id": "kf-2025-11-27-§491", "to_id": "org-socialnämnden-nordost", "typ": "uppdrag_till" },
    { "from_id": "kf-2025-11-27-§491", "to_id": "org-exploateringsnämnden", "typ": "uppdrag_till" },
    { "from_id": "möte-kf-2025-11-27", "to_id": "kf-2025-11-27-§491", "typ": "beslut_av" }
  ],
  "related": [
    { "id": "org-socialnämnden-nordost", "typ": "organisation", "label": "socialnämnden Nordost" },
    { "id": "möte-kf-2025-11-27", "typ": "möte", "label": "KF Sammanträde 2025-11-27" }
  ]
}
```

---

## Budget

Budget-data finns i grafen som noder av typ `nämnd` och `budget`.

```bash
# Alla nämnder med belopp
curl localhost:3000/v1/goteborg/graf?typ=nämnd

# Specifik nämnd — visa alla kopplingar (budget + beslut)
curl localhost:3000/v1/goteborg/graf/node/nämnd-grundskolenämnden
```

---

## Möten, förvaltningar, löner, dokument, kandidater, sök, trender

Byggda efter att denna doc senast var komplett — inte tidigare listade här:

| Endpoint | Beskrivning |
|---|---|
| `GET /v1/{kommun}/möten` | Alla sammanträden (KF+KS) |
| `GET /v1/{kommun}/möten/{datum}` | Ett sammanträde med sina paragrafer |
| `GET /v1/{kommun}/möten/{datum}/anföranden` | Anföranden vid mötet (Yttrandeprotokoll) |
| `GET /v1/{kommun}/forvaltningar` | Alla förvaltningar |
| `GET /v1/{kommun}/forvaltningar/{id}` | En förvaltning |
| `GET /v1/{kommun}/lon/direktorer` | Förvaltningsdirektörers löner |
| `GET /v1/{kommun}/lon/direktorer/{id}/resultat` | En direktörs förvaltnings resultat |
| `GET /v1/{kommun}/dokument` | Begäran-dokument (se `docs/BEGARAN.md`) |
| `GET /v1/{kommun}/dokument/sök` | Fritext i dokumenten |
| `GET /v1/{kommun}/dokument/{id}` | Enskilt dokument |
| `GET /v1/{kommun}/kandidater` | 2026 års valkandidater |
| `GET /v1/{kommun}/sök` | Fritext över hela materialet (Postgres FTS, `swedish`-ordbok) |
| `GET /v1/{kommun}/trender` | Kolada-nyckeltal per nämnd över tid |

---

## Statistik

```
GET /v1/{kommun}/stats
```

**Svar:**
```json
{
  "kommun": "goteborg",
  "politiker": 125,
  "partier": { "S": 33, "M": 23, "V": 20, "SD": 14, "L": 8, "MP": 8, "D": 8, "KD": 6, "C": 5 },
  "graf": { "nodes": 148, "edges": 244 }
}
```

---

## Nodtyper (graf)

| Typ | Beskrivning | Exempel-ID |
|-----|-------------|------------|
| `paragraf` | KF-beslut (§) | `kf-2025-11-27-§491` |
| `möte` | KF-sammanträde | `möte-kf-2025-11-27` |
| `organisation` | Nämnd/bolag (från beslut) | `org-socialnämnden-nordost` |
| `nämnd` | Nämnd (från budget) | `nämnd-grundskolenämnden` |
| `budget` | Kommunbudget (root) | `budget-2026` |
| `lag` | Lagrum (SFS) | `sfs-2017:725` |
| `leverantör` | IT/tjänst-leverantör | `leverantör-cgi-sverige-ab` |
| `dokument` | Begäran-dokument | `doc-intraservice-arsrapport-2025` |

## Kanttyper (graf)

| Typ | Betydelse |
|-----|-----------|
| `beslut_av` | Möte → Beslut |
| `regleras_av` | Beslut → Lag |
| `uppdrag_till` | Beslut → Organisation |
| `hänvisar_till` | Beslut → Organisation/Beslut |
| `bordlagd_från` | Beslut → Tidigare beslut |
| `finansierar` | Budget → Nämnd |
| `köper_av` | Nämnd → Leverantör |
| `ingår_i` | Nämnd → Tjänsteområde |
| `nämner` | Dokument → Leverantör |

---

## Analys per ärende

Beslutets detaljsvar bäddar in analysen under `_embedded.related.analys`. Nyckeln
är **ärendenumret**, inte paragrafen: samma ärende kan behandlas i flera §§ innan
det avgörs, så alla paragrafer i kedjan får samma analys.

```bash
curl "localhost:3000/v1/goteborg/beslut/kf-2026-06-11-%C2%A7237" \
  | jq '._embedded.related.analys'
```

```json
{
  "ärendeNr": "SLK-2025-00122",
  "härledd": {
    "process": { "enighet": "delad", "bordlagd_antal": 2, "handläggningsdagar": 78, "votering": { "ja": 43, "nej": 29 } },
    "underlag": { "har_handling": true, "nämner_konsekvensanalys": false },
    "ekonomi": { "belopp_mnkr": [], "finansiering_osäker": true, "citat": "…ännu oklart om…" }
  },
  "ai": {
    "maskingenererad": true,
    "modell": "claude-opus-5",
    "granskad_av": null,
    "riktning": "blandad",
    "confidence": "medium",
    "sammanfattning": "…",
    "nyckelpunkter": [{ "ton": "varning", "text": "Beslutet innehåller inget belopp…" }],
    "talar_för": [{ "text": "…", "källa": "kf-2026-06-11-§237" }],
    "talar_emot": [{ "text": "…", "källa": "kf-2026-06-11-§229" }],
    "beslutskvalitet": { "kostnad_redovisad": false, "finansiering_klar": false, "konsekvenser_utredda": true, "mål_mätbart": false, "uppföljning_bestämd": true },
    "rekommendation": { "röst": "avstår", "motivering": "…", "skulle_ändras_av": "…" },
    "analys_md": "## Vad som beslutades\n…",
    "källor": [{ "typ": "internt", "ref": "kf-2026-06-11-§237", "vad": "beslutstext och tjänsteutlåtande" }]
  }
}
```

**`härledd` och `ai` är avsiktligt skilda fält.** Det första är härlett ur
protokoll och handling — fakta. Det andra är skrivet av en språkmodell. En klient
som slår ihop dem gör det medvetet, inte för att schemat bjöd in till det.

`ai` är `null` tills en analys finns (i skrivande stund 26 av 1352 ärenden — 331
står i kö, se `data/analys/ARBETSLOGG.md`), och
seedas bara om dess `källa_hash` fortfarande matchar ärendet — har protokollet
eller handlingen ändrats sedan analysen skrevs hör texten inte längre ihop med
sitt underlag och visas inte.

Fältens innebörd och kraven på dem: `docs/SPEC-ANALYS.md`.

---

## Metrics (demokratiska nyckeltal)

```
GET /v1/{kommun}/metrics
```

Automatiskt beräknade KPI:er baserat på alla analyserade sammanträden.

**Svar:**
```json
{
  "kommun": "goteborg",
  "period": "2022-2026",
  "beslutskraft": {
    "totalt": 40,
    "bifall": 14,
    "bordläggning": 26,
    "beslutskraftProcent": 35,
    "bordläggningsorsaker": {
      "tid": 23,
      "interpellation_väntar": 2,
      "tidigare_bordlagd": 1
    },
    "analys": "Fler ärenden bordläggs än bifalls — indikerar överbelastad dagordning"
  },
  "konsensus": {
    "totaltÄrenden": 53,
    "utanVotering": 40,
    "medVotering": 13,
    "konsensusgradProcent": 75
  },
  "voteringar": {
    "antal": 13,
    "snittJa": 45,
    "snittNej": 35
  },
  "partilojalitet": {
    "S": { "röster": 176, "ja": 176, "nej": 0, "jaProcent": 100 },
    "M": { "röster": 120, "ja": 15, "nej": 104, "jaProcent": 13 },
    "C": { "röster": 24, "ja": 21, "nej": 0, "avstår": 3, "jaProcent": 88 }
  }
}
```

### Bordläggningsorsaker

| Orsak | Betydelse |
|-------|-----------|
| `tid` | Sammanträdet gick över tid (arbetsordning) — ärenden bordläggs automatiskt |
| `interpellation_väntar` | Interpellant eller svaranden ej närvarande |
| `tidigare_bordlagd` | Ärendet var redan bordlagt från förra mötet |
| `övrigt` | Annan orsak |

---

## Felhantering

```json
{ "error": "Politiker inte hittad" }
```

HTTP-statuskoder: `200` OK, `404` Not found.

---

## Autentisering

Ingen. API:et är öppet — public data, public API.
