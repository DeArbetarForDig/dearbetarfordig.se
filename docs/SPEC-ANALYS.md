# Analyslager — specifikation

Protokolldata svarar på *vad* som hände. Analyslagret ska svara på *hur beslutet
kom till* och *vad det kostar* — utan att blanda ihop det med *om beslutet var
bra*, som är en bedömning och måste märkas som en.

Fyra lager, sorterade efter hur kontrollerbara de är. De slås aldrig ihop till
ett samlat betyg: hela poängen är att visa var säkerheten är hög och var den
inte är det.

| Lager | Källa | Metod | Status |
|-------|-------|-------|--------|
| 1. Process | KF/KS-protokoll | deterministisk härledning | ✅ `generate-analys.ts` |
| 2. Underlag + ekonomi | handlingar (tjänsteutlåtanden) | regex + citat | ✅ samma steg, begränsad täckning |
| 3. Prognos | subagent + webbsökning | LLM, ex ante | ✅ `.claude/agents/beslutsanalytiker.md` — ogranskade tills `granskad_av` fylls i |
| 4. Utfall | delårsrapport / årsredovisning | matchning mot ärendenummer | 🔜 |

## Analysenheten är ärendet, inte paragrafen

786 av 1352 ärenden behandlas i flera paragrafer — samma motion kan ligga
bordlagd 17 gånger innan den avgörs. Analys per § skulle producera 3936 poster
där de flesta bara betyder "bordlagd igen". Analys per ärendenummer (SLK-…)
ger 1352 poster, varav 917 analyserbara, och gör bordläggningskedjan till
information i sig: `bordlagd_antal` och `handläggningsdagar`.

Kedjan följer ärendet över organgränsen — ett ärende som passerar KS och sedan
avgörs i KF blir en post, inte två.

## Inget tomt utan skäl

Varje ärende får en post. Ärenden utan analys bär `skäl`:

- `procedurell` (112) — justering, upprop, val, anmälningsärenden
- `utan_beslutskaraktär` (151) — interpellationer och frågor: debatt, men inget beslut och därmed ingen utfallssida
- `ej_avgjord` (172) — ännu bara bordlagt

Samma princip gäller `utfall: null` — "väntar på data", aldrig tyst tomt.

Underlagsflaggorna är trelägda: `true` / `false` / `null`. `null` betyder att
handlingens text inte är hämtad, alltså att vi inte vet. Utan den skillnaden
blir 471 luckor i vår egen pipeline till påståendet "beslutet saknar
konsekvensanalys" — vilket vore ett fel av samma slag som platformen finns för
att motverka.

## Prognoslagret (steg 3) — villkor innan det får byggas

1. **Aldrig i grafen.** `data/analys/` är skilt från `data/graf/`. Allt i grafen
   är parsade fakta och `/v1/goteborg/graf/node/…` får aldrig returnera en
   maskinbedömning som en kant i protokollet.
2. **Idempotens.** `källa_hash` (sha1 över protokoll- + handlingstext) finns
   redan i varje post. Oförändrad hash ⇒ ingen ny modellkörning. Detta är det
   enda som *måste* ligga på plats i förväg — resten går att lägga till senare.
3. **Minst ett jämförelsefall med källa**, annars publiceras inte prognosen.
4. **Jämförelsefallet måste vara jämförbart — inte bara ha en URL.** Varje fall
   ska ange vad det delar med ärendet och var det skiljer sig. Är det en annan
   typ av åtgärd är det bakgrund, inte ett jämförelsefall, och räknas inte mot
   kravet i punkt 3. Belopp om ärendet måste komma från ärendets egen handling —
   aldrig från jämförelsefallet.
5. **Motstående belägg söks aktivt.** Är `talar_emot` icke-tom kan `confidence`
   inte vara högre än `medium`.
6. **Mänsklig granskning innan publicering** — `granskad_av` + `granskad_datum`
   i posten, publiceringsfiltret är att fälten är ifyllda. Gäller bara steg 3.
7. **Ingen partitillhörighet in i prompten** — och inga partinamn eller
   blocketiketter ("högern", "det rödgröna styret") i utdatan heller. Ett
   argument återges på sitt sakinnehåll, aldrig med avsändaren som etikett.
   Inga tjänstemän eller enskilda invånare namnges; politiker bara i sin
   offentliga roll.

Punkt 4 och 7 kommer ur testkörningen 2026-07-28 (5 ärenden, Haiku): modellen
hittade riktiga källor men bytte ut åtgärden — ett ärende om *frysta*
biljettpriser bedömdes med statens *halvering* av månadskort som jämförelse,
och statens 6,5 miljarder hamnade i storleksfältet trots att de inte rör
stadens beslut. Samma körning återgav en invändning som "högerns kritik" i
stället för att säga vad invändningen gick ut på.

Kalibreringsloggen behöver ingen egen tabell: den är en härledd vy över
`rekommendation`/`riktning` + utfallslagret, grupperat på riktning.
Ärendenumret är stabil nyckel.

## Vilka ärenden som går till modellen

`prognos_kandidat` sätts redan i steg 1 och är skild från `analyserbar`: ett
rutinärende får full process- och ekonomianalys (en årsredovisning som klubbas
med votering är intressant), men ingen modellkörning — en prognos om dess
framtida konsekvenser har inget att ta spjärn mot.

Ett ärende hamnar i kön om handlingen är hämtad och det finns något att
prognostisera mot: erkänt osäker finansiering, belopp ≥ 10 mnkr eller ett
omstritt beslut. Av 917 analyserbara ärenden ger det 333 — och 455 av de
bortsorterade faller bara på att handlingens text inte är nedladdad, vilket
`fetch-handlingar-text.ts` åtgärdar.

## Neutralitetskontroll

Steg 1–2 är partiblinda av konstruktion — de räknar och citerar. Kontrollen är
ändå mätbar: körningen skriver ut flaggfördelning per initiativparti för
motioner och interpellationer. Slår en flagga systematiskt mot ett block är det
antingen verkligt eller en parserbias, och båda ska synas i stället för att
gömmas i ett totalvärde.

## AI-analysen (steg 3) — agentisk, inte en pipeline-passage

Analysen körs av en subagent på utvecklarens Claude-abonnemang, inte mot ett
API med metertaxa. Det styr arkitekturen: subagenten söker själv i materialet
via ett CLI (`packages/pipeline/src/analys/korpus.ts`), skriver en JSON-fil per
ärende, och filerna committas som vilken datafil som helst. CI seedar dem till
databasen och deployen plockar upp dem — samma väg som protokoll och budget.

Rollen ligger i `.claude/agents/beslutsanalytiker.md`. Verktygen:

| Verktyg | Vad det når |
|---|---|
| `korpus.ts sok` | 46 700 poster: protokoll, tjänsteutlåtanden, ordagranna anföranden, budget, utfall per nämnd, leverantörsutfall, revisionsrapporter, bolagsengagemang, inkomna handlingar |
| `korpus.ts hamta` | En post i sin helhet plus alla grafkopplingar, åt båda håll |
| `korpus.ts arende` | Hela handläggningskedjan för ett SLK-nummer + steg 1-analysen |
| `korpus.ts ko` / `logg` | Kön av prognosvärda ärenden utan analys / arbetsloggen |
| WebSearch | Utvärderingar från andra kommuner, forskning, IFAU, SKR, Riksrevisionen |

En fråga om en detaljplan leder till andra källor än en fråga om en
klimatbudget, och den kopplingen går inte att skriva i kod i förväg — därför
verktyg och inte ett fast extraktionssteg.

Utdata: `data/analys/ai/<ärendeNr>.json` — `maskingenererad: true`, modell,
datum, `granskad_av: null`, `källa_hash`, riktning, säkerhet, brödtext och en
källförteckning. Formen valideras blockande i CI mot `AiAnalysSchema`
(`packages/shared`): en subagent som skriver trasig JSON stoppar bygget i
stället för att seedas till produktion.

## Två lager för två läsare

Brödtexten är för den som vill kontrollera analysen. Ovanpå den ligger ett kort
lager för den som ska förstå ett beslut på tjugo sekunder:

| Fält | Innehåll | Gräns |
|---|---|---|
| `sammanfattning` | Vad beslutet innebär | 400 tecken |
| `nyckelpunkter` | 2–4 punkter: `varning`, `styrka` eller `fakta` | 160 tecken |
| `talar_för` / `talar_emot` | 0–4 punkter var, med källa | 180 tecken |
| `beslutskvalitet` | Fem ja/nej-frågor om beredningen | — |
| `rekommendation` | Ståndpunkt + motivering + vad som skulle ändra den | 300 tecken |

**Teckengränserna är hårda i schemat.** "Fatta dig kort" i en prompt ger inte
korta punkter; en maxlängd gör det.

`beslutskvalitet` är fem frågor som ställs likadant till varje ärende — vet vi
vad det kostar, är pengarna utpekade, är konsekvenserna utredda, går resultatet
att mäta, är uppföljning bestämd. `true` bara om man kan peka på var i handlingen
det står. Ingen sammanvägning: ett tal ("6,4 av 10") går varken att kontrollera
eller argumentera emot och döljer var osäkerheten sitter, medan fem kryss visar
precis vad som saknas.

`rekommendation` är modellens ståndpunkt med fullmäktiges egna alternativ —
`bifall`, `avslag`, `avstår`. Att ta ställning är mer granskningsbart än en
poäng: ett "avslag, därför att X" går att motbevisa i sak. `skulle_ändras_av`
gör bedömningen falsifierbar — en bedömning som inte kan motbevisas är en åsikt,
inte en analys.

**Ståndpunkten tas på beredning och rimlighet, aldrig på om politiken är
önskvärd.** Prompten kräver spegeltestet: kan samma motivering inte skrivas om
ett likadant förslag från ett annat håll är den fel skriven. Utan den regeln blir
plattformen en åsiktsmaskin i stället för ett granskningsverktyg.

## I gränssnittet

Egen flik sist på beslutssidan (`AI-analys`), efter protokoll och handling:
fakta möts först, bedömningen sedan. Aldrig inbakad i handlingen — läsaren ska
inte kunna läsa en maskintext i tron att den står i protokollet.

Ordningen i fliken: märkningen (vem skrev, vilken modell, ogranskad), det
viktigaste, beredningsfrågorna, ståndpunkten, för och emot, hela texten hopfälld,
källorna. Renderas med designsystemets komponenter — `Card`, `Callout`,
`StatusBadge`, `Accordion` — där färgen aldrig är enda signalen: varje Callout
har ikon och etikett i klartext.

Källhänvisningarnas paragraf-id länkar till besluten på sajten. Det som saknar
egen sida länkas inte: en granskningsplattform vars källhänvisningar leder till
404 är värre än en som inte länkar.

Märkningen är inte en brasklapp utan förutsättningen. Läsaren ska veta exakt
vad hen läser och kunna gå till källan, och varje påstående ska bära
ärendenummer, nod-id eller URL — då kan en slutsats bestridas i sak och inte på
formen. Det är skillnaden mellan ett granskningsverktyg och en åsiktsmaskin.

**Ett ärende i taget.** Kvoten är ett femtimmarsfönster på ett abonnemang; en
batch som slår i taket lämnar flera halvfärdiga ärenden utan att något blir
klart. Arbetsläget härleds ur filerna på disk och skrivs till
`data/analys/ARBETSLOGG.md` — den är genererad, inte handhållen, så det finns
bara en sanning om vad som är gjort.

Vägen till produktion:

```
subagent → data/analys/ai/<nr>.json → commit → CI (validering + seed → DB-image) → deploy
```

`seed.ts` seedar bara en AI-analys vars `källa_hash` fortfarande matchar
ärendet. Har protokollet eller handlingen ändrats sedan analysen skrevs hör
texten inte längre ihop med sitt underlag, och då ska den inte visas.

## Kör

```bash
pnpm --filter @daf/pipeline generate:analys       # → data/analys/beslut.json
K=packages/pipeline/src/analys/korpus.ts
npx tsx $K ko 1                                   # nästa ärende att analysera
# kör subagenten beslutsanalytiker på det ärendenumret
npx tsx $K logg                                   # → data/analys/ARBETSLOGG.md
```

Täckningen för lager 2 begränsas av hur många handlingar som är nedladdade
(446 av 917). `fetch-handlingar-text.ts` höjer den siffran direkt.
