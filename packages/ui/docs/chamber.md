# Chamber (Sal)

SVG hemicycle seating chart for Göteborgs kommunfullmäktige.
Matches the real KF chamber layout: curved rows in a semicircle,
two sectors separated by a central aisle, presidium at center front.

Reference: Göteborgs KF votering 2019 (tmp/maxresdefault.jpg)

## When to use

- Hero on `/kommun/` overview page — show all 81 seats colored by party
- Vote visualization on `/kommun/beslut/[id]` — seats colored green/red/yellow
- Compact view in sidebars or cards

## Variants

### 1. Overview (default)
Each seat colored by party. Hover shows politician card. Seat numbers visible.

### 2. Vote
Same hemicycle layout, but seat colors reflect vote position:
- 🟢 Green = Ja
- 🔴 Red = Nej
- 🟡 Yellow = Avstår
- ⚫ Gray = Frånvarande

Includes result panel (top-right): "Votering avslutad — Ja: 60, Nej: 7..."

## Layout

```
        [1][2][3][4]          ← Presidium (ordförande + vice)
      ╭─────────────────╮
    ╭─── Row 1 (10 seats) ───╮
  ╭───── Row 2 (12 seats) ─────╮
╭─────── Row 3 (14 seats) ───────╮
╰─────── Row 4 (16 seats) ───────╯
  ╰───── Row 5 (18 seats) ─────╯
    ╰─── Row 6 (11 seats) ───╯
```

81 seats total. Central aisle splits left/right sectors.

## Data Structure

```typescript
interface Seat {
  id: string
  row: number
  col: number
  politikerId: string
  namn: string
  parti: PartyCode   // 'S' | 'M' | 'SD' | 'C' | 'V' | 'KD' | 'MP' | 'L'
  foto?: string
  roll?: string
}

interface ChamberConfig {
  seats: Seat[]
  rows: number
  cols: number
  mode: 'overview' | 'vote'
  votes?: VoteResult[]
}
```

## Implementation

```typescript
import { generateChamberSVG } from '@daf/ui/components/chamber'

const svg = generateChamberSVG({
  seats: politikerData,
  rows: 7,
  cols: 12,
  mode: 'overview',
})
```

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `seats` | Seat[] | required | All seats with position + politician |
| `rows` | number | required | Number of rows in layout |
| `cols` | number | required | Max seats per row |
| `mode` | 'overview' \| 'vote' | 'overview' | Color scheme mode |
| `votes` | VoteResult[] | — | Required when mode='vote' |
| `seatSize` | number | 32 | Seat square size in px |
| `gap` | number | 6 | Gap between seats |

## Accessibility

- `role="img"` on SVG root
- `aria-label` describes the full chart
- Each seat has `<title>` with name + party (+ vote in vote mode)
- Works without JS — static SVG with hover via CSS

## Responsiveness

- Desktop: full aula layout
- Tablet: scaled down via viewBox
- Mobile: compact grid (CSS container query)
