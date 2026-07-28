# Arbetslogg — AI-analyser

<!-- Genererad av `korpus.ts logg`. Redigera inte för hand: statusen ÄR
     filerna i data/analys/ai/. Kör om kommandot efter varje analys. -->

Uppdaterad 2026-07-28. **1 av 333** prognosvärda ärenden analyserade, 332 återstår.

Ett ärende i taget — en avbruten körning ska kosta ett ärende, inte en batch:

```bash
npx tsx packages/pipeline/src/analys/korpus.ts ko 1   # nästa ärende
# kör subagenten beslutsanalytiker på det ärendenumret, sedan:
npx tsx packages/pipeline/src/analys/korpus.ts logg   # uppdatera den här filen
```

## Klara

| Ärende | Datum | Riktning | Säkerhet | Granskad | Rubrik |
| --- | --- | --- | --- | --- | --- |
| SLK-2025-00122 | 2026-07-28 | blandad | medium | — | Modell för Göteborgs Stads klimatbudget |

## Näst på tur

| Ärende | Skäl att analysera | Rubrik |
| --- | --- | --- |
| SLK-2026-00575 | belopp 6500 mnkr | Yrkande från S, V och MP angående hemställan till regionfullmäktige om |
| SLK-2026-00510 | belopp 35.7 mnkr | Revidering av reglemente för Göteborgs Stads överförmyndarnämnd |
| SLK-2026-00495 | belopp 190 mnkr | Hemställan från Stiftelsen Göteborgs sjukhem, Stiftelsen Ålderdomshemm |
| SLK-2026-00402 | finansiering erkänt osäker | Antagande av detaljplan för verksamheter vid Gamla Sörredsvägen i stad |
| SLK-2026-00397 | finansiering erkänt osäker | Donation från Göteborgs Spårvägar AB av spårvagnar modell M29 till Myk |
| SLK-2025-01138 | belopp 274 mnkr | Motion av Kalle Bäck (KD) och Kristina Lallo (KD) om att riva upp besl |
| SLK-2026-00166 | omstritt beslut | Översyn av reglementen för Göteborgs Stads nämnder |
| SLK-2026-00317 | finansiering erkänt osäker | Antagande av detaljplan för Tvärförbindelse i Torslanda inom stadsdela |
| SLK-2026-00459 | omstritt beslut | Yrkande från S, V och MP särskilt yttrande C om evenemang, aktiviteter |
| SLK-2026-00107 | finansiering erkänt osäker | Funktionshinderombudsmannens årsrapport 2025 |
