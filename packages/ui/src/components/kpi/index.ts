/**
 * @daf/ui — KPI (Key Performance Indicator)
 *
 * Displays a single metric with label and optional trend.
 */

export interface KPIConfig {
  value: number | string
  label: string
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
}

export function generateKPIHTML(config: KPIConfig): string {
  const { value, label, unit, trend, trendValue } = config
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''
  const trendColor =
    trend === 'up' ? 'var(--color-positive)' : trend === 'down' ? 'var(--color-negative)' : ''

  return `<div class="daf-kpi">
  <div class="daf-kpi__value">${value}${unit ? `<span class="daf-kpi__unit">${unit}</span>` : ''}</div>
  <div class="daf-kpi__label">${label}</div>
  ${trend ? `<div class="daf-kpi__trend" style="color:${trendColor}">${trendIcon} ${trendValue ?? ''}</div>` : ''}
</div>`
}
