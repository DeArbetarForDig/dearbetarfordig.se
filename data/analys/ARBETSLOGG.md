# Arbetslogg — AI-analyser

<!-- Genererad av `korpus.ts logg`. Redigera inte för hand: statusen ÄR
     filerna i data/analys/ai/. Kör om kommandot efter varje analys. -->

Uppdaterad 2026-08-10. **26 av 331** prognosvärda ärenden analyserade, 305 återstår.

Ett ärende i taget — en avbruten körning ska kosta ett ärende, inte en batch:

```bash
npx tsx packages/pipeline/src/analys/korpus.ts ko 1   # nästa ärende
# kör subagenten beslutsanalytiker på det ärendenumret, sedan:
npx tsx packages/pipeline/src/analys/korpus.ts logg   # uppdatera den här filen
```

## Klara

| Ärende | Datum | Riktning | Säkerhet | Granskad | Rubrik |
| --- | --- | --- | --- | --- | --- |
| SLK-2025-01073 | 2026-08-01 | blandad | medium | — | Göteborgs Stads plan för arbetet mot hedersrelaterat våld och förtryck |
| SLK-2025-01302 | 2026-08-01 | positiv | medium | — | Reviderad bolagsordning och ägardirektiv för Störningsjouren i Götebor |
| SLK-2025-00983 | 2026-07-31 | positiv | medium | — | Nytt hälso- och sjukvårdsavtal med tillhörande överenskommelser |
| SLK-2025-01042 | 2026-07-31 | blandad | medium | — | Motion av Jessica Blixt (D) och Martin Wannholt (D) om att revidera Gö |
| SLK-2025-01065 | 2026-07-31 | blandad | medium | — | Motion av Axel Darvik (L) om att bevara och utveckla kryssningsturisme |
| SLK-2025-01087 | 2026-07-31 | blandad | medium | — | Motion av Rasmus Ragnarsson (SD), Agneta Kjaerbeck (SD) och Jörgen Fog |
| SLK-2025-01264 | 2026-07-31 | blandad | medium | — | Uppföljning av två planer - Göteborgs Stads handlingsplan för att inga |
| SLK-2025-01290 | 2026-07-31 | blandad | medium | — | Inriktningsbeslut för fortsatt planering av Mjörn vattentäkt |
| SLK-2025-01319 | 2026-07-31 | blandad | medium | — | Uppföljning av Göteborgs Stads systematiska miljöarbete 2025 |
| SLK-2025-01335 | 2026-07-31 | positiv | medium | — | Bemyndigande till exploateringsnämnden att förvärva fastigheten Kvislj |
| SLK-2026-00123 | 2026-07-31 | blandad | medium | — | Kompletterande uppföljning per december 2025 |
| SLK-2026-00176 | 2026-07-31 | blandad | medium | — | Återrapportering av uppdrag december 2025 |
| SLK-2026-00203 | 2026-07-31 | blandad | medium | — | Redovisning av uppdrag att utreda och redovisa hur, ur en markägarroll |
| SLK-2026-00326 | 2026-07-31 | blandad | medium | — | Redovisning av uppdrag till Göteborg & Co AB att utreda möjligheterna  |
| SLK-2026-00235 | 2026-07-30 | blandad | medium | — | Hemställan från Business Region Göteborg AB om godkännande av avtal rö |
| SLK-2025-01138 | 2026-07-29 | blandad | medium | — | Motion av Kalle Bäck (KD) och Kristina Lallo (KD) om att riva upp besl |
| SLK-2026-00107 | 2026-07-29 | blandad | medium | — | Funktionshinderombudsmannens årsrapport 2025 |
| SLK-2026-00166 | 2026-07-29 | blandad | medium | — | Översyn av reglementen för Göteborgs Stads nämnder |
| SLK-2026-00317 | 2026-07-29 | blandad | medium | — | Antagande av detaljplan för Tvärförbindelse i Torslanda inom stadsdela |
| SLK-2026-00397 | 2026-07-29 | blandad | medium | — | Donation från Göteborgs Spårvägar AB av spårvagnar modell M29 till Myk |
| SLK-2026-00402 | 2026-07-29 | blandad | medium | — | Antagande av detaljplan för verksamheter vid Gamla Sörredsvägen i stad |
| SLK-2026-00459 | 2026-07-29 | blandad | medium | — | Yrkande från S, V och MP särskilt yttrande C om evenemang, aktiviteter |
| SLK-2025-00122 | 2026-07-28 | blandad | medium | — | Modell för Göteborgs Stads klimatbudget |
| SLK-2026-00495 | 2026-07-28 | blandad | medium | — | Hemställan från Stiftelsen Göteborgs sjukhem, Stiftelsen Ålderdomshemm |
| SLK-2026-00510 | 2026-07-28 | blandad | medium | — | Revidering av reglemente för Göteborgs Stads överförmyndarnämnd |
| SLK-2026-00575 | 2026-07-28 | blandad | medium | — | Hemställan till regionfullmäktige om att genomföra biljettprisfrysning |

## Näst på tur

| Ärende | Skäl att analysera | Rubrik |
| --- | --- | --- |
| SLK-2025-01328 | belopp nämns: 25000 mnkr | Revidering av Göteborgs Stads miljö- och klimatprogram 2021-2030 |
| SLK-2025-00484 | belopp nämns: 75 mnkr | Motion av Anders Svensson (M) och Cecilia Magnusson (M) om plan för et |
| SLK-2025-00658 | belopp nämns: 150000 mnkr | Motion av Lena Ferm (SD) och Jörgen Fogelklou (SD) om en övergripande  |
| SLK-2025-00548 | omstritt beslut | Äldreombudsmannens rapport 2025 |
| SLK-2025-01278 | gardering om pengar i texten | Redovisning av uppdrag om modell för lekvärdesfaktorer |
| SLK-2025-01247 | belopp nämns: 24 mnkr | Antagande av detaljplan för äldreboende med mera vid Doktor Allards Ga |
| SLK-2025-00306 | omstritt beslut | Redovisning av uppdrag att ta fram förslag på hur borgerliga vigselför |
| SLK-2025-01039 | gardering om pengar i texten | Riksnorm ekonomiskt bistånd och riktmärken för boendekostnader 2026 |
| SLK-2025-01130 | belopp nämns: 10 mnkr | Revidering av Göteborgs Stads riktlinje för informationssäkerhet samt  |
| SLK-2025-01000 | belopp nämns: 1000000 mnkr | Revidering av Göteborgs Stads elektrifieringsplan 2022-2030 |
