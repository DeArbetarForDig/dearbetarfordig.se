# Demokratiska nyckeltal — Metodik & Källor

Vetenskapligt grundade metrics för utvärdering av kommunfullmäktige.

## Metriker

### Konsensusgrad (Consensus Rate)
- **Formel:** `ärenden_utan_votering / totalt_antal_ärenden`
- **Tolkning:** Andel beslut som fattades utan formell omröstning (enighet)
- **Normvärde:** 80–90% typiskt för svenska kommuner
- **Källa:** Bäck, H. (2003). *Explaining and Predicting Coalition Outcomes.* European Journal of Political Research.

### Rice Index (Parti-sammanhållning)
- **Formel:** `|ja - nej| / (ja + nej)` per parti per votering, genomsnitt
- **Tolkning:** 1.0 = alla i partiet röstar lika; 0.5 = helt splittrat
- **Källa:** Rice, S.A. (1924). *Farmers and Workers in American Politics.* Columbia University Press.
- **Källa:** Rich, T.S. (2014). *Party Voting Cohesion in Mixed Member Legislative Systems.* Legislative Studies Quarterly, 39(1).
- **Källa:** Desposato, S.W. (2017). *Measuring Party Discipline.* Legislative Studies Quarterly.

### Debatt-Gini (talartidsfördelning)
- **Formel:** Gini-koefficient över antal anföranden per politiker
- **Tolkning:** 0 = alla talar lika mycket; 1 = en person dominerar helt
- **Normvärde:** 0.4–0.6 anses balanserat; >0.7 tyder på dominans
- **Källa:** Bächtiger, A. et al. (2005). *The Deliberative Dimensions of Legislatures.* Acta Politica, 40.
- **Källa:** Steiner, J. et al. (2004). *Deliberative Politics in Action.* Cambridge University Press.

### Debattdjup (Debate Depth) — specificerad, ej implementerad
- **Formel:** `totalt_antal_anföranden / antal_voteringsärenden`
- **Tolkning:** Fler anföranden per ärende = djupare deliberation
- **Källa:** Steenbergen, M.R. et al. (2003). *Measuring Political Deliberation.* Comparative European Politics, 1(1).
- **Status:** finns bara i denna spec — `packages/api/src/routes/metrics.ts` beräknar den inte (ingen `debattdjup`-nyckel i svaret). Bygg eller ta bort avsnittet.

### Jävsanmälningar (implementerad, ej i denna spec förrän nu)
- **Fält:** `aktivitet.jävsanmälningar` i `/metrics`-svaret
- **Källa:** `jävsanmälan`-kanter i grafen, deterministiskt räknade i `generate-analys.ts` (steg 1 av analyslagret, se `docs/SPEC-ANALYS.md`)

### Röstöverensstämmelse (implementerad, ej i denna spec förrän nu)
- **Vad:** parti × parti-matris över hur ofta partierna röstar lika
- **Källa:** `packages/api/src/routes/metrics.ts`, beräknad från `röstade_*`-kanterna

### Närvaro (Attendance Rate)
- **Formel:** `närvaroregistreringar / (möten × 81)`
- **Tolkning:** Andel ledamöter som faktiskt deltar
- **Källa:** SKR (Sveriges Kommuner och Regioner). *Öppna jämförelser — demokrati.*

### Beslutskraft (Legislative Productivity)
- **Formel:** `bifall / totalt_beslut_med_status`
- **Tolkning:** Andel ärenden som faktiskt avgörs (inte bordläggs)
- **Källa:** Volden, C. & Wiseman, A.E. (2014). *Legislative Effectiveness in the United States Congress.* Cambridge University Press.

### Reservationsfrekvens
- **Formel:** `reservationer / beslut`
- **Tolkning:** Hur aktivt oppositionen markerar sin avvikande mening
- **Källa:** Hermansson, J. et al. (1999). *Avkorporativisering och lobbyism.* SOU 1999:121.

## Datakällor

| Data | Källa | Metod |
|------|-------|-------|
| Voteringar (30 317 individuella röster: ja/nej/avstår/frånvarande) | KF- **och** KS-protokoll (PDF) | pdftotext + regex (`parse-voteringar.ts`, `parse-protokoll-ks.ts`) |
| Anföranden (18 079) | Yttrandeprotokoll (PDF) | pdftotext + regex (speaker attribution) |
| Närvaro (8 663 reg.) | KF/KS-protokoll upprop | pdftotext |
| Beslut (3 936 paragrafer) | KF-protokoll (42) + KS-protokoll (51), 2023–2026 | `parse-protokoll.ts`, `parse-protokoll-ks.ts` |
| Budget | Budget-PDF 2026 + delårsrapporter | `parse-budget.ts`, `parse-delarsrapport.ts` |

Exakta, löpande uppdaterade tal: `docs/PROGRESS.md`.

## Begränsningar

1. **Rice Index** — Opposition får systematiskt lägre sammanhållning (de är ofta överens om att rösta emot)
2. **Konsensus** — Hög konsensus kan dölja avsaknad av debatt
3. **Debatt-Gini** — Ordförande och gruppledare har naturligt fler anföranden
4. **Närvaro** — Ersättare räknas in, 81 ledamöter + ersättare ger >100%
5. **Beslutskraft** — Bordläggning är ibland en medveten strategi, inte ineffektivitet

## API

```bash
curl localhost:3000/v1/goteborg/metrics
```

Returnerar samtliga metrics i JSON-format.
