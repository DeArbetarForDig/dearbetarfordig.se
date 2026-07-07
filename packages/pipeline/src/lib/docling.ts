/**
 * Bridge to the local Docling Python CLI (packages/pipeline/python/docling_extract.py).
 *
 * Pilot alternative to `pdftotext + regex` for PDFs whose tables regex can't parse
 * (wrapped headers, nested categories) — see docs/ANALYS-2026-07.md §2.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PYTHON_DIR = join(import.meta.dirname, '../../python')
const VENV_PYTHON = join(PYTHON_DIR, '.venv/bin/python3')
const EXTRACT_SCRIPT = join(PYTHON_DIR, 'docling_extract.py')

export interface DoclingTable {
  page: number | null
  index: number
  rows: string[][]
}

export interface DoclingResult {
  tables: DoclingTable[]
  markdown: string
}

function resolvePython(): string {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON
  console.warn(
    `⚠️  Docling venv saknas (${VENV_PYTHON}). Faller tillbaka på system-python3 — kör "cd packages/pipeline/python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" om Docling inte är installerat.`,
  )
  return 'python3'
}

/**
 * Docling (torch/transformers m.fl.) är för tungt att provisionera i CI —
 * tester som kräver riktig extraktion ska gatea sig mot detta och skippa
 * sig själva där venv:n saknas, istället för att krascha byggen.
 */
export function isDoclingAvailable(): boolean {
  return existsSync(VENV_PYTHON)
}

export function extractWithDocling(pdfPath: string): DoclingResult {
  const python = resolvePython()
  const output = execFileSync(python, [EXTRACT_SCRIPT, pdfPath], {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  })
  return JSON.parse(output)
}
