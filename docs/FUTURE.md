# Framtida funktioner

## PixelRAG — visuell PDF-parsning

**Status:** Utvärderat, ej implementerat (kostnadsskäl)

### Problem
Många kommunala dokument (delårsrapporter, budgetbilagor, upphandlingsprotokoll) innehåller komplexa tabeller som vår regex-parser inte kan hantera korrekt. Kolumner smälter ihop, nästlade kategorier tappas, och siffror hamnar i fel fält.

### Lösning
[PixelRAG](https://github.com/StarTrail-org/PixelRAG) renderar PDF:er som skärmdumpar och använder vision-modeller (VLM) för att extrahera data direkt från bilden — precis som en människa läser en tabell.

### Utvärdering (2026-06-23)
Testad på Intraservice delårsrapport Q1 2026 (26 sidor):
- **Rendering:** 2 sekunder via `pixelshot` → 26 tiles (JPG)
- **Tabellkvalitet:** Perfekt — kolumner, nästlade kategorier, totalsummor synliga
- **Jämfört med regex:** VLM kan läsa tabeller som regex missar (5-kolumns resultaträkning med underkategorier)

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
