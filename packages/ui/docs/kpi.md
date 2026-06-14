# KPI

Displays a single metric with label, optional unit, and trend indicator.

## When to use

- Dashboard overview — key numbers (ledamöter, beslut, närvaro, budget)
- Politician profile — attendance, votes, motions
- Quick stats in any context

## Variants

### 1. Simple (value + label)
### 2. With unit (value + unit + label)
### 3. With trend (value + arrow + change)

## Data Structure

```typescript
interface KPIConfig {
  value: number | string
  label: string
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
}
```

## Implementation

```typescript
import { generateKPIHTML } from '@daf/ui/components/kpi'

const html = generateKPIHTML({
  value: 92,
  label: 'Närvaro',
  unit: '%',
  trend: 'up',
  trendValue: '+3% sedan förra året',
})
```

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `value` | number \| string | required | The metric value |
| `label` | string | required | Description of the metric |
| `unit` | string | — | Unit suffix (%, kr, st) |
| `trend` | 'up' \| 'down' \| 'neutral' | — | Trend direction |
| `trendValue` | string | — | Trend description text |

## CSS Classes

- `.daf-kpi` — container
- `.daf-kpi__value` — large number (font-size: 2.5rem)
- `.daf-kpi__unit` — unit suffix (smaller, muted)
- `.daf-kpi__label` — description (muted)
- `.daf-kpi__trend` — green/red trend indicator
