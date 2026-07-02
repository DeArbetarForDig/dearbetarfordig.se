#!/usr/bin/env python3
"""Extract tables + markdown from a PDF via Docling.

Usage: python3 docling_extract.py <pdf-path>

Prints a single JSON object to stdout:
  { "tables": [{ "page": int, "index": int, "rows": [[str, ...], ...] }],
    "markdown": str }
"""

import json
import sys

from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat


def extract(pdf_path: str) -> dict:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False
    pipeline_options.do_table_structure = True

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )
    result = converter.convert(pdf_path)
    doc = result.document

    tables = []
    for index, table in enumerate(doc.tables):
        df = table.export_to_dataframe(doc)
        rows = [list(df.columns)] + df.astype(str).values.tolist()
        page = table.prov[0].page_no if table.prov else None
        tables.append({"page": page, "index": index, "rows": rows})

    return {"tables": tables, "markdown": doc.export_to_markdown()}


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python3 docling_extract.py <pdf-path>", file=sys.stderr)
        sys.exit(1)

    output = extract(sys.argv[1])
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
