# @daf/ui — Component Library

Design system for dearbetarfordig.se. All components are Astro (SSG, zero JS unless noted).

## Core

### Button
```astro
<Button variant="primary" href="/link">Click</Button>
<Button variant="ghost" size="sm" disabled>Disabled</Button>
```
Props: `variant` (primary/secondary/ghost/danger), `size` (sm/md/lg), `href`, `disabled`

### Card
```astro
<Card title="Titel" subtitle="Beskrivning" tooltip="Förklaring" titleSize="lg">
  <p>Content</p>
</Card>
```
Props: `title`, `subtitle`, `tooltip` (dotted underline + hover), `tooltipPosition` (top/top-end/bottom/bottom-end/left/right), `titleSize` (sm/base/lg)

### Icon
```astro
<Icon name="triangle-alert" size={14} />
```
Props: `name` (Lucide icon kebab-case), `size` (px, default 20). Renders inline SVG from lucide-static.

### PartyTag
```astro
<PartyTag parti="S" />
<PartyTag parti="MP" full size="sm" />
```
Props: `parti` (S/M/SD/V/MP/C/L/KD/D), `full` (show name), `size` (sm/md)

### Callout
```astro
<Callout severity="warning" label="Se upp med">
  Beslutet innehåller inget belopp.
</Callout>
<Callout severity="success" label="Ja">Är pengarna utpekade?</Callout>
```
Props: `severity` (critical/warning/success/info/neutral), `label`, `icon` (Lucide-namn, ersätter standardikonen)

Färgad minikortsnotis för ett enskilt påstående som ska sticka ut i löpande text — till skillnad från `Pill` (kapsel för en kort etikett) och `StatusBadge` (status på ett objekt) bär den hela meningen. Varje allvarlighetsgrad har egen ikon, så färgen är aldrig enda signalen.

### StatusBadge
```astro
<StatusBadge status="bifall" />
<StatusBadge status="avslag" solid />
```
Props: `status` (bifall/avslag/remitterad/bordlagd/ja/nej/avstar/franvarande/info), `label`, `solid`

### Table
```astro
<Table
  headers={['Datum', 'Ärende', 'Röst']}
  rows={[
    ['2026-05-28', { text: 'Cykelväg', href: '/beslut/45' }, { text: 'Ja', color: 'var(--vote-ja)' }],
  ]}
  variant="compact"
  alignRight={[2]}
/>
```
Props: `headers`, `rows`, `variant` (default/compact/striped), `alignRight` (column indices)

Cell types:
- `string | number` — plain text
- `{ text, color }` — colored dot + text
- `{ text, href }` — link
- `{ text, color, href }` — colored dot + link

### Tooltip
```astro
<Tooltip text="Förklaring" position="top-end">
  <span>Hover me</span>
</Tooltip>
```
Props: `text`, `position` (top/top-end/bottom/bottom-end/left/right), `variant` (dark/light), `fixed`

### ChartTooltip
Mouse-following tooltip for data visualizations. Include once in layout:
```astro
<ChartTooltip />
```
JS API:
```js
dafChartTooltip.show(event, { title: 'S', items: [{ label: 'Andel', value: '26%', color: 'var(--parti-s)' }] })
dafChartTooltip.hide()
```

## Cards

### DecisionCard
```astro
<DecisionCard titel="Ny cykelväg" datum="2025-06-12" status="bifall" ja={52} nej={21} avstar={8} url="/beslut/45" />
```

### KpiCard
```astro
<KpiCard value="81" label="Ledamöter" />
<KpiCard value={61} max={234} unit="GB" label="Disk" />
<KpiCard value="Active" label="API" state="online" />
```
Types: basic, with unit, with limit (progress bar), trend, state (colored dot), take action (href), breakdown.

### PoliticianCard
```astro
<PoliticianCard namn="Anna Svensson" parti="C" roll="Ledamot" narvaro={92} url="/politiker/id" />
```

### Timeline
```astro
<Timeline events={[
  { datum: '2025-01-15', titel: 'Motion inlämnad', status: 'completed' },
  { datum: '2025-06-12', titel: 'KF beslut', status: 'active' },
  { datum: '2025-09-01', titel: 'Verkställande', status: 'pending' },
]} />
```
Status: `completed` (filled dot), `active` (blue + glow), `pending` (dashed line, hollow dot)

## Charts

### Chamber
```astro
<Chamber seats={seats} mode="overview" />
<Chamber seats={seats} mode="vote" votes={votes} />
```
81-seat SVG hemicycle. Modes: `overview` (party colors), `vote` (ja/nej/avstår).

### Donut
```astro
<Donut segments={[{ label: 'S', value: 21, color: 'var(--parti-s)' }]} showValue unit="mandat" />
```
Props: `segments`, `size`, `thickness`, `showValue`, `showAbsoluteValue`, `unit`, `legend`

Hover: dims other segments, center shows value + label.

### HorizontalBar
```astro
<HorizontalBar
  bars={[{ label: 'Vänsterpartiet', subtitle: '20', value: 1.0, color: 'var(--parti-v)' }]}
  max={1}
  labelWidth="10rem"
/>
```
Props: `bars`, `min`, `max`, `barHeight`, `labelWidth`, `unit`, `thresholds`

### StackedBar
```astro
<StackedBar segments={[
  { label: 'Ja', value: 137, color: 'var(--vote-ja)' },
  { label: 'Nej', value: 3, color: 'var(--vote-nej)' },
  { label: 'Frånvarande', value: 5, color: 'var(--color-neutral)' },
]} />
```
Legend + proportional rounded bar. Hover dims other segments.

## CSS Tokens

Located in `packages/ui/src/tokens/css/`:

| File | Purpose |
|------|---------|
| `global.css` | Spacing, fonts, party colors, vote colors, radii, shadows |
| `light.css` | Light theme surfaces, text, borders |
| `dark.css` | Dark theme (auto via prefers-color-scheme) |
| `svg.css` | SVG-specific classes (.seat, .vote, .shadow) |
| `chart-tooltip.css` | Chart tooltip fixed-position styles |

## Pages

| Route | Content |
|-------|---------|
| `/goteborg` | Dashboard: Chamber, KPIs, Donut, Struktur, Democracy Scorecard, Beslut |
| `/goteborg/politiker` | Filterable list (125 politicians, party chips, search) |
| `/goteborg/politiker/{id}` | Profile: votes, speeches, arvode, uppdrag, mandatperioder |
| `/goteborg/beslut` | Decision list with status cards |
| `/goteborg/beslut/{id}` | Detail: Chamber vote mode, timeline, kopplingar |
