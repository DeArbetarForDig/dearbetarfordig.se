# Unstructured.io — arkitekturreferens

> https://unstructured.io/
> Kommersiell ETL-plattform för ostrukturerad data. **Vi använder inte deras produkt** — bara som arkitekturreferens.

## Varför den finns här

Unstructured.io löser samma grundläggande problem som vår pipeline: tar "smutsiga" källor (PDF, HTML, video) och gör om dem till ren, strukturerad JSON. Deras Extract → Transform → Load-arkitektur är ett giltigt mönster, som vi implementerar själva.

## Vår positionering

| | Unstructured.io | dearbetarfordig.se |
|---|---|---|
| Licens | Proprietär SaaS + open source-kärna | **100% AGPL-3.0** |
| Beroenden | US-cloud, stängda API:er | **Self-hosted, EU only, inget vendor lock-in** |
| Fokus | Generisk ETL för GenAI/RAG | **Domänspecifik: svensk demokrati** |
| Pris | $0.01/sida, enterprise-nivå | **Gratis för alltid** |

## Vad vi tar med oss från dem (mönster, inte kod)

1. **Connector isolation** — varje källa = en egen modul med ett enhetligt output-format
2. **ETL separation** — tydlig uppdelning Extract/Transform/Load
3. **Incremental processing** — skrapa inte om allt varje gång

## Vad vi gör själva

- PDF-parsning av protokoll → egen parser (Playwright + Cheerio)
- HTML-skrapning → Cheerio (rena HTML-sajter) + Playwright (JS-formulär)
- Validering → Zod-scheman
- Lagring → PostgreSQL (self-hosted, Hetzner EU)

Tidigare provade vi whisper.cpp (self-hosted) för att transkribera video, men
Yttrandeprotokoll (officiell PDF med fullständig text) täcker redan alla möten
och är 100% korrekt utan ljudpipeline — transkriberingssteget är borttaget,
se `docs/PROGRESS.md`.

## Länkar (för fördjupning)

- Arkitektur: https://docs.unstructured.io/
- Open source-kärna: https://github.com/Unstructured-IO/unstructured (Apache 2.0)
