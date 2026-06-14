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

---

## Foundations 

### Visuell hierarki — 3 lager

1. **System layer** — header: logotyp (vänster) + navigation (höger)
2. **Application layer** — sidtitel + kontextspecifika åtgärder
3. **Content layer** — tiles/kort med data

### Layout

- **12-kolumn grid** (via Tailwind)
- **Breakpoints:**

| Viewport | Bredd | Tailwind | Användning |
|----------|-------|----------|------------|
| Mobil | <640px | `sm:` | Enkel kolumn, vertikal scroll |
| Tablet | 640–1024px | `md:` | 2-kolumn |
| Desktop | 1024–1280px | `lg:` | 3-kolumn dashboard |
| Stor | >1280px | `xl:` | Fullskärm, NOC-liknande |

### Spacing — 8px-grid

| Token | Pixlar | CSS Variable | Användning |
|-------|--------|-------------|-----------|
| xs | 4px | `--space-xs` | Delar av samma element |
| sm | 8px | `--space-sm` | Relaterade element |
| md | 16px | `--space-md` | Padding i kort/tiles |
| lg | 24px | `--space-lg` | Sektionsbrytningar |
| xl | 32px | `--space-xl` | Större separeringar |
| 2xl | 48px | `--space-2xl` | Mellan huvudblock |

### Typografi

| Element | Storlek | Vikt | Font |
|---------|---------|------|------|
| H1 (sidtitel) | 2rem (32px) | 700 | Inter |
| H2 (sektion) | 1.5rem (24px) | 700 | Inter |
| H3 (kort-titel) | 1.25rem (20px) | 600 | Inter |
| Body | 1rem (16px) | 400 | Inter |
| Label/meta | 0.875rem (14px) | 400 | Inter |
| Small | 0.75rem (12px) | 400 | Inter |
| KPI-siffra | 2.5rem (40px) | 700 | JetBrains Mono |
| Data/nummer | 1.25rem (20px) | 500 | JetBrains Mono |

**Regler :**
- Sentence case, aldrig VERSALER i UI
- Radhöjd: 1.5× fontstorlek
- Max radlängd: 70 tecken (brödtext)
- Vänsterjusterad text
- Bold för betoning, inte färg
- Länktext = beskrivande ("Visa votering" inte "Klicka här")

---

## Typografi

| Element | Font | Storlek |
|---------|------|---------|
| Rubriker | Inter (variable) | 2rem / 1.5rem / 1.25rem |
| Brödtext | Inter | 1rem, line-height 1.6, max-width 70ch |
| Data/siffror | JetBrains Mono | 1.25rem |
| Labels | Inter | 0.75rem, sentence case |

## Färger 

### Tema — Ljus & Mörk

Aldrig ren vit (#FFF) eller ren svart (#000). Använd nyanser av grå.

| Syfte | Ljus tema | Mörk tema | CSS Variable |
|-------|-----------|-----------|-------------|
| Bakgrund | #F8FAFC (slate-50) | #0F172A (slate-900) | `--bg` |
| Yta (kort) | #FFFFFF | #1E293B (slate-800) | `--surface` |
| Text | #1E293B (slate-800) | #F1F5F9 (slate-100) | `--text` |
| Text muted | #64748B (slate-500) | #94A3B8 (slate-400) | `--text-muted` |
| Border | #E2E8F0 (slate-200) | #334155 (slate-700) | `--border` |
| Primary | #2563EB (blue-600) | #60A5FA (blue-400) | `--primary` |
| Accent | #7C3AED (violet-600) | #A78BFA (violet-400) | `--accent` |

### Status 

| Status | Färg | Användning |
|--------|------|-----------|
| Positiv/Bifall | #16A34A (green-600) | Ja-röster, godkända beslut |
| Negativ/Avslag | #DC2626 (red-600) | Nej-röster, avslagna motioner |
| Varning/Avstår | #EAB308 (yellow-500) | Avstår-röster |
| Info | #2563EB (blue-600) | Länkar, interaktivt |
| Neutral | #64748B (slate-500) | Frånvaro, inaktivt |

### Partifärger (politisk data)

Partifärger är **kategoriska** — de ska kunna särskiljas. Ordningen följer mandatstorlek.

```css
:root {
  --parti-s:   #ED1B34;   /* Socialdemokraterna */
  --parti-m:   #52BDEC;   /* Moderaterna */
  --parti-sd:  #DDDD00;   /* Sverigedemokraterna */
  --parti-c:   #009933;   /* Centerpartiet */
  --parti-v:   #DA291C;   /* Vänsterpartiet */
  --parti-kd:  #005DA6;   /* Kristdemokraterna */
  --parti-mp:  #83CF39;   /* Miljöpartiet */
  --parti-l:   #006AB3;   /* Liberalerna */
}
```

### Datavisualisering — regler 

- Färg ska **aldrig** vara enda informationsbäraren (+ mönster/text/ikon)
- Max 8 kategorier i ett diagram (fler → "Övrigt")
- Sekventiella paletter: ljust = lågt värde, mörkt = högt
- Divergerande: rött ↔ grönt med neutral mitt (gul/grå)
- Y-axel börjar alltid vid 0
- Tick-format: `.1s` för stora tal (42 000 → 42k)

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
