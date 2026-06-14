/**
 * @daf/ui — Bar Chart
 *
 * Horizontal bar chart for vote breakdowns per party.
 */

export interface BarSegment {
  label: string
  values: { category: string; value: number; color: string }[]
}

export interface BarChartConfig {
  bars: BarSegment[]
  width?: number
  barHeight?: number
}

export function generateBarChartSVG(config: BarChartConfig): string {
  const { bars, width = 400, barHeight = 28 } = config
  const maxValue = Math.max(...bars.flatMap((b) => b.values.map((v) => v.value)))
  const height = bars.length * (barHeight + 8) + 20

  const barElements = bars
    .map((bar, i) => {
      const y = i * (barHeight + 8) + 10
      let x = 80
      const segments = bar.values.map((v) => {
        const w = (v.value / maxValue) * (width - 100)
        const rect = `<rect x="${x}" y="${y}" width="${w}" height="${barHeight}" fill="${v.color}" rx="2"><title>${v.category}: ${v.value}</title></rect>`
        x += w
        return rect
      })
      return `<text x="0" y="${y + barHeight / 2 + 4}" font-size="12" fill="currentColor">${bar.label}</text>\n    ${segments.join('\n    ')}`
    })
    .join('\n    ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Voteringsresultat per parti">
  ${barElements}
</svg>`
}
