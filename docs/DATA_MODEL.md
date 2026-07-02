# Datamodell

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
  "video_url": "https://youtube.com/watch?v=...",
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

## PostgreSQL-schema (prod)

```sql
CREATE SCHEMA goteborg;  -- en schema per tenant

CREATE TABLE goteborg.politiker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    förnamn TEXT NOT NULL,
    efternamn TEXT NOT NULL,
    parti TEXT,
    foto_url TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE goteborg.organisation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namn TEXT NOT NULL,
    typ TEXT CHECK (typ IN ('nämnd', 'bolag', 'styrelse', 'råd', 'fullmäktige')),
    förälder_id UUID REFERENCES goteborg.organisation(id)
);

CREATE TABLE goteborg.ärende (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    möte_id UUID NOT NULL,
    paragraf TEXT,
    rubrik TEXT NOT NULL,
    typ TEXT,
    beslut TEXT,
    beslut_datum DATE,
    votering_ja INT,
    votering_nej INT,
    votering_avstår INT
);

-- Full-text search
CREATE INDEX idx_ärende_fts ON goteborg.ärende
    USING GIN (to_tsvector('swedish', rubrik));
```

## JSON-filer (MVP/static)

Under MVP används flat JSON-filer i `data/`:

```
data/
├── politiker/
│   └── goteborg.json        # Alla politiker
├── beslut/
│   └── goteborg-2025.json   # Beslut per år
├── debatter/
│   └── kf-2025-04-24.json   # Anföranden per möte (Yttrandeprotokoll)
└── budget/
    └── goteborg-2026.json   # Budget per år
```

Astro läser JSON vid build → genererar statisk HTML.
