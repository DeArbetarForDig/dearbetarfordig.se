# Donut

Circular chart showing proportional data as segments of a ring.

## When to use

- Party balance (mandatfördelning)
- Budget breakdown per category
- Any parts-of-a-whole with 2–8 segments

## Variants

- **Default** — percentage on hover
- **With legend** — labels beside chart (`showLegend: true`)
- **Compact** — smaller, no legend (sidebar use)

## Data Structure

```typescript
interface DonutSegment {
  label: string
  value: number
  color: string
}

interface DonutConfig {
  segments: DonutSegment[]
  size?: number
  innerRadius?: number
  showLegend?: boolean
}
```

## Implementation

```typescript
import { generateDonutSVG } from '@daf/ui/charts/donut'
import { partyColors } from '@daf/ui/tokens'

const svg = generateDonutSVG({
  segments: [
    { label: 'S', value: 21, color: partyColors.S },
    { label: 'M', value: 16, color: partyColors.M },
    { label: 'SD', value: 14, color: partyColors.SD },
    // ...
  ],
  showLegend: true,
})
```

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `segments` | DonutSegment[] | required | Max 8 (rest → "Övrigt") |
| `size` | number | 200 | SVG size in px |
| `innerRadius` | number | 60 | Hole size |
| `showLegend` | boolean | true | Show labels beside chart |

## Rules

- Max 8 segments — combine smallest into "Övrigt"
- Always include hover `<title>` with label + value + percentage
- Use party colors from tokens for political data
