/**
 * Mock data for Göteborgs KF — 81 ledamöter.
 * Replace with real scraped data later.
 */

import type { PartyCode } from '@daf/ui/tokens'
import type { Seat } from '@daf/ui/components/chamber'

const partifördelning: [PartyCode, number][] = [
  ['S', 21],
  ['M', 16],
  ['SD', 14],
  ['V', 9],
  ['MP', 7],
  ['C', 5],
  ['L', 5],
  ['KD', 4],
]

const förnamn = [
  'Anna',
  'Erik',
  'Maria',
  'Lars',
  'Karin',
  'Johan',
  'Eva',
  'Anders',
  'Lisa',
  'Karl',
  'Sara',
  'Nils',
  'Emma',
  'Olof',
  'Helena',
  'Björn',
  'Ida',
  'Per',
  'Sofia',
  'Gustaf',
]

const efternamn = [
  'Svensson',
  'Johansson',
  'Andersson',
  'Karlsson',
  'Nilsson',
  'Eriksson',
  'Larsson',
  'Olsson',
  'Persson',
  'Lindberg',
  'Bergström',
  'Holm',
  'Gustafsson',
  'Pettersson',
  'Axelsson',
  'Lundgren',
]

export function getMockSeats(): Seat[] {
  const seats: Seat[] = []
  let nummer = 1

  for (const [parti, antal] of partifördelning) {
    for (let i = 0; i < antal; i++) {
      const fn = förnamn[nummer % förnamn.length]
      const en = efternamn[nummer % efternamn.length]
      seats.push({
        nummer,
        politikerId: `${fn.toLowerCase()}-${en.toLowerCase()}`,
        namn: `${fn} ${en}`,
        parti,
        roll: nummer <= 4 ? 'Presidium' : 'Ledamot',
      })
      nummer++
    }
  }

  return seats
}
