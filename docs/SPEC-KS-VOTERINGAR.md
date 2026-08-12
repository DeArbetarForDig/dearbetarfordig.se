# Spec: poströstningar (namngivna voteringar) ur KS-protokoll

*Skriven 2026-07-02 för implementation i en kommande session. Punkt 12 i [ANALYS-2026-07.md](ANALYS-2026-07.md).*

> **Status: implementerad.** `parseOmröstningar`/`parseEttVoteringsblock` i
> `packages/pipeline/src/parsers/parse-protokoll-ks.ts` täcker alla
> varianter i denna spec, med golden-tester i
> `parse-protokoll-ks-votering.test.ts` (177 rader, inklusive exakt de
> fall som listas nedan). Körd på riktigt mot 51 KS-protokoll — 42 filer
> `data/graf/ks-*.json` innehåller `votering`-block. Den relaterade
> KF/KS-etikettbuggen på beslutssidan är också fixad (`organ` härleds nu
> ur id-prefixet, inte hårdkodat). Dokumentet nedan är lämnat som det var
> skrivet — som teknisk spec över vad som byggdes, inte som en öppen plan.

## Mål

KS-protokoll skriver ner resultatet av poströstningar **som löpande text i paragrafen** (sektionen "Omröstning"), inte som separata voteringsbilagor som KF gör. `parse-protokoll-ks.ts` ignorerar i dagsläget den sektionen — rösterna går förlorade trots att de syns i den råa `fulltext` på beslutssidorna. Uppgiften: extrahera dem till samma strukturerade format som KF (`röstade_*`-kanter + `votering`-räknare), så att API, frontend och metrics (Rice Index) plockar upp datan utan ändringar där.

**Datamängd:** 51 KS-protokoll i `.tmp/ks-protokoll-*.pdf` (2024-01 … 2026-06), med **224 Omröstning-sektioner** ≈ 2 900 individuella röster (13 röstande i KS).

## Källdata

- PDF:erna ligger i `.tmp/ks-protokoll-YYYY-MM-DD.pdf` (mappen är **gitignored** — om filerna saknas, hämta om via `packages/pipeline/src/scrapers/handlingar-ks.ts` / batch-skriptet `batch-reparse-protokoll-ks.ts`)
- Nuvarande parser: `packages/pipeline/src/parsers/parse-protokoll-ks.ts` → `data/graf/ks-{datum}.json` (nodes + edges)
- Textextraktion: `pdftotext "<pdf>" -` (**utan** `-layout` — så görs det redan i KS-parsern; rätt val för löpande text)

## Anatomin i en Omröstning-sektion (alla varianter belagda med riktiga PDF:er)

Grundstruktur i paragraf-texten:

```
Propositionsordning
Ordföranden … ställer propositioner … Omröstning begärs.

Omröstning

Godkänd voteringsproposition: ”Ja för avslag och Nej för bifall till yrkandet från
L, M, D, KD och SD.”
Daniel Bernmar (V), Viktoria Tryggvadottir Rolka (S), Blerta Hoti Singh (S),
Jenny Broman (V), Karin Pleijel (MP), tjänstgörande ersättaren Johannes Hulter (S) och
ordföranden Jonas Attenius (S) röstar Ja (7).
Axel Josefson (M), Hampus Magnusson (M), Martin Wannholt (D),
Jörgen Fogelklou (SD), Axel Darvik (L) och Dan-Ove Marcelind (KD) röstar Nej (6).
```

### Varianter parsern måste hantera

| # | Variant | Verkligt exempel |
|---|---|---|
| 1 | Två sorters citattecken | `”…”` (typographic) och `"…"` (straight) — båda förekommer |
| 2 | Proposition "Ja = avslag" | `"Ja för avslag och Nej för bifall till tilläggsyrkande från SD."` — **Ja betyder röst EMOT förslaget** |
| 3 | Proposition "Ja = bifall" | `"Ja för bifall och Nej för avslag på stadsledningskontorets förslag."` |
| 4 | Duell mellan två yrkanden | `"Ja för bifall till Jonas Attenius yrkande och Nej för bifall till Axel Josefsons yrkande."` — inget "för/emot", ett val mellan alternativ |
| 5 | Avstående | `Axel Josefson (M) och Hampus Magnusson (M) avstår från att rösta (2).` |
| 6 | Prefix i singular | `tjänstgörande ersättaren Johannes Hulter (S)` |
| 7 | Prefix i plural — gäller FLERA efterföljande namn | `tjänstgörande ersättarna Johannes Hulter (S) och Marie Brynolfsson (V)` |
| 8 | `ordföranden` framför ett namn | `och ordföranden Jonas Attenius (S) röstar Ja (7).` |
| 9 | Blandade avgränsare i uppräkningen | komma, `och`, `samt` — alla tre kan förekomma i samma lista |
| 10 | Radbrytning MITT I ett namn | `Viktoria\nTryggvadottir Rolka (S)` — går inte att parsa radvis |
| 11 | Sid-header bryter sektionen | mellan `Omröstning` och propositionen kan `Göteborgs Stad Kommunstyrelsen protokoll`, `Protokoll nr 13`, `Sammanträdesdatum: …`, `NN (NN)` (sidnummer) klämma sig in |
| 12 | Icke-röst i närheten | `deltar inte i beslutet`, `Jäv: … deltar inte i handläggningen` — får INTE förväxlas med avstår; registreras separat eller ignoreras |

**Viktigt:** rensning av sid-artefakter måste göras FÖRE matchningen — regexerna för det finns redan i `parse-protokoll-ks.ts` (blocket "Clean fulltext", rad ~117-123). Att parsa omröstningen ur den redan rensade `fulltext` är enklaste vägen.

## Lösningsdesign

### Plats i koden

Utöka `parseParagrafer()` i `parse-protokoll-ks.ts` (paragraf-texten är redan isolerad, rensningen finns redan) — ny funktion `parseOmröstning(fulltext: string)`. Ingen egen parser-fil behövs: till skillnad från KF lever rösterna här inuti §:en och hamnar i samma `ks-{datum}.json`.

### Algoritm

1. Hitta blocket i paragrafens fulltext från `Omröstning\n` till nästa kända rubrik (`Reservation`, `Protokollsanteckning`, `Protokollsutdrag`, §:ens slut)
2. Extrahera `Godkänd voteringsproposition: [”"](.+?)[”"]` (flerradig, kollapsa radbrytningar)
3. Tolka propositionens semantik:
   - `Ja för bifall … Nej för avslag` → `ja = bifall`, `nej = avslag`
   - `Ja för avslag … Nej för bifall` → `ja = avslag`, `nej = bifall`
   - `Ja för bifall till X … Nej för bifall till Y` → `ja = bifall X`, `nej = bifall Y` (spara beskrivningssträngarna)
   - Inget kändes igen → `betydelse: null` + varning (rösterna sparas ändå)
4. Hitta röstgrupper: segment som avslutas med `röstar Ja (N).`, `röstar Nej (N).`, `avstår från att rösta (N).`
5. Inom varje segment: kollapsa radbrytningar → skala bort prefixen `tjänstgörande ersättaren/ersättarna`, `ordföranden` → dela på `,` / `och` / `samt` → extrahera `Namn (Parti)` ur varje element
6. **Validering:** antalet extraherade namn === N inom parentesen. Avvikelse → `console.warn` med datum/§, och räkna inte in i räknarna — spara det som parsades men märk `verified: false`

### Matchning av namn mot politiker

Återanvänd angreppssättet från `parse-voteringar.ts:113-133` (KF): en karta `"förnamn efternamn".toLowerCase()` → `politiker-{uuid}` ur `data/politiker/goteborg.json`, med fallback på delar av sammansatta efternamn. KS-ledamöterna är en delmängd av dessa politiker, täckningen ska vara 100% — utebliven matchning → varning.

### Utdataformat (speglar KF)

I `data/graf/ks-{datum}.json`:

```jsonc
// I data-fältet på den befintliga paragraf-noden (id: "ks-{datum}-§{nr}") läggs till:
"votering": {
  "ja": 7, "nej": 6, "avstår": 0,
  "proposition": "Ja för avslag och Nej för bifall till yrkandet från L, M, D, KD och SD.",
  "jaBetyder": "avslag",   // eller "bifall", eller yrkandets beskrivning vid en duell, eller null
  "nejBetyder": "bifall"
}

// Nya kanter (som hos KF, se parse-voteringar.ts:146-151):
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_ja" }
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_nej" }
{ "from": "politiker-{uuid}", "to": "ks-{datum}-§{nr}", "typ": "röstade_avstår" }
```

`db:seed` laddar redan alla `data/graf/*.json` i sin helhet — inga ändringar behövs i seed. API:et returnerar `data->'votering'` för beslut — kontrollera att KS-beslut-endpointen plockar upp den.

### Batch-körning

`batch-reparse-protokoll-ks.ts` regenererar redan alla `ks-*.json` — kör den mot alla 51 PDF:er efter implementationen, sedan `pnpm --filter @daf/api db:seed`.

## Relaterad bugg: "KF"-etiketter på KS-beslut (fixas i samma uppgift)

Beslutssidan visar KS-beslut med etiketten "KF § 478" / "KF beslut — Avslag". Källa: **`packages/web/src/pages/goteborg/beslut/[id].astro:98`** — en literal `` `KF beslut — ${...}` `` utan hänsyn till organ. Organet ska härledas ur nod-id:ts prefix (`kf-` / `ks-`) eller ur `data.organ` ("Kommunfullmäktige" / "Kommunstyrelsen" — KS-parsern skriver redan det fältet). Kontrollera även rubriken "KF § N" på samma sida.

## Golden-tester (första fixturerna)

| Fixtur | Vad den täcker |
|---|---|
| KS 2026-06-17 § 478 (SLK-2026-00676) | Grundfallet: Ja=avslag, 7-6, prefixen ersättaren+ordföranden, typografiska citattecken |
| KS 2026-06-17, § med "Ja för bifall till Jonas Attenius yrkande…" | Duell mellan två yrkanden |
| KS 2024-04-24, § med "avstår från att rösta (2)" | Avstående + `ersättarna` (plural) + `samt` + radbrytning mitt i ett namn (Viktoria Tryggvadottir Rolka) |

Testformat: ett par "rå sektionstext (klistras in i testet som en sträng) → förväntat votering-objekt + listor med politiker-id". Vitest är redan konfigurerat i `@daf/api`; lägg till `vitest` för pipeline på samma sätt.

## Acceptanskriterier

1. `batch-reparse-protokoll-ks.ts` över alla 51 PDF:er: ≥ 220 av 224 voteringar parsade med `verified: true`; resten listas som varningar (inte tyst bortfall)
2. Summan `ja+nej+avstår` för varje votering matchar siffrorna inom parentes i PDF:en
3. 100% av namnen matchade mot `politiker-{uuid}` (KS-ledamöter är kända politiker)
4. Efter seed: `curl localhost:3000/v1/goteborg/beslut/ks-2026-06-17-§478` innehåller votering och röster
5. Beslutssidan för ett KS-beslut visar poströstningarna (som den redan gör för KF) och rätt etikett "KS"
6. Golden-testerna är gröna; `pnpm lint` och full `pnpm build` går igenom
7. Både den råa Ja/Nej-rösten och betydelsen sparas — faktakollen "vem var för/emot yrkandet" blir inte inverterad

## Vad som INTE ska göras

- Rör inte KF-parsern (`parse-voteringar.ts`) — annat inputformat, fungerar redan
- Ändra inte formatet på befintliga kanter/noder — bara lägg till
- Ta inte bort den råa sektionen ur `fulltext` — den ska finnas kvar som källa för mänsklig granskning
- `deltar inte i beslutet` / jäv — registreras inte som avstår (kan läggas i ett eget fält `deltarInte`, men det är valfritt)
