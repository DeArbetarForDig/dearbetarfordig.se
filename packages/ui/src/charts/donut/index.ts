/**
 * @daf/ui — Donut Chart
 *
 * SVG donut for party balance, budget breakdown, etc.
 * Max 8 segments (more → "Övrigt").
 */

export interface DonutSegment {
  label: string
  value: number
  color: string
}

export interface DonutConfig {
  segments: DonutSegment[]
  size?: number
  innerRadius?: number
  showLegend?: boolean
}

export function generateDonutSVG(config: DonutConfig): string {
  const { segments, size = 200, innerRadius = 60, showLegend = true } = config
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 10

  let startAngle = -Math.PI / 2
  const paths = segments.map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const largeArc = angle > Math.PI ? 1 : 0

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const ix1 = cx + innerRadius * Math.cos(endAngle)
    const iy1 = cy + innerRadius * Math.sin(endAngle)
    const ix2 = cx + innerRadius * Math.cos(startAngle)
    const iy2 = cy + innerRadius * Math.sin(startAngle)

    const path = `<path d="M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${ix2},${iy2} Z" fill="${seg.color}"><title>${seg.label}: ${seg.value} (${Math.round((seg.value / total) * 100)}%)</title></path>`
    startAngle = endAngle
    return path
  })

  const legend = showLegend
    ? segments
        .map(
          (seg, i) =>
            `<text x="${size + 10}" y="${20 + i * 18}" font-size="12" fill="currentColor"><tspan fill="${seg.color}">●</tspan> ${seg.label} (${seg.value})</text>`,
        )
        .join('\n  ')
    : ''

  const svgWidth = showLegend ? size + 150 : size

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${size}" role="img" aria-label="Mandatfördelning">
  ${paths.join('\n  ')}
  ${legend}
</svg>`
}
