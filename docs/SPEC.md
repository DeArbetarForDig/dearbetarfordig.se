# SPEC — dearbetarfordig.se

> Specifikation för MVP: Göteborg kommun

---

## Filosofi

- **Visa, inte berätta** — visualisering före text
- **Som för en 15-åring** — vardagligt språk, inga byråkratiska termer utan förklaring
- **Data-driven** — varje element backas av riktig data, inget statiskt
- **Curl-friendly** — all viktig info i HTML/SVG, fungerar utan JS
- **Progressiv förbättring** — basic fungerar överallt, interaktivitet adderas med JS

---

## Sidstruktur (MVP)

```
/goteborg/                    → Översikt (dashboard)
/goteborg/politiker           → Alla 81 ledamöter
/goteborg/politiker/[slug]    → Enskild politiker
/goteborg/beslut              → Lista med beslut
/goteborg/beslut/[id]         → Enskilt beslut + votering
/goteborg/struktur            → Hur kommunen är organiserad
/goteborg/debatter            → KF-möten med anföranden (Yttrandeprotokoll, v2)
/goteborg/budget              → Budgetvisualisering (v2)
```

---

## `/goteborg/` — Översikt

### Block 1: Salen (hero)

81 platser, som i en aula/biosalong. Varje plats = en ledamot.

```
Rad 1:  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██
Rad 2:  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██
Rad 3:  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██
...
```

| Aspekt | Implementation |
|--------|---------------|
| Rendering | SVG (statisk, pre-rendered i Astro build) |
| Färg | Partifärg (S=röd, M=blå, C=grön...) |
| Hover | Tooltip-kort med foto, namn, parti, roll |
| Click | Navigera till `/goteborg/politiker/[slug]` |
| Utan JS | SVG med `<title>` på varje plats (accessibility) |
| Responsiv | Desktop: aula-layout. Mobil: kompakt grid |
| Lib | D3 eller ren SVG template i Astro |

**Hover-kort:**
```
┌─────────────────────────────┐
│ [FOTO]  Anna Svensson       │
│         Centerpartiet (C)   │
│         Ledamot, KF         │
│         Närvaro: 92%        │
│         [Visa profil →]     │
└─────────────────────────────┘
```

**Voteringsläge** (återanvänds på `/goteborg/beslut/[id]`):
- Samma sal-layout
- Ovanpå varje plats: ikon
  - 👍 grön = Ja
  - 👎 röd = Nej
  - ✋ grå = Avstår
  - ⬜ tom = Frånvarande
- Hover visar namn + hur de röstade

---

### Block 2: Struktur — "Hur Göteborg styrs"

Interaktivt träd (SVG, D3-hierarchy):

```
          Kommunfullmäktige (KF)
          "Riksdagen för Göteborg"
          81 ledamöter — beslutar
                    │
          Kommunstyrelsen (KS)
          "Regeringen för Göteborg"
          13 ledamöter — styr
           ┌────┬────┬────┬────┐
           │    │    │    │    │
         Nämnd Nämnd Nämnd ... Nämnd
```

Varje nod:
- Formellt namn
- **Vardaglig förklaring** (t.ex. Grundskolenämnden → "Bestämmer om skolor")
- Antal ledamöter
- Klick → visar ledamöter i den nämnden

---

### Block 3: Senaste beslut

Liveflöde med de senaste besluten från KF:

```
┌─────────────────────────────────────────────┐
│ 🟢 Bifall · 12 jun 2025                    │
│ Ny cykelväg Hisingen–centrum                │
│ KF § 45 · Ja: 52  Nej: 21  Avstår: 8       │
│ [Visa votering →]                           │
├─────────────────────────────────────────────┤
│ 🔴 Avslag · 10 jun 2025                    │
│ Motion: Gratis kollektivtrafik <26 år       │
│ KF § 43 · Ja: 31  Nej: 45  Avstår: 5       │
├─────────────────────────────────────────────┤
│ 📋 Remitterad · 8 jun 2025                 │
│ Budget 2026 — förslag från KS               │
│ → Skickat till alla nämnder                 │
└─────────────────────────────────────────────┘
```

---

### Block 4: KPI-kort

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│    81    │ │   234    │ │   92%    │ │  12.4    │
│ ledamöter│ │ beslut   │ │ närvaro  │ │ mdr kr   │
│  i KF    │ │ 2025     │ │ snitt    │ │ budget   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

### Block 5: Partibalans

Donut-diagram (SVG):
- Visar mandatfördelning
- Styre (koalition) vs opposition
- Partifärger
- Hover → partinamn + antal mandat

---

## `/goteborg/politiker` — Alla ledamöter

Två vyer:

1. **Sal-vy** — samma som hero, men fullskärm med alla interaktioner
2. **List-vy** — filtrerbar tabell/grid

Filter:
- Parti (toggle per parti)
- Nämnd
- Sök (namn)

Sortering: namn, parti, närvaro

---

## `/goteborg/politiker/[slug]` — Enskild politiker

```
┌────────────────────────────────────────────────┐
│ [STORT FOTO]                                   │
│                                                │
│ Anna Svensson                                  │
│ Centerpartiet (C)                              │
│ Ledamot i Kommunfullmäktige sedan 2022         │
│                                                │
│ Uppdrag:                                       │
│ • Kommunfullmäktige — ledamot                  │
│ • Grundskolenämnden — ordförande               │
│ • Trafiknämnden — ersättare                    │
│                                                │
├────────────────────────────────────────────────┤
│ Statistik                                      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ │  92%    │ │   34    │ │   12    │          │
│ │ närvaro │ │ votering│ │ motioner│          │
│ └─────────┘ └─────────┘ └─────────┘          │
├────────────────────────────────────────────────┤
│ Senaste voteringar                             │
│ 🟢 Bifall: Ny cykelväg (12 jun)               │
│ 🔴 Avslag: Gratis buss <26 (10 jun)           │
│ 🟢 Bifall: Renovering Frölunda (3 jun)        │
└────────────────────────────────────────────────┘
```

---

## `/goteborg/beslut/[id]` — Enskilt beslut

```
┌────────────────────────────────────────────────┐
│ Motion: Ny cykelväg Hisingen–centrum           │
│ KF § 45 · 2025-06-12 · 🟢 Bifall             │
├────────────────────────────────────────────────┤
│                                                │
│           [SALEN — voteringsläge]              │
│      👍👍👍👎👎👎✋⬜ (ikoner på platser)       │
│                                                │
├────────────────────────────────────────────────┤
│ Resultat                                       │
│ ██████████████████░░░░░ 74% Ja                │
│ Ja: 52 · Nej: 21 · Avstår: 8 · Frånvarande: 0│
├────────────────────────────────────────────────┤
│ Per parti:                                     │
│ S:  14 Ja / 0 Nej    M: 2 Ja / 10 Nej        │
│ SD: 0 Ja / 11 Nej    C: 5 Ja / 0 Nej         │
│ ...                                            │
├────────────────────────────────────────────────┤
│ Tidslinje                                      │
│ ● Motion inlämnad (2025-01-15) — Anna S. (C)  │
│ │                                              │
│ ● Remitterad till KS (2025-01-20)             │
│ │                                              │
│ ● Yttrande: Trafiknämnden (2025-03-01)        │
│ │                                              │
│ ● KF debatt + beslut (2025-06-12) — BIFALL    │
└────────────────────────────────────────────────┘
```

---

## `/goteborg/struktur` — Organisationsträd

Helsidesvy av kommunens organisation:
- Trädvy (D3-hierarchy) eller Sankey
- Varje nämnd/bolag som nod
- Klickbart → visar ledamöter + senaste beslut
- **Vardagliga förklaringar** på varje nod

Exempel på förklaringar:

| Formellt namn | Vardaglig förklaring |
|---------------|---------------------|
| Kommunfullmäktige | "Riksdagen för Göteborg — här fattas alla stora beslut" |
| Kommunstyrelsen | "Regeringen — leder det dagliga arbetet" |
| Grundskolenämnden | "Bestämmer om skolor, lärare och läromedel" |
| Byggnadsnämnden | "Bestämmer vad som får byggas och var" |
| Socialnämnden | "Hjälper människor som behöver stöd" |
| Trafiknämnden | "Vägar, bussar, spårvagnar och cykelvägar" |
| Miljö- och klimatnämnden | "Skyddar naturen och hanterar klimatfrågor" |

---

## Teknisk implementation

### Sal-komponenten (återanvändbar)

```typescript
// packages/web/src/components/Chamber.astro
interface Props {
  politicians: Politiker[]
  mode: 'overview' | 'vote'
  vote?: VoteResult  // om mode=vote
}
```

- Renderas som static SVG vid build
- Enhanced med JS för hover-kort
- Responsiv: CSS container queries
- Accessibility: `role="img"`, `aria-label`, `<title>` per plats

### Datakällor

| Data | Källa | Format |
|------|-------|--------|
| Ledamöter + uppdrag | goteborg.se scraper | JSON |
| Voteringar | KF-protokoll (PDF → parser) | JSON |
| Nämnder/struktur | goteborg.se organisation | JSON |
| Foton | goteborg.se / riksdagen | WebP |
| Debatter | Yttrandeprotokoll (PDF → parser) | JSON (v2) |
| Budget | Budget-PDF → tabula | JSON (v2) |

---

## Icke-funktionella krav

| Krav | Mål |
|------|-----|
| First paint | <1s |
| JS-storlek | <50 KB (gzipped), 0 KB för basic vy |
| Accessibility | WCAG 2.1 AA |
| Responsiv | Fungerar 320px–4K |
| SEO | Varje politiker/beslut = unik URL med meta |
| Offline | Pagefind fungerar offline efter första laddning |
| Curl | `curl .../politiker/anna-svensson` → läsbar HTML |

---

## Avgränsningar (MVP)

Ingår INTE i MVP:
- [ ] Debatter (anföranden) — v2
- [ ] Budget-visualisering — v2
- [ ] Bevakningar/notifikationer — v3
- [ ] Fler kommuner — efter Göteborg fungerar
- [ ] Sök (Pagefind) — kommer med content
- [ ] AI-sammanfattningar — v2

---

## Prioritetsordning (MVP)

1. Scraper: hämta alla 81 ledamöter + foto + uppdrag
2. Sal-komponent (SVG)
3. `/goteborg/` — översikt med sal + KPI
4. `/goteborg/politiker` — lista + sal-vy
5. `/goteborg/politiker/[slug]` — profilsida
6. `/goteborg/struktur` — organisationsträd
7. Scraper: hämta voteringsdata från protokoll
8. `/goteborg/beslut` — lista
9. `/goteborg/beslut/[id]` — sal i voteringsläge
