/**
 * Kommuner som pipelinen känner till. Slug = API-schema och datafilssuffix
 * (data/politiker/{slug}.json, mandat-2026-{slug}.json, ...).
 *
 * kommunkod/länskod: Valmyndighetens koder (resultat.val.se, kandidaturer.csv).
 * troman: Troman-publik-registret över förtroendevalda (alla-fortroendevalda.ts).
 */

export interface Kommun {
  namn: string
  kommunkod: string
  länskod: string
  troman: string
}

export const KOMMUNER: Record<string, Kommun> = {
  goteborg: {
    namn: 'Göteborg',
    kommunkod: '1480',
    länskod: '14',
    troman: 'https://politiker.goteborg.se',
  },
  molndal: {
    namn: 'Mölndal',
    kommunkod: '1481',
    länskod: '14',
    troman: 'https://molndal.tromanpublik.se',
  },
}

/** Kommun-slug från argv[2] (default goteborg); kastar för okänd slug. */
export function kommunFrånArgv(): { slug: string } & Kommun {
  const slug = process.argv[2] || 'goteborg'
  const kommun = KOMMUNER[slug]
  if (!kommun)
    throw new Error(`Okänd kommun: ${slug} (känner till ${Object.keys(KOMMUNER).join(', ')})`)
  return { slug, ...kommun }
}
