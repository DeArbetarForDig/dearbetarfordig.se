/**
 * Generate utfall graph files for 2022-2024 from parsed driftredovisning data.
 * Run: npx tsx packages/pipeline/src/parsers/generate-utfall-historik.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/graf')

const DIREKTÖR_MAP: Record<string, string | null> = {
  'Exploateringsnämnden': 'direktör-kristina-lindfors',
  'Förskolenämnden': 'direktör-johan-olofsson',
  'Grundskolenämnden': 'direktör-maria-andersson',
  'Idrotts- och föreningsnämnden': 'direktör-johan-sävhage',
  'Inköps- och upphandlingsnämnden': 'direktör-henrik-karlsson',
  'Kulturnämnden': 'direktör-anna-rosengren',
  'Miljö- och klimatnämnden': 'direktör-maria-jacobsson',
  'Nämnden för arbetsmarknad och vuxenutbildning': 'direktör-lars-durfeldt',
  'Nämnden för demokrati och medborgarservice': 'direktör-eva-englund',
  'Nämnden för funktionsstöd': 'direktör-neri-samuelsson',
  'Nämnden för Intraservice': 'direktör-peter-söderström',
  'Socialnämnden Centrum': 'direktör-sandra-säljö',
  'Socialnämnden Hisingen': 'direktör-marie-larsson',
  'Socialnämnden Nordost': 'direktör-fredrik-johansson',
  'Socialnämnden Sydväst': 'direktör-annika-ljungh',
  'Stadsbyggnadsnämnden': 'direktör-henrik-kant',
  'Stadsfastighetsnämnden': 'direktör-martin-blixt',
  'Stadsmiljönämnden': 'direktör-anders-ramsby',
  'Utbildningsnämnden': 'direktör-tomas-berndtsson',
  'Äldre samt vård- och omsorgsnämnden': 'direktör-babbs-edberg',
  'Arkivnämnden': 'direktör-birgitta-torgén',
  'Kretslopp och vattennämnden': 'direktör-emma-hansryd',
  'Kommunledningen': null,
}

const NÄMND_ID_MAP: Record<string, string> = {
  'Exploateringsnämnden': 'nämnd-exploateringsnämnden',
  'Förskolenämnden': 'nämnd-förskolenämnden',
  'Grundskolenämnden': 'nämnd-grundskolenämnden',
  'Idrotts- och föreningsnämnden': 'nämnd-idrotts-och-föreningsnämnden',
  'Inköps- och upphandlingsnämnden': 'nämnd-inköps-och-upphandlingsnämnden',
  'Kulturnämnden': 'nämnd-kulturnämnden',
  'Miljö- och klimatnämnden': 'nämnd-miljö-och-klimatnämnden',
  'Nämnden för arbetsmarknad och vuxenutbildning': 'nämnd-nämnden-för-arbetsmarknad-och-vuxenutbildning',
  'Nämnden för demokrati och medborgarservice': 'nämnd-nämnden-för-demokrati-och-medborgarservice',
  'Nämnden för funktionsstöd': 'nämnd-nämnden-för-funktionsstöd',
  'Nämnden för Intraservice': 'nämnd-nämnden-för-intraservice',
  'Socialnämnden Centrum': 'nämnd-socialnämnden-centrum',
  'Socialnämnden Hisingen': 'nämnd-socialnämnden-hisingen',
  'Socialnämnden Nordost': 'nämnd-socialnämnden-nordost',
  'Socialnämnden Sydväst': 'nämnd-socialnämnden-sydväst',
  'Stadsbyggnadsnämnden': 'nämnd-stadsbyggnadsnämnden',
  'Stadsfastighetsnämnden': 'nämnd-stadsfastighetsnämnden',
  'Stadsmiljönämnden': 'nämnd-stadsmiljönämnden',
  'Utbildningsnämnden': 'nämnd-utbildningsnämnden',
  'Äldre samt vård- och omsorgsnämnden': 'nämnd-äldre-samt-vård-och-omsorgsnämnden',
  'Arkivnämnden': 'nämnd-arkivnämnden',
  'Kretslopp och vattennämnden': 'nämnd-kretslopp-och-vatten-västsvenska-paketet',
  'Kommunledningen': 'nämnd-kommunledningen',
}

// Data from parsed årsredovisningar (intäkter, kostnader, kommunbidrag, resultat, budget)
const DATA: Record<string, Array<{ nämnd: string; intäkter: number; kostnader: number; kommunbidrag: number; resultat: number; budget: number }>> = {
  '2022': [
    { nämnd: 'Förskolenämnden', intäkter: 565, kostnader: -5107, kommunbidrag: 4481, resultat: -61, budget: -152 },
    { nämnd: 'Grundskolenämnden', intäkter: 1182, kostnader: -10086, kommunbidrag: 9017, resultat: 114, budget: 0 },
    { nämnd: 'Idrotts- och föreningsnämnden', intäkter: 167, kostnader: -732, kommunbidrag: 571, resultat: 6, budget: 0 },
    { nämnd: 'Kulturnämnden', intäkter: 154, kostnader: -778, kommunbidrag: 638, resultat: 14, budget: 0 },
    { nämnd: 'Miljö- och klimatnämnden', intäkter: 93, kostnader: -189, kommunbidrag: 105, resultat: 9, budget: 0 },
    { nämnd: 'Nämnden för funktionsstöd', intäkter: 597, kostnader: -5366, kommunbidrag: 4772, resultat: 3, budget: 0 },
    { nämnd: 'Nämnden för Intraservice', intäkter: 1268, kostnader: -1290, kommunbidrag: 22, resultat: 0, budget: 0 },
    { nämnd: 'Socialnämnden Centrum', intäkter: 166, kostnader: -1362, kommunbidrag: 1227, resultat: 31, budget: 0 },
    { nämnd: 'Socialnämnden Hisingen', intäkter: 135, kostnader: -1224, kommunbidrag: 1171, resultat: 82, budget: 0 },
    { nämnd: 'Socialnämnden Nordost', intäkter: 197, kostnader: -1708, kommunbidrag: 1655, resultat: 144, budget: 0 },
    { nämnd: 'Socialnämnden Sydväst', intäkter: 485, kostnader: -1198, kommunbidrag: 749, resultat: 36, budget: 0 },
    { nämnd: 'Utbildningsnämnden', intäkter: 1053, kostnader: -3308, kommunbidrag: 2255, resultat: 1, budget: -6 },
    { nämnd: 'Kommunledningen', intäkter: 174, kostnader: -543, kommunbidrag: 383, resultat: 14, budget: 0 },
  ],
  '2023': [
    { nämnd: 'Exploateringsnämnden', intäkter: 1120, kostnader: -1331, kommunbidrag: 127, resultat: -85, budget: 0 },
    { nämnd: 'Förskolenämnden', intäkter: 587, kostnader: -5412, kommunbidrag: 4777, resultat: -48, budget: 0 },
    { nämnd: 'Grundskolenämnden', intäkter: 1155, kostnader: -10571, kommunbidrag: 9412, resultat: -4, budget: 0 },
    { nämnd: 'Idrotts- och föreningsnämnden', intäkter: 169, kostnader: -813, kommunbidrag: 666, resultat: 22, budget: 0 },
    { nämnd: 'Kulturnämnden', intäkter: 151, kostnader: -830, kommunbidrag: 683, resultat: 4, budget: 0 },
    { nämnd: 'Miljö- och klimatnämnden', intäkter: 92, kostnader: -201, kommunbidrag: 112, resultat: 3, budget: 0 },
    { nämnd: 'Nämnden för arbetsmarknad och vuxenutbildning', intäkter: 291, kostnader: -1037, kommunbidrag: 816, resultat: 29, budget: 0 },
    { nämnd: 'Nämnden för funktionsstöd', intäkter: 538, kostnader: -5786, kommunbidrag: 5100, resultat: -148, budget: 0 },
    { nämnd: 'Nämnden för Intraservice', intäkter: 1287, kostnader: -1320, kommunbidrag: 37, resultat: 4, budget: 0 },
    { nämnd: 'Socialnämnden Centrum', intäkter: 168, kostnader: -1421, kommunbidrag: 1277, resultat: 24, budget: 0 },
    { nämnd: 'Socialnämnden Hisingen', intäkter: 122, kostnader: -1327, kommunbidrag: 1222, resultat: 16, budget: 0 },
    { nämnd: 'Socialnämnden Nordost', intäkter: 220, kostnader: -1897, kommunbidrag: 1721, resultat: 44, budget: 0 },
    { nämnd: 'Socialnämnden Sydväst', intäkter: 563, kostnader: -1351, kommunbidrag: 787, resultat: 0, budget: 0 },
    { nämnd: 'Stadsbyggnadsnämnden', intäkter: 218, kostnader: -472, kommunbidrag: 256, resultat: 2, budget: 0 },
    { nämnd: 'Stadsfastighetsnämnden', intäkter: 3880, kostnader: -3850, kommunbidrag: 0, resultat: 30, budget: 0 },
    { nämnd: 'Stadsmiljönämnden', intäkter: 1661, kostnader: -3538, kommunbidrag: 1763, resultat: -114, budget: 0 },
    { nämnd: 'Utbildningsnämnden', intäkter: 1066, kostnader: -3527, kommunbidrag: 2471, resultat: 10, budget: 0 },
    { nämnd: 'Kommunledningen', intäkter: 202, kostnader: -574, kommunbidrag: 386, resultat: 14, budget: 0 },
  ],
  '2024': [
    { nämnd: 'Exploateringsnämnden', intäkter: 1041, kostnader: -1101, kommunbidrag: 134, resultat: 74, budget: 0 },
    { nämnd: 'Förskolenämnden', intäkter: 580, kostnader: -5466, kommunbidrag: 5059, resultat: 173, budget: 0 },
    { nämnd: 'Grundskolenämnden', intäkter: 1256, kostnader: -11146, kommunbidrag: 10047, resultat: 156, budget: 0 },
    { nämnd: 'Idrotts- och föreningsnämnden', intäkter: 331, kostnader: -919, kommunbidrag: 584, resultat: -3, budget: 0 },
    { nämnd: 'Inköps- och upphandlingsnämnden', intäkter: 130, kostnader: -134, kommunbidrag: 6, resultat: 2, budget: 0 },
    { nämnd: 'Kulturnämnden', intäkter: 150, kostnader: -875, kommunbidrag: 731, resultat: 7, budget: 0 },
    { nämnd: 'Miljö- och klimatnämnden', intäkter: 91, kostnader: -214, kommunbidrag: 129, resultat: 6, budget: 0 },
    { nämnd: 'Nämnden för arbetsmarknad och vuxenutbildning', intäkter: 333, kostnader: -1120, kommunbidrag: 816, resultat: 29, budget: 0 },
    { nämnd: 'Nämnden för demokrati och medborgarservice', intäkter: 116, kostnader: -233, kommunbidrag: 126, resultat: 8, budget: 0 },
    { nämnd: 'Nämnden för funktionsstöd', intäkter: 546, kostnader: -6001, kommunbidrag: 5565, resultat: 110, budget: 0 },
    { nämnd: 'Nämnden för Intraservice', intäkter: 1342, kostnader: -1374, kommunbidrag: 36, resultat: 4, budget: 0 },
    { nämnd: 'Socialnämnden Centrum', intäkter: 163, kostnader: -1478, kommunbidrag: 1350, resultat: 35, budget: 0 },
    { nämnd: 'Socialnämnden Hisingen', intäkter: 111, kostnader: -1394, kommunbidrag: 1289, resultat: 5, budget: 0 },
    { nämnd: 'Socialnämnden Nordost', intäkter: 245, kostnader: -2065, kommunbidrag: 1805, resultat: -16, budget: 0 },
    { nämnd: 'Socialnämnden Sydväst', intäkter: 580, kostnader: -1399, kommunbidrag: 841, resultat: 22, budget: 0 },
    { nämnd: 'Stadsbyggnadsnämnden', intäkter: 232, kostnader: -490, kommunbidrag: 266, resultat: 8, budget: 0 },
    { nämnd: 'Stadsfastighetsnämnden', intäkter: 4304, kostnader: -4323, kommunbidrag: 0, resultat: -20, budget: 0 },
    { nämnd: 'Stadsmiljönämnden', intäkter: 2440, kostnader: -3811, kommunbidrag: 1489, resultat: 117, budget: 0 },
    { nämnd: 'Utbildningsnämnden', intäkter: 1147, kostnader: -3770, kommunbidrag: 2668, resultat: 45, budget: 0 },
    { nämnd: 'Kommunledningen', intäkter: 176, kostnader: -543, kommunbidrag: 395, resultat: 29, budget: 0 },
  ],
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

for (const [år, nämnder] of Object.entries(DATA)) {
  const nodes: any[] = []
  const edges: any[] = []

  for (const n of nämnder) {
    const nodeId = `utfall-nämnd-${slugify(n.nämnd)}-${år}`
    const nämndId = NÄMND_ID_MAP[n.nämnd]
    const direktörId = DIREKTÖR_MAP[n.nämnd]

    nodes.push({
      id: nodeId,
      typ: 'utfall',
      label: `${n.nämnd} utfall ${år}: ${n.resultat > 0 ? '+' : ''}${n.resultat} mnkr`,
      data: {
        nämnd: n.nämnd,
        år: Number.parseInt(år),
        intäkterMnkr: n.intäkter,
        kostnaderMnkr: n.kostnader,
        kommunbidragMnkr: n.kommunbidrag,
        resultatMnkr: n.resultat,
        budgetMnkr: n.budget,
        status: n.resultat < -50 ? 'stort_underskott' : n.resultat < 0 ? 'underskott' : 'i_balans',
      },
    })

    if (nämndId) {
      edges.push({ from: nodeId, to: nämndId, typ: 'utfall_för', label: `${n.resultat > 0 ? '+' : ''}${n.resultat} mnkr` })
    }
    if (direktörId) {
      edges.push({ from: nodeId, to: direktörId, typ: 'ansvarig', label: 'förvaltningsdirektör', data: { resultatMnkr: n.resultat } })
    }
  }

  const outPath = join(OUTPUT_DIR, `utfall-nämnder-${år}.json`)
  writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2))
  console.log(`✓ ${outPath} (${nodes.length} nodes, ${edges.length} edges)`)
}
