/**
 * Generera organisationsstruktur.json från uppdrag[] i goteborg.json.
 * Skapar endast organisation-noder (inte politiker-noder eller sitter_i-kanter).
 * Tar bort 50-char-gränsen för ID:n som tidigare skarde ord i mitten.
 *
 * Kör: npx tsx packages/pipeline/src/parsers/generate-organisationsstruktur.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dirname, '../../../../data')
const CURRENT_DIR = join(DATA_DIR, 'graf')
const OUTPUT_DIR = join(DATA_DIR, 'graf')

/**
 * Slugify: konvertera organisation-namn till ID-säkert format.
 * Ingen längdbegränsning — tidigare fanns en 50-char-gräns som skär ord i mitten.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,:;()»«""''%]/g, '')
    .replace(/[^a-zäöåé0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface GoteborgOrganisation {
  organisation: string
  organisationId?: string
}

interface Politiker {
  uppdrag: GoteborgOrganisation[]
}

interface GoteborgData {
  politiker: Politiker[]
}

// Läs in befintlig organisationsstruktur för att jämföra och rapportera ändringar
const currentFile = JSON.parse(
  readFileSync(join(CURRENT_DIR, 'organisationsstruktur.json'), 'utf-8'),
)
const currentOrgsByLabel = new Map<string, string>()
for (const node of currentFile.nodes) {
  if (node.typ === 'organisation') {
    currentOrgsByLabel.set(node.label, node.id)
  }
}

// Läs in goteborg.json
const goteborgData: GoteborgData = JSON.parse(
  readFileSync(join(DATA_DIR, 'politiker/goteborg.json'), 'utf-8'),
)

// Samla alla unika organisationer från uppdrag[]
const orgsByLabel = new Map<string, boolean>()
for (const p of goteborgData.politiker) {
  for (const u of p.uppdrag || []) {
    if (u.organisation) {
      orgsByLabel.set(u.organisation, true)
    }
  }
}

// Generera nodes med nya slug-regler (utan 50-char-gräns)
const nodes: any[] = []
const changedIds: Array<{ label: string; oldId: string; newId: string }> = []

for (const label of Array.from(orgsByLabel.keys()).sort()) {
  const slug = slugify(label)
  const newId = `org-${slug}`

  nodes.push({
    id: newId,
    typ: 'organisation',
    label,
    data: {},
  })

  // Spara ändrade ID:n
  const oldId = currentOrgsByLabel.get(label)
  if (oldId && oldId !== newId) {
    changedIds.push({ label, oldId, newId })
  }
}

// Skriv ut resultat
const output = { nodes, edges: [] }
const outPath = join(OUTPUT_DIR, 'organisationsstruktur.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`✓ ${outPath}`)
console.log(`Genererade ${nodes.length} organisation-noder`)
console.log(`  Ändrade ID:n: ${changedIds.length}`)
if (changedIds.length > 0 && changedIds.length <= 10) {
  changedIds.forEach((c) => {
    console.log(`    ${c.oldId} → ${c.newId}`)
  })
  if (changedIds.length > 10) {
    console.log(`    ... och ${changedIds.length - 10} fler`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Script kördes direkt, inte importerat
}
