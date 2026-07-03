/**
 * @daf/ui — Chamber (Sal-komponent)
 *
 * Universal SVG hemicycle parliament chart.
 * Uses arc-proportion formula: seats_in_row = round(N × R_i / ΣR)
 *
 * Seats ALWAYS show party color. Overlays (icons) show context:
 * - vote: ja/nej/avstår
 * - debate: who spoke
 * - motion: who submitted
 * - custom: any icon per seat
 */

import { partyColors, voteColors } from '../../tokens/index'
import type { PartyCode, VotePosition } from '../../tokens/index'

export interface Seat {
  nummer: number
  politikerId: string
  namn: string
  parti: PartyCode
  foto?: string
  roll?: string
}

export interface SeatOverlay {
  politikerId: string
  icon: string
}

export interface VoteResult {
  politikerId: string
  röst: VotePosition
}

export interface ChamberConfig {
  seats: Seat[]
  mode: 'overview' | 'vote' | 'debate' | 'motion' | 'custom'
  votes?: VoteResult[]
  overlays?: SeatOverlay[]
  size?: number
  rows?: number
  seatRadius?: number
}

function computeSeatPositions(
  totalSeats: number,
  size: number,
  numRows?: number,
  seatRadius?: number,
) {
  const r = seatRadius ?? size * 0.028
  const gap = r * 2.5
  const rows = numRows ?? Math.max(3, Math.min(7, Math.round(Math.sqrt(totalSeats / 4))))
  const innerR = rows * gap + r * 2
  const cx = size / 2
  const cy = size * 0.85

  const radii = Array.from({ length: rows }, (_, i) => innerR + i * gap)
  const sumR = radii.reduce((s, v) => s + v, 0)

  const rawSeats = radii.map((R) => (totalSeats * R) / sumR)
  const rowSeats = rawSeats.map((v) => Math.round(v))
  let diff = totalSeats - rowSeats.reduce((s, v) => s + v, 0)
  while (diff !== 0) {
    rowSeats[diff > 0 ? rowSeats.length - 1 : 0] += Math.sign(diff)
    diff = totalSeats - rowSeats.reduce((s, v) => s + v, 0)
  }

  const positions: { nummer: number; x: number; y: number }[] = []
  let seatNum = 1

  for (let row = 0; row < rows; row++) {
    const R = radii[row]
    const count = rowSeats[row]
    for (let i = 0; i < count; i++) {
      const angle = Math.PI - (count === 1 ? Math.PI / 2 : (i / (count - 1)) * Math.PI)
      positions.push({
        nummer: seatNum++,
        x: cx + R * Math.cos(angle),
        y: cy - R * Math.sin(angle),
      })
    }
  }

  return positions
}

function voteToOverlays(votes: VoteResult[]): SeatOverlay[] {
  return votes.map((v) => ({
    politikerId: v.politikerId,
    icon: v.röst === 'ja' ? '✓' : v.röst === 'nej' ? '✗' : v.röst === 'avstår' ? '–' : '·',
  }))
}

export function generateChamberSVG(config: ChamberConfig): string {
  const { seats, mode, votes, overlays: customOverlays, size = 500, rows, seatRadius } = config
  const r = seatRadius ?? size * 0.028

  const overlayMap = new Map<string, string>()
  if (mode === 'vote' && votes) {
    for (const o of voteToOverlays(votes)) overlayMap.set(o.politikerId, o.icon)
  } else if (customOverlays) {
    for (const o of customOverlays) overlayMap.set(o.politikerId, o.icon)
  }

  const seatMap = new Map(seats.map((s) => [s.nummer, s]))
  const positions = computeSeatPositions(seats.length, size, rows, seatRadius)

  const seatElements = positions
    .map(({ nummer, x, y }) => {
      const seat = seatMap.get(nummer)
      if (!seat) return ''

      const fill = partyColors[seat.parti] ?? partyColors['-']
      const icon = overlayMap.get(seat.politikerId) ?? ''
      const overlayLabel = icon ? ` — ${icon}` : ''

      return `<g class="seat" data-nummer="${nummer}" data-party="${seat.parti}">
      <title>${seat.namn} (${seat.parti})${overlayLabel}</title>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="rgba(0,0,0,0.15)" stroke-width="0.5" />
      ${icon ? `<text x="${(x + r * 0.8).toFixed(1)}" y="${(y - r * 0.5).toFixed(1)}" font-size="${r}">${icon}</text>` : ''}
    </g>`
    })
    .join('\n    ')

  const resultatPanel = mode === 'vote' && votes ? generateResultPanel(votes, size) : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size * 0.9}" role="img" aria-label="Kommunfullmäktige — ${seats.length} ledamöter">
  <style>
    .seat circle:hover { stroke: #fff; stroke-width: 2; cursor: pointer; }
    .seat { transition: opacity 0.15s; }
  </style>
  ${seatElements}
  ${resultatPanel}
</svg>`
}

function generateResultPanel(votes: VoteResult[], size: number): string {
  const ja = votes.filter((v) => v.röst === 'ja').length
  const nej = votes.filter((v) => v.röst === 'nej').length
  const avstår = votes.filter((v) => v.röst === 'avstår').length
  const frånv = votes.filter((v) => v.röst === 'frånvarande').length

  const px = size * 0.72
  const py = size * 0.05

  return `<g class="resultat-panel">
    <rect x="${px}" y="${py}" width="${size * 0.26}" height="${size * 0.2}" rx="4" fill="#1a1a2e" opacity="0.9" />
    <text x="${px + 8}" y="${py + 20}" font-size="11" fill="#aaa">Votering avslutad</text>
    <text x="${px + 8}" y="${py + 38}" font-size="13" fill="${voteColors.ja}" font-weight="bold">Ja: ${ja}</text>
    <text x="${px + 8}" y="${py + 56}" font-size="13" fill="${voteColors.nej}" font-weight="bold">Nej: ${nej}</text>
    <text x="${px + 8}" y="${py + 74}" font-size="13" fill="${voteColors.avstår}" font-weight="bold">Avstår: ${avstår}</text>
    <text x="${px + 8}" y="${py + 92}" font-size="13" fill="#666">Frånv: ${frånv}</text>
  </g>`
}

export { generateChamberSVG as default }
