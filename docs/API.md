# API Documentation

> Base URL: `http://localhost:3000` (dev) / `https://api.dearbetarfordig.se` (prod)

## Overview

```bash
curl localhost:3000/
```

```json
{
  "name": "De Arbetar För Dig — API",
  "version": "0.2.0",
  "licens": "AGPL-3.0",
  "databas": "PostgreSQL"
}
```

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

**Svar:**
```json
{
  "kommun": "goteborg",
  "antal": 23,
  "politiker": [
    {
      "id": "1e79ebce-61ef-49f0-bbb1-e9de383224ba",
      "namn": "Anders Sundberg",
      "parti": "M",
      "email": "anders.sundberg@politiker.goteborg.se",
      "antalUppdrag": 7
    }
  ]
}
```

### Enskild politiker

```
GET /v1/{kommun}/politiker/{id}
```

**Svar:** Full profil med alla uppdrag (organisation, roll, tidsperiod).

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

### Graf per datum

```
GET /v1/{kommun}/graf?datum=2025-11-27
```

Returnerar alla noder och kanter relaterade till ett KF-sammanträde.

### Graf per typ

```
GET /v1/{kommun}/graf?typ=nämnd
```

Returnerar alla noder av angiven typ.

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
