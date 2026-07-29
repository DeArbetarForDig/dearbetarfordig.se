# Arbetslogg — AI-analyser

<!-- Genererad av `korpus.ts logg`. Redigera inte för hand: statusen ÄR
     filerna i data/analys/ai/. Kör om kommandot efter varje analys. -->

Uppdaterad 2026-07-29. **9 av 331** prognosvärda ärenden analyserade, 322 återstår.

Ett ärende i taget — en avbruten körning ska kosta ett ärende, inte en batch:

```bash
npx tsx packages/pipeline/src/analys/korpus.ts ko 1   # nästa ärende
# kör subagenten beslutsanalytiker på det ärendenumret, sedan:
npx tsx packages/pipeline/src/analys/korpus.ts logg   # uppdatera den här filen
```

## Klara

| Ärende | Datum | Riktning | Säkerhet | Granskad | Rubrik |
| --- | --- | --- | --- | --- | --- |
| SLK-2025-01138 | 2026-07-29 | blandad | medium | — | Motion av Kalle Bäck (KD) och Kristina Lallo (KD) om att riva upp besl |
| SLK-2026-00166 | 2026-07-29 | blandad | medium | — | Översyn av reglementen för Göteborgs Stads nämnder |
| SLK-2026-00317 | 2026-07-29 | blandad | medium | — | Antagande av detaljplan för Tvärförbindelse i Torslanda inom stadsdela |
| SLK-2026-00397 | 2026-07-29 | blandad | medium | — | Donation från Göteborgs Spårvägar AB av spårvagnar modell M29 till Myk |
| SLK-2026-00402 | 2026-07-29 | blandad | medium | — | Antagande av detaljplan för verksamheter vid Gamla Sörredsvägen i stad |
| SLK-2025-00122 | 2026-07-28 | blandad | medium | — | Modell för Göteborgs Stads klimatbudget |
| SLK-2026-00495 | 2026-07-28 | blandad | medium | — | Hemställan från Stiftelsen Göteborgs sjukhem, Stiftelsen Ålderdomshemm |
| SLK-2026-00510 | 2026-07-28 | blandad | medium | — | Revidering av reglemente för Göteborgs Stads överförmyndarnämnd |
| SLK-2026-00575 | 2026-07-28 | blandad | medium | — | Hemställan till regionfullmäktige om att genomföra biljettprisfrysning |

## Näst på tur

| Ärende | Skäl att analysera | Rubrik |
| --- | --- | --- |
| SLK-2026-00459 | omstritt beslut | Yrkande från S, V och MP särskilt yttrande C om evenemang, aktiviteter |
| SLK-2026-00107 | omstritt beslut | Funktionshinderombudsmannens årsrapport 2025 |
| SLK-2026-00235 | belopp nämns: 22 mnkr | Hemställan från Business Region Göteborg AB om godkännande av avtal rö |
| SLK-2026-00326 | gardering om pengar i texten | Redovisning av uppdrag till Göteborg & Co AB att utreda möjligheterna  |
| SLK-2025-01042 | belopp nämns: 22.5 mnkr | Motion av Jessica Blixt (D) och Martin Wannholt (D) om att revidera Gö |
| SLK-2026-00123 | belopp nämns: 31000 mnkr | Kompletterande uppföljning per december 2025 |
| SLK-2025-00983 | gardering om pengar i texten | Nytt hälso- och sjukvårdsavtal med tillhörande överenskommelser |
| SLK-2026-00203 | belopp nämns: 3005 mnkr | Redovisning av uppdrag att utreda och redovisa hur, ur en markägarroll |
| SLK-2025-01290 | belopp nämns: 2400 mnkr | Inriktningsbeslut för fortsatt planering av Mjörn vattentäkt |
| SLK-2025-01319 | omstritt beslut | Uppföljning av Göteborgs Stads systematiska miljöarbete 2025 |
