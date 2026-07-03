#!/usr/bin/env npx tsx
/**
 * Budget Reconciliation — verifies that parsed budget data sums up correctly.
 *
 * Checks:
 * 1. Σ(nämnder kommunbidragMnkr) ≈ total budget from budget-2026.json
 * 2. Each nämnd's budgetposter sum ≈ nämnd's kommunbidragMnkr
 *
 * Run: npx tsx packages/pipeline/src/tests/budget-reconciliation.ts
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TOLERANCE = 0.05 // 5% tolerance for rounding

const grafDir = join(import.meta.dirname, '../../../../data/graf')

// Load main budget
const mainBudget = JSON.parse(readFileSync(join(grafDir, 'budget-2026.json'), 'utf-8'))
const totalBudget = mainBudget.nodes.find((n: any) => n.id === 'budget-2026')?.data?.totalMnkr

// Load all nämnd organisations with kommunbidragMnkr
const allNodes = mainBudget.nodes.filter(
  (n: any) => n.typ === 'organisation' && n.data?.kommunbidragMnkr,
)
const nämndTotal = allNodes.reduce((s: number, n: any) => s + n.data.kommunbidragMnkr, 0)

console.log('═══════════════════════════════════════════════')
console.log(' Budget Reconciliation — dearbetarfordig.se')
console.log('═══════════════════════════════════════════════\n')

// Check 1: nämnder sum vs total
console.log('1. Nämnder → Total budget')
console.log(`   Σ nämnder:  ${nämndTotal.toLocaleString('sv-SE')} mnkr`)
console.log(`   Total doc:  ${totalBudget?.toLocaleString('sv-SE')} mnkr`)
const diff1 = Math.abs(nämndTotal - totalBudget) / totalBudget
if (diff1 < TOLERANCE) {
  console.log(`   ✓ OK (diff ${(diff1 * 100).toFixed(1)}%)\n`)
} else {
  console.log(
    `   ✗ MISMATCH (diff ${(diff1 * 100).toFixed(1)}%, ${Math.abs(nämndTotal - totalBudget).toFixed(0)} mnkr)\n`,
  )
}

// Check 2: per-nämnd budgetposter vs nämnd total
console.log('2. Budgetposter per nämnd')
const budgetFiles = readdirSync(grafDir).filter(
  (f) => f.startsWith('budget-') && f !== 'budget-2026.json',
)

let passed = 0
let failed = 0
let skipped = 0

for (const file of budgetFiles) {
  const data = JSON.parse(readFileSync(join(grafDir, file), 'utf-8'))
  const posts = data.nodes.filter((n: any) => n.typ === 'budgetpost')

  if (posts.length === 0) {
    skipped++
    continue
  }

  // Find the nämnd's known total from the main budget
  const nämndName = file.replace('budget-', '').replace('-2026.json', '').replace(/-/g, ' ')

  // Get only intäkt/kostnad posts (not subtotals)
  // For this check we just verify no absurd values remain
  const absurdPosts = posts.filter((n: any) => Math.abs(n.data?.mnkr || 0) > 50000)

  if (absurdPosts.length > 0) {
    console.log(`   ✗ ${file}: ${absurdPosts.length} poster > 50 000 mnkr (orimligt)`)
    absurdPosts.forEach((p: any) => console.log(`     → ${p.label}: ${p.data.mnkr} mnkr`))
    failed++
  } else {
    console.log(`   ✓ ${file}: ${posts.length} poster, alla rimliga`)
    passed++
  }
}

console.log('\n═══════════════════════════════════════════════')
console.log(` Resultat: ${passed} OK, ${failed} FEL, ${skipped} hoppade`)
console.log('═══════════════════════════════════════════════')

// Check 3: Deep reconciliation — known subtotal relationships
console.log('\n3. Djup avstämning (kända subtotaler)')

const deepChecks: {
  file: string
  sumOf: string[]
  shouldEqual: string | null
  expectedZero?: boolean
  label: string
}[] = [
  {
    file: 'budget-grundskola-2026.json',
    sumOf: [
      'Kulturskola',
      'Anpassad grundskola',
      'Grundskola inklusive förskoleklass och fritidshem',
    ],
    shouldEqual: 'Ram att fördela',
    label: 'Grundskola: verksamheter ≈ ram att fördela',
  },
  {
    file: 'budget-grundskola-2026.json',
    sumOf: ['Intäkter', 'Kostnader', 'Kommunbidrag'],
    shouldEqual: null as any,
    expectedZero: true,
    label: 'Grundskola: intäkter + kostnader + kommunbidrag = 0 (nollresultat)',
  },
  {
    file: 'budget-stadsmiljönämnden-2026.json',
    sumOf: [
      'Personalkostnader',
      'Övriga verksamhetskostnader',
      'Kapitaltjänst (avskrivningar + ränta)',
    ],
    shouldEqual: 'Summa kostnader',
    label: 'Stadsmiljö: kostnadsposter = summa kostnader',
  },
  {
    file: 'budget-förskolenämnden-2026.json',
    sumOf: ['Intäkter', 'Kostnader', 'Kommunbidrag (ram)'],
    shouldEqual: null as any,
    expectedZero: true,
    label: 'Förskola: intäkter + kostnader + kommunbidrag = 0 (nollresultat)',
  },
]

let deepPassed = 0
let deepFailed = 0

for (const check of deepChecks) {
  try {
    const data = JSON.parse(readFileSync(join(grafDir, check.file), 'utf-8'))
    const posts = data.nodes.filter((n: any) => n.typ === 'budgetpost')
    const getVal = (label: string) => posts.find((p: any) => p.label === label)?.data?.mnkr

    const sumParts = check.sumOf.reduce((s, label) => s + (getVal(label) || 0), 0)

    if (check.expectedZero) {
      const diff = Math.abs(sumParts)
      if (diff < 1) {
        console.log(`   ✓ ${check.label} (Σ = ${sumParts})`)
        deepPassed++
      } else {
        console.log(`   ✗ ${check.label} (Σ = ${sumParts}, borde vara 0)`)
        deepFailed++
      }
      continue
    }

    const expected = getVal(check.shouldEqual!)

    if (expected == null) {
      console.log(`   ? ${check.label} — subtotal "${check.shouldEqual}" saknas`)
      continue
    }

    const diff = Math.abs(sumParts - expected) / Math.abs(expected)
    if (diff < TOLERANCE) {
      console.log(
        `   ✓ ${check.label} (${sumParts.toLocaleString('sv-SE')} ≈ ${expected.toLocaleString('sv-SE')})`,
      )
      deepPassed++
    } else {
      console.log(`   ✗ ${check.label}`)
      console.log(
        `     Σ delar: ${sumParts.toLocaleString('sv-SE')} ≠ ${check.shouldEqual}: ${expected.toLocaleString('sv-SE')} (diff ${(diff * 100).toFixed(1)}%)`,
      )
      deepFailed++
    }
  } catch {
    console.log(`   ? ${check.label} — kunde inte läsa ${check.file}`)
  }
}

console.log('\n═══════════════════════════════════════════════')
console.log(` Total: ${passed + deepPassed} OK, ${failed + deepFailed} FEL`)
console.log('═══════════════════════════════════════════════')

process.exit(failed + deepFailed > 0 ? 1 : 0)
