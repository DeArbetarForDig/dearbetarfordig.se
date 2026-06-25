/**
 * @daf/ui — Chamber (Sal-komponent)
 *
 * SVG hemicycle seating chart for kommunfullmäktige.
 * Seats ALWAYS show party color. Overlays (icons) show context:
 * - vote: ja/nej/avstår (how they voted)
 * - debate: (who spoke)
 * - motion: (who submitted)
 * - custom: any icon per seat
 */

import { partyColors, voteColors } from '../../tokens/index.ts'
import type { PartyCode, VotePosition } from '../../tokens/index.ts'

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
}

function voteToOverlays(votes: VoteResult[]): SeatOverlay[] {
  return votes.map((v) => ({
    politikerId: v.politikerId,
    icon: v.röst === 'ja' ? '✓' : v.röst === 'nej' ? '✗' : v.röst === 'avstår' ? '–' : '·',
  }))
}

function computeSeatPositions(totalSeats: number, size: number) {
  const cx = size / 2
  const cy = size * 0.85
  const positions: { nummer: number; x: number; y: number }[] = []

  const presidiumCount = 4
  for (let i = 0; i < presidiumCount; i++) {
    const angle = Math.PI * (0.35 + (i / (presidiumCount - 1)) * 0.3)
    const r = size * 0.12
    positions.push({
      nummer: i + 1,
      x: cx - r * Math.cos(angle),
      y: cy - r * Math.sin(angle),
    })
  }

  const rowCapacities = [10, 12, 14, 16, 18, 11]
  let seatNum = presidiumCount + 1
  let rowIndex = 0

  for (const capacity of rowCapacities) {
    if (seatNum > totalSeats) break
    const seatsInRow = Math.min(capacity, totalSeats - seatNum + 1)
    const radius = size * (0.22 + rowIndex * 0.11)

    for (let i = 0; i < seatsInRow; i++) {
      const t = seatsInRow === 1 ? 0.5 : i / (seatsInRow - 1)
      const angle = Math.PI * (0.15 + t * 0.7)
      positions.push({
        nummer: seatNum,
        x: cx - radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
      })
      seatNum++
    }
    rowIndex++
  }

  return positions
}

export function generateChamberSVG(config: ChamberConfig): string {
  const { seats, mode, votes, overlays: customOverlays, size = 500 } = config

  const overlayMap = new Map<string, string>()
  if (mode === 'vote' && votes) {
    for (const o of voteToOverlays(votes)) overlayMap.set(o.politikerId, o.icon)
  } else if (customOverlays) {
    for (const o of customOverlays) overlayMap.set(o.politikerId, o.icon)
  }

  const seatMap = new Map(seats.map((s) => [s.nummer, s]))
  const positions = computeSeatPositions(seats.length, size)
  const seatSize = size * 0.028

  const seatElements = positions
    .map(({ nummer, x, y }) => {
      const seat = seatMap.get(nummer)
      if (!seat) return ''

      const fill = partyColors[seat.parti] ?? partyColors['-']
      const icon = overlayMap.get(seat.politikerId) ?? ''
      const overlayLabel = icon ? ` — ${icon}` : ''

      return `<g class="seat" data-nummer="${nummer}" data-party="${seat.parti}">
      <title>${seat.namn} (${seat.parti})${overlayLabel}</title>
      <rect x="${x - seatSize}" y="${y - seatSize * 0.7}" width="${seatSize * 2}" height="${seatSize * 1.4}" rx="3" fill="${fill}" />
      <text x="${x}" y="${y + 3}" text-anchor="middle" font-size="${size * 0.018}" fill="white" font-weight="bold">${nummer}</text>
      ${icon ? `<text x="${x + seatSize * 0.7}" y="${y - seatSize * 0.3}" font-size="${size * 0.024}">${icon}</text>` : ''}
    </g>`
    })
    .join('\n    ')

  const resultatPanel = mode === 'vote' && votes ? generateResultPanel(votes, size) : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size * 0.9}" role="img" aria-label="Göteborgs kommunfullmäktige — ${seats.length} ledamöter">
  <style>
    .seat rect:hover { stroke: #fff; stroke-width: 2; cursor: pointer; }
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
