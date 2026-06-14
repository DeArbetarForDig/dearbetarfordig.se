# Design System

## Språk / Language

- **Primärt språk:** Svenska (`sv`)
- **HTML:** `<html lang="sv">` på alla sidor
- **Meta:** `<meta http-equiv="content-language" content="sv">`
- **Open Graph:** `<meta property="og:locale" content="sv_SE">`
- **hreflang:** `<link rel="alternate" hreflang="sv" href="...">`
- **PostgreSQL FTS:** `swedish` dictionary
- **Datumformat:** `sv-SE` (2025-04-24)
- **Valuta:** SEK, formaterat med `Intl.NumberFormat('sv-SE')`
- **UI-text:** All text på svenska — knappar, labels, felmeddelanden
- **Kod:** Variabelnamn, commits, comments på engelska (open-source convention)
- **Docs:** Svenska (README, DESIGN) + engelska (API docs, CONTRIBUTING)

### Translate-friendly

- Alla UI-strängar i en central fil (`packages/shared/src/i18n/sv.ts`)
- Inga hårdkodade strängar i komponenter
- Strukturen stödjer framtida i18n (fi, no, da) men vi bygger **enbart sv** nu

## Principer

1. **Content first** — data framför dekoration
2. **Tillgängligt** — WCAG 2.1 AA, fungerar utan JS, screen reader-vänligt
3. **Snabbt** — <1s first paint
4. **Ärligt** — ingen spin, låt datan tala
5. **Curl-friendly** — allt i HTML/SVG
6. **Mobilt först** — responsive, touch-vänligt
7. **Mörkt/ljust tema** — `prefers-color-scheme`

## Typografi

| Element | Font | Storlek |
|---------|------|---------|
| Rubriker | Inter (variable) | 2rem / 1.5rem / 1.25rem |
| Brödtext | Inter | 1rem, line-height 1.6, max-width 70ch |
| Data/siffror | JetBrains Mono | 1.25rem |
| Labels | Inter | 0.75rem, sentence case |

## Färger

### Tema

| Syfte | Ljus | Mörkt |
|-------|------|-------|
| Bakgrund | #FFFFFF | #0F172A |
| Text | #1E293B | #F1F5F9 |
| Primary | #2563EB | #60A5FA |
| Secondary | #7C3AED | #A78BFA |
| Positiv | #16A34A | #4ADE80 |
| Negativ | #DC2626 | #F87171 |
| Neutral | #64748B | #94A3B8 |

### Partifärger

```
S   #ED1B34    M   #52BDEC    SD  #DDDD00    C   #009933
V   #DA291C    KD  #005DA6    MP  #83CF39    L   #006AB3
```

## Visualiseringar

Alla grafer renderas som **SVG** (ej Canvas) → fungerar utan JS, i curl, i print.

| Typ | Användning | Lib |
|-----|-----------|-----|
| KPI-kort | Nyckeltal (beslut, närvaro, kostnad) | Tailwind |
| Donut | Budgetfördelning, partifördelning | Observable Plot |
| Bar | Voteringar, budget per nämnd | Observable Plot |
| Line | Trender över tid | Observable Plot |
| Sankey | Penningflöden | D3-sankey |
| Heatmap | Aktivitet per politiker/månad | D3 |
| Hierarchy | Organisationsträd | D3-hierarchy |

### Regler 

- Y-axel börjar alltid vid 0
- Max 8 kategorier i donut (fler → «övrigt»)
- Max 5 linjer per line chart
- Tickformat: `.1s` för stora tal (42 000 → 42k)
- Labels: sentence case, max 200px, trunkera vid behov
- Färg aldrig ENBART informationsbärande (+ mönster/text)

## Komponenter

### Politiker-kort

```
┌──────────────────────────────────┐
│ [FOTO]  Anna Svensson (C)       │
│          Ledamot, KF             │
│          Nämnden för Intraservice│
│  Beslut: 45  Närvaro: 92%       │
│  [Visa profil →]                │
└──────────────────────────────────┘
```

### Beslut-kort

```
┌──────────────────────────────────────────┐
│ 🟢 Bifall                    2025-04-24  │
│ Motion om öppen källkod vid IT-upphandl. │
│ KF § 12                                 │
│ Ja: 45  Nej: 12  Avstår: 4             │
│ ██████████████████░░░░░ 74%             │
│ [Detaljer →]  [Debatt →]  [Votering →] │
└──────────────────────────────────────────┘
```

### Beslut-timeline

```
● Motion inlämnad (2025-01-15) — Anna Svensson (C)
│
● Remitterad till KS (2025-01-20)
│
● Yttrande från Intraservice (2025-03-01)
│
● KF debatt + beslut (2025-04-24) — BIFALL
```

## Responsive

| Breakpoint | Layout |
|-----------|--------|
| <640px | Single column, stacked |
| 640–1024px | 2-column |
| >1024px | 3-column dashboard |
