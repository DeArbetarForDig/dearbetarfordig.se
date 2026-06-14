/**
 * @daf/ui — Chamber (Sal-komponent)
 *
 * Renders an SVG seating chart for a municipal council.
 * Two modes: overview (party colors) and vote (ja/nej/avstår icons).
 */

import type { PartyCode, VotePosition } from '../tokens'

export interface Seat {
  id: string
  row: number
  col: number
  politikerId: string
  namn: string
  parti: PartyCode
  foto?: string
  roll?: string
}

export interface VoteResult {
  politikerId: string
  röst: VotePosition
}

export interface ChamberConfig {
  seats: Seat[]
  rows: number
  cols: number
  mode: 'overview' | 'vote'
  votes?: VoteResult[]
  seatSize?: number
  gap?: number
}

export function generateChamberSVG(config: ChamberConfig): string {
  const { seats, rows, cols, mode, votes, seatSize = 32, gap = 6 } = config
  const width = cols * (seatSize + gap) + gap
  const height = rows * (seatSize + gap) + gap

  const voteMap = new Map(votes?.map((v) => [v.politikerId, v.röst]))

  const seatElements = seats
    .map((seat) => {
      const x = gap + seat.col * (seatSize + gap)
      const y = gap + seat.row * (seatSize + gap)
      const fill = getSeatFill(seat, mode, voteMap)
      const icon = mode === 'vote' ? getVoteIcon(voteMap.get(seat.politikerId)) : ''

      return `<g data-politician-id="${seat.politikerId}" data-party="${seat.parti}" class="seat">
      <title>${seat.namn} (${seat.parti})${mode === 'vote' ? ` — ${voteMap.get(seat.politikerId) ?? 'frånvarande'}` : ''}</title>
      <rect x="${x}" y="${y}" width="${seatSize}" height="${seatSize}" rx="4" fill="${fill}" />
      ${icon ? `<text x="${x + seatSize / 2}" y="${y + seatSize / 2 + 5}" text-anchor="middle" font-size="14">${icon}</text>` : ''}
    </g>`
    })
    .join('\n    ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Kommunfullmäktiges sal — ${seats.length} ledamöter">
  <style>.seat rect:hover { stroke: #2563EB; stroke-width: 2; cursor: pointer; }</style>
  ${seatElements}
</svg>`
}

function getSeatFill(
  seat: Seat,
  mode: ChamberConfig['mode'],
  voteMap: Map<string, VotePosition>,
): string {
  if (mode === 'overview') {
    const { partyColors } = require('../tokens')
    return partyColors[seat.parti] ?? partyColors['-']
  }
  const vote = voteMap.get(seat.politikerId)
  const { voteColors } = require('../tokens')
  return voteColors[vote ?? 'frånvarande']
}

function getVoteIcon(vote?: VotePosition): string {
  switch (vote) {
    case 'ja':
      return '👍'
    case 'nej':
      return '👎'
    case 'avstår':
      return '✋'
    default:
      return ''
  }
}

export { generateChamberSVG as default }
