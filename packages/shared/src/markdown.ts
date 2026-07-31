/**
 * Minimal markdown → HTML för AI-analysernas brödtext (`analys_md`).
 *
 * Delmängden är den subagenten faktiskt skriver: rubriker, stycken, punktlistor,
 * fetstil, kod och nakna URL:er. Ingen markdown-dependency för sju rubriker och
 * några stycken — och ingen bild- eller HTML-syntax att sanera, eftersom all
 * text escapas FÖRE ersättningarna. Texten kommer visserligen ur vårt eget repo
 * och har passerat CI-validering, men den är skriven av en modell: att den inte
 * kan injicera markup ska följa av koden, inte av tillit.
 *
 * Behöver vi tabeller eller nästlade listor är det dags för en riktig parser.
 */

const escapa = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Inline efter escaping: fetstil, kod, länkar. Ordningen spelar roll. */
function inline(s: string): string {
  return escapa(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /(https?:\/\/[^\s<)]+[^\s<).,;:])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    )
}

export function renderaMarkdown(md: string): string {
  const ut: string[] = []
  let lista: string[] = []

  const stängLista = () => {
    if (!lista.length) return
    ut.push(`<ul>${lista.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`)
    lista = []
  }

  for (const stycke of md.trim().split(/\n{2,}/)) {
    const rader = stycke.split('\n')
    for (const rad of rader) {
      const t = rad.trim()
      if (!t) continue
      const rubrik = /^(#{2,4})\s+(.*)$/.exec(t)
      const punkt = /^[-*]\s+(.*)$/.exec(t)
      if (rubrik) {
        stängLista()
        // ## i källan är avsnittsrubrik under sidans h1/h2 — börja på h3.
        const nivå = Math.min(rubrik[1].length + 1, 6)
        ut.push(`<h${nivå}>${inline(rubrik[2])}</h${nivå}>`)
      } else if (punkt) {
        lista.push(punkt[1])
      } else {
        stängLista()
        ut.push(`<p>${inline(t)}</p>`)
      }
    }
    stängLista()
  }
  return ut.join('\n')
}

/**
 * Delar en källhänvisning i länkbara och icke-länkbara delar.
 *
 * Analysernas `källa`-fält är fritext med inbäddade id: "kf-2024-11-21-§462
 * (SLK-2024-00378)", "kf-2023-10-12-§17 och kf-2025-06-18-§382",
 * "utfall-nämnd-…-2022 t.o.m. -2025". Att länka hela strängen vore fel — bara
 * paragraf-id:n har en egen sida. Resten lämnas som text hellre än att peka på
 * en 404: en granskningsplattform vars källhänvisningar leder fel är värre än
 * en som inte länkar alls.
 */
export function delaKorsreferens(
  ref: string,
  kommun = 'goteborg',
): { text: string; href: string | null }[] {
  const delar: { text: string; href: string | null }[] = []
  const re = /k[fs]-\d{4}-\d{2}-\d{2}-§\d+/g
  let sist = 0
  for (const m of ref.matchAll(re)) {
    if (m.index > sist) delar.push({ text: ref.slice(sist, m.index), href: null })
    delar.push({ text: m[0], href: `/${kommun}/beslut/${encodeURIComponent(m[0])}` })
    sist = m.index + m[0].length
  }
  if (sist < ref.length) delar.push({ text: ref.slice(sist), href: null })
  return delar
}
