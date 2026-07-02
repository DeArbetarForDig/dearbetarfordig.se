# Docling-parsning (pilot)

Lokal, gratis PDF-tabellextraktion via [Docling](https://github.com/docling-project/docling) —
används av `../src/parsers/parse-delarsrapport.ts` som fast-path-alternativ till
`pdftotext + regex` för dokument med tabeller regex inte klarar (se
`docs/ANALYS-2026-07.md` §2).

## Setup

```bash
cd packages/pipeline/python
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Första körningen laddar ner Doclings layout-/tabellmodeller (cachas i `~/.cache/docling`,
utanför repot) — kräver nätverk en gång. Därefter körs allt offline, utan API-kostnad.

## Användning

Anropas normalt inte direkt — `src/lib/docling.ts` shell:ar ut till detta skript.

```bash
.venv/bin/python3 docling_extract.py <pdf-sökväg>
```

Skriver ett JSON-objekt `{ tables: [{ page, index, rows }], markdown }` till stdout.
