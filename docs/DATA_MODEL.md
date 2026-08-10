# Datamodell

> **Status:** Entiteterna nedan (Organisation, Politiker, Möte, Ärende, Debatt, Budget,
> Leverantör) beskriver domänen och stämmer konceptuellt. Men produktions-DB:n
> implementerar dem **inte** som separata typade tabeller — se "PostgreSQL-schema
> (verklig)" nedan, som ersätter det tidigare planerade schemat. Modellen lever nu i
> `data/graf/*.json` som en generisk nod/kant-graf (129 filer, 26 425 noder,
> 105 559 kanter, 20 nodtyper, 40 kanttyper — fullständig lista i
> `docs/PROGRESS.md`), inte i separata SQL-tabeller.

## Entiteter

### Kommun (tenant)

```json
{
  "id": "goteborg",
  "namn": "Göteborgs Stad",
  "invånare": 600000,
  "url": "https://goteborg.se"
}
```

### Organisation (nämnd/bolag/styrelse)

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "namn": "Nämnden för Intraservice",
  "typ": "nämnd",
  "förälder_id": "uuid (kommunstyrelsen)",
  "ledamöter": ["uuid", "uuid"]
}
```

### Politiker

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "förnamn": "Anna",
  "efternamn": "Svensson",
  "parti": "C",
  "foto_url": "/politiker/anna-svensson.jpg",
  "email": "anna.svensson@politiker.goteborg.se",
  "uppdrag": [
    {
      "organisation_id": "uuid",
      "roll": "ledamot",
      "från": "2022-10-15",
      "till": null
    }
  ]
}
```

### Möte

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "organisation_id": "uuid",
  "datum": "2025-04-24",
  "typ": "sammanträde",
  "video_url": "https://goteborg.webbtvkf.se/?20250424",
  "protokoll_pdf": "/dokument/kf-2025-04-24.pdf",
  "ärenden": ["uuid", "uuid"]
}
```

### Ärende (beslutspunkt)

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "möte_id": "uuid",
  "paragraf": "§ 12",
  "rubrik": "Motion om öppen källkod vid kommunala IT-upphandlingar",
  "typ": "motion",
  "inlämnad_av": ["uuid"],
  "inlämnad_datum": "2025-01-15",
  "beslut": "bifall",
  "beslut_datum": "2025-04-24",
  "votering": {
    "ja": 45,
    "nej": 12,
    "avstår": 4,
    "per_ledamot": [
      {"politiker_id": "uuid", "röst": "ja"},
      {"politiker_id": "uuid", "röst": "nej"}
    ]
  },
  "dokument": ["uuid"],
  "debatt_id": "uuid"
}
```

### Debatt (anförande, källa: Yttrandeprotokoll)

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "möte_id": "uuid",
  "ärende_id": "uuid",
  "anföranden": [
    {
      "politiker_id": "uuid",
      "text": "Herr ordförande, jag vill...",
      "typ": "anförande"
    }
  ]
}
```

### Budget

```json
{
  "kommun_id": "goteborg",
  "år": 2026,
  "poster": [
    {
      "nämnd_id": "uuid",
      "namn": "Nämnden för Intraservice",
      "intäkter": 1348000000,
      "kostnader": 1340000000,
      "kommunbidrag": 142000000
    }
  ]
}
```

### Leverantör

```json
{
  "id": "uuid",
  "kommun_id": "goteborg",
  "namn": "Microsoft Ireland Operations Ltd",
  "org_nr": "...",
  "avtal": [
    {
      "beskrivning": "Programvarulicenser M365",
      "värde_kr": 90000000,
      "start": "2023-01-01",
      "slut": "2026-12-31",
      "upphandling_id": "uuid"
    }
  ]
}
```

## Relationer

```
Kommun 1──N Organisation
Organisation N──M Politiker (via uppdrag)
Organisation 1──N Möte
Möte 1──N Ärende
Ärende 1──1 Votering
Ärende N──1 Debatt
Ärende N──M Politiker (inlämnad_av)
Debatt 1──N Anförande
Anförande N──1 Politiker
Kommun 1──N Budget
Kommun 1──N Leverantör
```

## PostgreSQL-schema (verklig, `packages/api/src/db/seed.ts`)

Organisation/Möte/Ärende/Debatt/Budget/Leverantör ovan blev **inte** egna
tabeller. `seed.ts` droppar och återskapar hela schemat vid varje deploy (DB
är ett rent härlett artefakt av `data/`) och bygger i stället en generisk
nod/kant-graf plus fyra typade specialtabeller:

```sql
CREATE SCHEMA goteborg;

CREATE TABLE goteborg.politiker (
    id UUID PRIMARY KEY,
    fornamn TEXT NOT NULL,
    efternamn TEXT NOT NULL,
    parti TEXT NOT NULL,
    email TEXT,
    foto_url TEXT,
    sociala JSONB,
    uppdrag JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE goteborg.kandidater (
    id TEXT PRIMARY KEY,
    namn TEXT NOT NULL,
    parti TEXT NOT NULL,
    parti_namn TEXT,
    listplats INT,
    alder INT,
    kon TEXT,
    faststalld BOOLEAN NOT NULL DEFAULT false,
    politiker_id UUID REFERENCES goteborg.politiker(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Organisation, Möte, Ärende, Debatt/Anförande, Budget, Leverantör m.fl.
-- lever här som noder — inga egna tabeller per entitetstyp.
CREATE TABLE goteborg.graf_nodes (
    id TEXT PRIMARY KEY,
    typ TEXT NOT NULL,          -- 'paragraf' | 'möte' | 'organisation' | 'anförande' | 'budget' | ... (20 typer)
    label TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    fts tsvector GENERATED ALWAYS AS
        (to_tsvector('swedish', label || ' ' || coalesce(data->>'fulltext', ''))) STORED
);

CREATE TABLE goteborg.graf_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id TEXT NOT NULL REFERENCES goteborg.graf_nodes(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES goteborg.graf_nodes(id) ON DELETE CASCADE,
    typ TEXT NOT NULL,          -- 'röstade_ja' | 'talade_i' | 'beslut_av' | ... (40 typer, se docs/PROGRESS.md)
    label TEXT,
    data JSONB
);

CREATE TABLE goteborg.dokument (   -- begäran-svar, sökbara
    id TEXT PRIMARY KEY,
    titel TEXT NOT NULL,
    typ TEXT NOT NULL,
    namnd TEXT NOT NULL,
    datum TEXT NOT NULL,
    kalla TEXT NOT NULL,
    innehall TEXT NOT NULL,
    graf_nod TEXT
);

CREATE TABLE goteborg.analys (     -- analyslagret, se docs/SPEC-ANALYS.md
    arende_nr TEXT PRIMARY KEY,
    organ TEXT NOT NULL,
    rubrik TEXT NOT NULL,
    analyserbar BOOLEAN NOT NULL,
    data JSONB NOT NULL,           -- härledd (steg 1-2, deterministisk)
    ai JSONB                       -- null tills subagent skrivit steg 3
);
```

Ingen `CREATE SCHEMA per tenant`-loop — bara `goteborg` finns i dag; se
`docs/SAAS.md` för multi-tenant-planen (ej implementerad).

## JSON-filer (verklig)

`data/` innehåller betydligt fler kategorier än den ursprungliga MVP-listan:

```
data/
├── graf/         # 129 filer — ryggraden, seedas till graf_nodes/graf_edges
├── analys/       # AI-analyslagret (beslut.json, ai/<ärendeNr>.json, ARBETSLOGG.md)
├── politiker/    # Rå scrape-data innan graf-generering
├── beslut/       # beslut.json — källa för analyslagrets ärendekö
├── budget/       # Budget-PDF-derivat innan de blir graf-noder
├── debatter/     # Yttrandeprotokoll-derivat
├── dokument/     # Begäran-relaterat, innan/utan graf_nod
├── inbox/        # Rå begäran-svar (PDF) — se docs/BEGARAN.md
├── kolada/       # Kolada-nyckeltal (rå)
├── lon/          # Löneuppgifter (förvaltningsdirektörer m.fl.)
├── revision/     # Revisionsrapporter (rå)
└── sources/      # Diverse källunderlag
```

Pipelinen (`packages/pipeline`) genererar `data/graf/*.json`; `pnpm --filter
@daf/api db:seed` laddar dem i `graf_nodes`/`graf_edges`. Astro (`packages/web`)
hämtar från en körande API-instans vid build (`getStaticPaths`), inte direkt
från JSON-filerna.
