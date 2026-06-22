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

### Debattdjup (Debate Depth)
- **Formel:** `totalt_antal_anföranden / antal_voteringsärenden`
- **Tolkning:** Fler anföranden per ärende = djupare deliberation
- **Källa:** Steenbergen, M.R. et al. (2003). *Measuring Political Deliberation.* Comparative European Politics, 1(1).

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
| Voteringar (17 210 röster) | KF-protokoll (PDF) | pdftotext + regex |
| Anföranden (16 476) | Yttrandeprotokoll + whisper.cpp | Speaker attribution |
| Närvaro (3 243 reg.) | KF-protokoll upprop | pdftotext |
| Beslut (1 731 ärenden) | KF-protokoll 2023–2026 | parse-protokoll.ts |
| Budget | Budget-PDF 2026 | parse-budget.ts |

## Begränsningar

1. **Rice Index** — Opposition får systematiskt lägre sammanhållning (de är ofta överens om att rösta emot)
2. **Konsensus** — Hög konsensus kan dölja avsaknad av debatt
3. **Debatt-Gini** — Ordförande och gruppledare har naturligt fler anföranden
4. **Närvaro** — Ersättare räknas in, 81 ledamöter + ersättare ger >100%
5. **Beslutskraft** — Bordläggning är ibland en medveten strategi, inte ineffektivitet

## API

```bash
curl localhost:3000/api/v1/goteborg/metrics
```

Returnerar samtliga metrics i JSON-format.
