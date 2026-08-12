# Framtida funktioner

## MCP-server — direkt AI-agent-tillgång till API:et

**Status:** Planerad, ej påbörjad.

### Varför

API:t marknadsför sig redan som "sökbar och begriplig för alla medborgare
**och AI-agenter**" (`README.md`, `packages/api/src/index.ts` landningssida)
och har redan det som gör detta billigt: enbart `GET`, ingen auth, öppen
OpenAPI 3.1-schema på `/openapi.json` med Zod-scheman per route
(`@hono/zod-openapi`). MCP (Model Context Protocol) är nästa steg från
"maskinläsbart API" till "verktyg en LLM-agent kan anropa direkt" — utan att
agenten själv behöver läsa OpenAPI-spec och konstruera HTTP-anrop.

### Referens

[`docs/reference/riksdag-regering-mcp`](reference/README.md) —
[isakskogstad/Riksdag-Regering-MCP](https://github.com/isakskogstad/Riksdag-Regering-MCP),
en aktiv MCP-server för `data.riksdagen.se` + `g0v.se`. Direkt jämförbar
domän (svensk politisk öppen data), löst samma problem vi kommer att stöta på.

### Bedömning — inte komplext, inte resurskrävande

- **Verktygsscheman:** kan återanvända befintliga Zod-scheman per route
  (`@hono/zod-openapi`) i stället för att skriva ett separat schema per
  MCP-tool för hand, som referensprojektet gör (`mcp/src/tools/*.ts`, en fil
  per verktyg). Ett GET-only, auth-fritt API är närmast bäst tänkbara
  utgångsläge för det här.
- **Resurser:** MCP-servern är en tunn wrapper som anropar det befintliga
  Hono-API:t — ingen egen databas, ingen ny tung process. Jämförbar vikt med
  API:t självt.
- **Hosting:** samma Hetzner-server, samma `docker-compose.yml` (ny service),
  egen Caddy site-block (t.ex. `mcp.dearbetarfordig.se`), samma
  GHCR-build-and-push + manuell `deploy.yml`-dispatch som redan finns för
  API:et (se `docs/HOSTING.md`).

### Den enda verkliga designfrågan — transport

MCP SDK:ets standardtransport är **stdio** (lokal subprocess, t.ex. Claude
Desktop). En publik, fjärransluten server kräver Streamable HTTP/SSE i
stället, och referensprojektet visar att det inte är trivialt i praktiken:
utöver standard-MCP (`POST /mcp`, JSON-RPC 2.0) byggde de en unified endpoint
som även hanterar ett legacy REST-liknande format ("för ChatGPT", enligt
kodkommentar) och ett separat `/sse`-fallback för klienter utan stöd för
Streamable HTTP. Det mönstret — inte bara "installera SDK:et" — är vad som
behöver kopieras.

### Nästa steg

1. Läs `docs/reference/riksdag-regering-mcp/mcp/src/server.ts` och
   `IMPLEMENTATION_GUIDE.md` för transport-detaljerna
2. Prototyp: generera MCP-tools från `/openapi.json` (eller de befintliga
   Zod-schemana direkt) för ett fåtal routes (`politiker`, `beslut`, `sök`)
3. HTTP/SSE-transport enligt referensmönstret ovan
4. `docker-compose.yml`-service + Caddy site-block + CI-pipeline (samma
   mönster som API:et)

---

## PixelRAG — visuell PDF-parsning

**Status:** Utvärderat, ej implementerat — kostnadsproblemet löst istället via [Docling](https://github.com/docling-project/docling) (lokal, gratis, se `docs/ANALYS-2026-07.md` §2). Samma testdokument (Intraservice delårsrapport mars 2026) parsades framgångsrikt med Docling 2026-07-02, utan VLM-kostnad. PixelRAG kvarstår som möjlig fallback för dokument Docling inte heller klarar (punkt 3 nedan).

### Problem

Många kommunala dokument (delårsrapporter, budgetbilagor, upphandlingsprotokoll) innehåller komplexa tabeller som vår regex-parser inte kan hantera korrekt. Kolumner smälter ihop, nästlade kategorier tappas, och siffror hamnar i fel fält.

### Lösning

[PixelRAG](https://github.com/StarTrail-org/PixelRAG) renderar PDF:er som skärmdumpar och använder vision-modeller (VLM) för att extrahera data direkt från bilden — precis som en människa läser en tabell.

### Utvärdering (2026-06-23)

Testad på Intraservice delårsrapport Q1 2026 (26 sidor):

- **Rendering:** 2 sekunder via `pixelshot` → 26 tiles (JPG)
- **Tabellkvalitet:** Ursprungligen bedömd "Perfekt" — kolumner, nästlade kategorier, totalsummor synliga
- **Jämfört med regex:** VLM kan läsa tabeller som regex missar (5-kolumns resultaträkning med underkategorier)
- **Uppdaterat 2026-07-02:** vid jämförelse mot Docling-parsningen (`docs/ANALYS-2026-07.md` §2) hittades två faktiska fel i det pdftotext+PixelRAG-sammanställda `data/graf/intraservice-delarsrapport-q1-2026.json`: (1) ett värde från raden `Kommunbidrag` feltolkat som `Resultat`, och (2) `budget_kostnader_helår` läst från `Totalt`-raden i fel tabell (helår-tjänstetabellen) istället för resultaträkningens egen kolumn. Den `Totalt`-raden har dessutom ett verkligt fel i själva källdokumentet — inte i extraktionen: `Intäkter helår` är felvänd (`-1 633,7` istället för `+1 633,7`), medan `Kostnader`/`Budget kostnader`/`Resultat`/`Avvikelse` i samma rad stämmer. Docling-parsern har nu en avstämningskontroll per kolumn som pekade ut exakt vilken enskild cell som var fel. "Perfekt" bör alltså läsas som "visuellt plausibel", inte siffermässigt verifierad — och tyder på att VLM-läsning inte automatiskt är säkrare än strukturerad tabellextraktion utan en oberoende avstämning ovanpå.

### Varför inte nu

- **Kostnad:** Varje PDF-sida kräver ett VLM API-anrop (~$0.01–0.03/sida)
- **Volym:** 100+ PDF:er × 10–30 sidor = $30–90 per full körning
- **Latens:** ~3s per sida vs <1ms för regex

### När det blir relevant

1. Nya dokumenttyper som regex inte klarar (komplexa budgetbilagor, grafiska rapporter)
2. Om/när vi får sponsring eller intäkter som täcker API-kostnader
3. Som fallback för dokument där regex-parsern ger felaktiga resultat

### Implementation (framtida)

```bash
pip install pixelrag
pixelshot document.pdf --output ./tiles/
# → Skicka tiles till Claude Vision / Qwen-VL för strukturerad extraktion
```

---

## Maskinläsbara öppna data direkt från kommunen

**Status:** Långsiktig vision

### Problem idag

Göteborgs Stad publicerar beslut, budget och protokoll som **PDF:er** — skannade, formaterade för utskrift, dolda i byråkratiska webbtjänster. Vi måste:

1. Scrapa webbsajter (Playwright/Cheerio)
2. Ladda ner PDF:er
3. Köra pdftotext + regex-parser
4. Gissa tabellstruktur
5. Manuellt verifiera resultat

Varje steg introducerar fel. Tabeller förstörs. Metadata saknas.

### Vision: kommunen publicerar API-first

Om dearbetarfordig.se visar att det **finns efterfrågan** på strukturerad kommundata, kan vi driva frågan politiskt:

> Alla offentliga handlingar bör publiceras i maskinläsbart format (JSON/CSV) parallellt med PDF, via ett öppet REST API.

### Steg dit

1. **Visa värdet** — vår plattform bevisar att strukturerad data skapar nytta
2. **Begäran om allmän handling** — begär att kommunen publicerar i JSON-format
3. **Politisk motion** — föreslå öppet data-API i kommunfullmäktige
4. **Samarbete med SKR** — Sveriges Kommuner och Regioner har ramverk för öppna data
5. **EU-krav** — Open Data Directive (2019/1024) kräver maskinläsbara format

### Vad det skulle innebära

- Inget behov av scrapers eller PDF-parsers
- Realtidsuppdateringar (webhook vid nytt beslut)
- Strukturerad data från dag 1 (schema, typer, relationer)
- Andra utvecklare kan bygga appar utan att duplicera vårt arbete
- Kostnad för PixelRAG/VLM försvinner helt

### Förebilder

- **Stockholm Stad** — öppna data-portalen (datastorsthlm.se)
- **Helsingfors** — paatokset.hel.fi (besluts-API)
- **EU Parliament** — data.europarl.europa.eu (SPARQL endpoint)
- **UK Parliament** — api.parliament.uk (REST API med JSON)

---

*Public money, public code. Public decisions, public data.*
