/**
 * Anförandetext → databasen.
 *
 * Yttrandeprotokollens ordagranna text (data/debatter/kf-*.json, ~13 MB över
 * 42 möten) har hittills bara lästs från fil av /beslut/{id}/anforanden. Den
 * fanns därför inte i fritextsökningen: att söka på vad politiker faktiskt
 * *sagt* — plattformens hela poäng — gav bara träffar på ärenderubriker.
 *
 * Texten läggs i en egen tabell i stället för i graf_nodes.data, av två skäl:
 * grafendpointsen returnerar hela data-objektet (13 MB text hade följt med i
 * /graf-svaren), och en separat tabell kan ha sin egen tsvector-kolumn utan
 * att röra nodernas.
 *
 * Nod-id:t måste stämma med parse-anforanden-graf.ts: `anforande-{datum}-{ordning-1}`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type postgres from 'postgres'

type Klient = ReturnType<typeof postgres>

interface Anförande {
  talare?: string
  parti?: string
  ärende?: string
  ärendeTitel?: string
  text?: string
  ordning?: number
}

export async function seedAnförandeText(client: Klient, dataDir: string): Promise<void> {
  await client`
    CREATE TABLE IF NOT EXISTS goteborg.anforande_text (
      id TEXT PRIMARY KEY REFERENCES goteborg.graf_nodes(id) ON DELETE CASCADE,
      datum TEXT NOT NULL,
      talare TEXT,
      parti TEXT,
      arende TEXT,
      text TEXT NOT NULL,
      fts tsvector GENERATED ALWAYS AS (to_tsvector('swedish', text)) STORED
    )`
  await client`CREATE INDEX IF NOT EXISTS idx_anforande_text_fts ON goteborg.anforande_text USING GIN (fts)`
  await client`CREATE INDEX IF NOT EXISTS idx_anforande_text_datum ON goteborg.anforande_text(datum)`
  await client`DELETE FROM goteborg.anforande_text`

  const dir = join(dataDir, 'debatter')
  if (!existsSync(dir)) {
    console.log('   ◦ data/debatter saknas — ingen anförandetext seedad')
    return
  }

  // Bara noder som finns i grafen får text (FK). Anföranden utan politikerId
  // blir aldrig noder, se parse-anforanden-graf.ts.
  const noder = await client<{ id: string }[]>`
    SELECT id FROM goteborg.graf_nodes WHERE typ = 'anförande'`
  const kända = new Set(noder.map((n) => n.id))

  const rader: {
    id: string
    datum: string
    talare: string
    parti: string
    arende: string
    text: string
  }[] = []
  let utanNod = 0
  for (const fil of readdirSync(dir).filter((f) => /^kf-\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    const data = JSON.parse(readFileSync(join(dir, fil), 'utf-8'))
    const datum: string = data.datum || fil.slice(3, 13)
    for (const [i, anf] of (data.anföranden as Anförande[]).entries()) {
      const text = (anf.text || '').trim()
      if (!text) continue
      const id = `anforande-${datum}-${(anf.ordning ?? i + 1) - 1}`
      if (!kända.has(id)) {
        utanNod++
        continue
      }
      rader.push({
        id,
        datum,
        talare: anf.talare || '',
        parti: anf.parti || '',
        arende: anf.ärendeTitel || '',
        text,
      })
    }
  }

  // Batchade inserts: 18 000 enskilda round-trips tog längre tid än hela
  // resten av seeden tillsammans.
  const BATCH = 500
  for (let i = 0; i < rader.length; i += BATCH) {
    const batch = rader.slice(i, i + BATCH)
    await client`INSERT INTO goteborg.anforande_text ${client(batch, 'id', 'datum', 'talare', 'parti', 'arende', 'text')}
      ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, talare = EXCLUDED.talare,
        parti = EXCLUDED.parti, arende = EXCLUDED.arende, datum = EXCLUDED.datum`
  }
  const tecken = rader.reduce((s, r) => s + r.text.length, 0)
  console.log(
    `   ✓ ${rader.length} anförandetexter (${(tecken / 1e6).toFixed(1)} MB) sökbara${
      utanNod > 0 ? ` — ${utanNod} utan graf-nod (saknar politikerId)` : ''
    }`,
  )
}

// Körbar separat: `tsx src/db/seed-anforande-text.ts` (t.ex. för att fylla en
// redan seedad utvecklingsdatabas utan att köra hela seeden om).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() || '')) {
  const { default: postgresFn } = await import('postgres')
  const client = postgresFn(
    process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf',
    { max: 5 },
  )
  await seedAnförandeText(client, join(import.meta.dirname, '../../../../data'))
  await client.end()
}
