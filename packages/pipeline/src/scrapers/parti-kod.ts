/**
 * Delad partikod-mappning för Valmyndighetens rådata (kandidater.ts, mandat.ts).
 *
 * Valmyndighetens PARTIFÖRKORTNING matchar sajtens partikoder rakt av, utom
 * Demokraterna (Göteborgs lokala parti) som Valmyndigheten kodar "DEM".
 */

const PARTI_ALIAS: Record<string, string> = { DEM: 'D' }

// Fallback för partier utan officiell förkortning (småpartier/skämtlistor):
// initialer av flerordsnamn ("Svarta ballonger" → "SB"), annars tre bokstäver.
function kortaPartinamn(beteckning: string): string {
  const ord = beteckning
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-ZåäöÅÄÖ]/.test(w))
  if (ord.length > 1)
    return ord
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3)
  return beteckning.trim().slice(0, 3).toUpperCase()
}

export function partiKod(förkortning: string, beteckning: string): string {
  const kod = förkortning.trim()
  if (!kod) return kortaPartinamn(beteckning)
  return PARTI_ALIAS[kod] || kod
}
