# Begäran om allmän handling — instruktioner

## Generell kontakt (fungerar alltid)

```
goteborg@goteborg.se
```

De vidarebefordrar till rätt registrator.

## Vår email

```
dearbetarfordig@protonmail.com
```

## Template: avtalslista

```
Ämne: Begäran om allmän handling — gällande avtal [NÄMNDNAMN]

Hej,

Jag begär med stöd av 2 kap. tryckfrihetsförordningen att få ta del av 
följande allmänna handlingar:

1. Lista över samtliga gällande avtal hos [NÄMNDNAMN], 
   med följande uppgifter per avtal:
   - Leverantör (namn och organisationsnummer)
   - Avtalsperiod (startdatum och slutdatum)
   - Avtalsvärde (totalt eller per år)
   - Diarienummer/upphandlingsreferens
   - Kort beskrivning av avtalets omfattning

2. Specifikt önskar jag information om vilka av dessa avtal som 
   tecknats utan föregående annonserad upphandling.

Jag önskar handlingarna i digitalt format (Excel/CSV om möjligt, 
annars PDF).

Enligt TF 2 kap. 16 § ska begäran behandlas skyndsamt.

Med vänlig hälsning,
Konstantin Zykov
dearbetarfordig@protonmail.com
```

## Workflow

1. Skicka email → `goteborg@goteborg.se`
2. Vänta svar (1-5 arbetsdagar)
3. Spara attachment → `data/inbox/`
4. Kör: `npx tsx packages/pipeline/src/parsers/parse-inbox.ts`
5. Data → graf

## Frekvens

- Max 2-3 begäran per vecka (undvik att överbelasta registrator)
- Prioritetsordning: Intraservice → Inköp → Socialnämnder → övriga

## Juridik

- **Grundlag:** Tryckfrihetsförordningen 2 kap. (offentlighetsprincipen)
- **Tidskrav:** "skyndsamt" = 1-3 arbetsdagar
- **Kostnad:** Gratis (upp till 9 sidor), sedan 2 kr/sida
- **Anonymitet:** Du behöver inte uppge vem du är eller varför
- **Överklagan:** Om nekad → Kammarrätten i Göteborg
