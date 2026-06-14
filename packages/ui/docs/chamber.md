# Chamber (Sal)

SVG seating chart for a municipal council. Reusable across all kommuner.

## When to use

- Hero on `/kommun/` overview page — show all seats colored by party
- Vote visualization on `/kommun/beslut/[id]` — show ja/nej/avstår per seat
- Compact view in sidebars or cards

## Variants

### 1. Overview (default)
Each seat colored by party. Hover shows politician card.

### 2. Vote
Same layout, but seat colors reflect vote position (green/red/gray). Icons overlaid.

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
