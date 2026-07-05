# Hosting — jämförelse

> Detta dokument gäller endast **backend** (`packages/api`, Hono + Postgres, den enda delen som behöver en riktig server). `packages/web` (Astro) bygger statiska filer — de behöver ingen Node-process, bara nånstans att ligga (CDN/static host). Nuvarande `Dockerfile`/`docker-compose.yml`/`ci.yml` bygger och deployar bara API+Postgres; var Astro-bygget ska publiceras är fortfarande olöst (se `docs/SAAS.md`s arkitekturskiss: Cloudflare framför Astro, separat från API-lagret — sannolikt gratis/billig static-host, inte samma server som API:et).

## Krav

- **Docker Engine + Docker Compose v2** — hela deployen är `docker compose up -d --build`, inget annat funkar
- **Root/SSH-access** — CI:t deployar via `appleboy/ssh-action`
- **Persistent volume** för Postgres-data, överlever omstart/uppdatering
- 2 vCPU / 4 GB RAM / 40 GB SSD räcker — hela datapipelinen (scraping, PDF-parsing/Docling, Playwright) körs i GitHub Actions, **inte** på produktionsservern. Servern kör bara API + Postgres på nuvarande datamängd (tusentals rader, inte miljoner). 4 vCPU/8 GB blir relevant först om en lokal embedding-modell för pgvector-sök (planerad, ej påbörjad) senare läggs på samma box.
- EU-baserat (GDPR, matchar projektets "Suveränt"-princip)

## Viktig upptäckt: build-steget, inte trafiken, är flaskhalsen

Första året blir trafiken låg (utveckling + uppstart) — det är **inte** anledningen att välja mer RAM. Den faktiska risken: `docker compose up -d --build` kompilerar hela pnpm-monorepot (install + TS-build) **på servern** vid varje deploy. Det är en tung engångsprocess per deploy, oberoende av hur många besökare sajten har, och kan OOM:a eller hänga på en liten box (t.ex. 1 vCore/2 GB).

**Rekommenderad fix (ej implementerad än):** bygg Docker-imagen i GitHub Actions (redan gott om resurser där) och pusha till GitHub Container Registry (gratis), så servern bara gör `docker pull && docker compose up -d` — ingen kompilering lokalt, deploy på sekunder istället för minuter. Med den fixen på plats duger även de billigaste VPS-alternativen (se STRATO nedan). Utan den bör man ha minst 4 GB RAM/flera kärnor för att builds inte ska vara ett lotteri.

## Varför inte vanligt webhotell (delat/managed hosting)?

Utvärderat och avfärdat, oavsett leverantör — det är en annan produktkategori:

- **Hetzner Webhosting S:** inget Node.js (bara PHP/CGI), inget SSH, inget Docker på S-nivån. Postgres finns förvånansvärt nog med, men det räddar inget när resten saknas.
- **Simply.com:** SSH och Node.js finns först från Pro-nivå — men priset är introduktion: 9.95 kr/mån år 1, sen **269.95 kr/mån** (~€24) vid förnyelse, dyrare än en riktig VPS. Docker nämns inte alls i produktbladet.
- **Mönster:** delat/managed webhotell (oavsett leverantör) är byggt kring PHP-FPM + cron + databas via kontrollpanel, för landningssidor/WordPress. SSH/Node.js låses bakom de dyraste nivåerna, Docker saknas i princip alltid. Vår stack (Docker Compose, långlivad Node-process, SSH-deploy) kräver kategorin **Cloud VPS/dedikerad**, inte webhotell — oavsett pris är det fel produkt.

## Sammanfattning — VPS-alternativ

| Leverantör | Land | Pris/mån | Spec | Notering |
|---|---|---|---|---|
| **Hetzner CX23** | 🇩🇪/🇫🇮 | ~€5-5.5 (verifiera i konsolen, se not) | 2 vCPU, 4 GB, 40 GB | Rekommendation. Helsinki=EU. CX22 hette detta innan namnbyte 2026-06-15 |
| **STRATO VPS M** | 🇩🇪 | 90 kr (~€7.9) | 4 vCPU, 4 GB, 120 GB | Docker-ready, root/SSH, KVM. Fler kärnor än CX23 för lite mer pengar |
| **STRATO VPS XS/S** | 🇩🇪 | 20-30 kr (~€1.75-2.6) | 1-2 vCPU, **2 GB**, 60-90 GB | Billigast av allt testat — men bara säkert med build-i-CI-fixen ovan (se risk) |
| **Scaleway** | 🇫🇷/🇳🇱 | ~100 SEK (€9.34) | 3 vCPU, 4 GB, 40 GB | EU, bra API |
| **GleSYS** | 🇸🇪 | ~300-1000 SEK | 2 vCPU, 4 GB, 40 GB | Helt svenskt, komponent-prissättning |
| **Bahnhof** | 🇸🇪 | ~1195 SEK | Dedicerad | Integritetsfokus, dyrt |
| **City Network / Cleura** | 🇸🇪 | Enterprise-prissättning | Offert | Offentlig sektor, OpenStack |
| **Väns hemma-NAS** | — | Ofta gratis/marginalkostnad | Varierar | Se checklista nedan — funkar tekniskt, sämre redundans |

## Detaljer

### Hetzner (rekommendation för MVP)
- **Pris:** CX23 (2 vCPU/4 GB/40 GB) ≈ €5-5.5/mån, CX33 (4 vCPU/8 GB/80 GB) ≈ €6.5-7/mån — Hetzners prissida renderas via JS och går inte att skrapa tillförlitligt, verifiera i konsolen innan beställning
- **Datacenter:** Falkenstein (DE), Helsinki (FI)
- **Fördelar:** Extrem prisprestanda, Docker-stöd, bra API, stora community, enkel live-resize (par minuters omstart, ingen datamigrering) om behov växer
- **Nackdelar:** Inte svenskt. Tyskt/finskt bolag.
- **GDPR:** Ja (EU-baserat, uppfyller alla krav)

### STRATO (utvärderad 2026-07-03, seriöst alternativ)
- **VPS M** (4 vCPU/4 GB/120 GB, 90 kr/mån) matchar kravspecen med marginal, jämförbar med Hetzner men fler kärnor för lite mer pengar
- **VPS XS/S** (2 GB RAM, 20-30 kr/mån) — tekniskt Docker-ready/root/SSH/KVM, men 2 GB är i underkant för själva *build*-steget (se ovan), inte för runtime. Bra val **om** build flyttas till CI först
- KVM-virtualisering, root, Docker "färdig", Ubuntu/Debian/Rocky/Alma, obegränsad trafik, upp till 1000 Mbps
- Priserna i tabellen är redan de löpande (inget "år 1"-fälla likt Simply.com) — enda haken är 100 kr engångs-installationsavgift

### Scaleway (alternativ EU)
- **Pris:** DEV1-M = €9.34/mån (3 vCPU, 4 GB, 40 GB)
- **Datacenter:** Paris (FR), Amsterdam (NL)
- **Fördelar:** Bra API, managed PostgreSQL tillgängligt, EU
- **Nackdelar:** Inte svenskt. Franskt bolag.

### GleSYS (svenskt alternativ)
- **Pris:** Komponentbaserat: ~90 SEK/vCPU + ~41 SEK/GB RAM + ~16 SEK/GB disk
  - 2 vCPU + 4 GB + 40 GB ≈ 300-1000 SEK/mån (beroende på config)
- **Datacenter:** Falkenberg, Stockholm
- **Fördelar:** Svenskt familjeföretag sedan 1999, managed PostgreSQL, bra support
- **Nackdelar:** 5-20x dyrare än Hetzner

### Bahnhof (integritet)
- **Pris:** VPS från ~1195 SEK/mån (kampanjpris)
- **Datacenter:** Stockholm (Pionen — atomskydd)
- **Fördelar:** Starkast integritetsskydd i Sverige, vägrar lämna ut data
- **Nackdelar:** Dyrt, mer fokus på dedikerade servrar än cloud

### City Network / Cleura (enterprise)
- **Pris:** Offert krävs (enterprise-tier)
- **Datacenter:** Karlskrona
- **Fördelar:** OpenStack, används av myndigheter, hög compliance
- **Nackdelar:** Inte för startups/MVP, komplex prissättning

### Väns hemma-NAS (utvärderad 2026-07-03)
Tekniskt fullt möjligt — samma krav som ovan (Docker Compose, SSH, persistent volume, 2 vCPU/4 GB-klass). Innan man bestämmer sig, fråga vännen om:
- Alltid påslagen (UPS vid strömavbrott, auto-omstart efter router-/ISP-nedtid)?
- Statisk IP eller DDNS — annars tappar domänen kopplingen vid IP-byte
- Upp-/nedströmshastighet — hemmauplink är oftast smalare än datacenter, blir flaskhals för publikt API
- Tillåter ISP-avtalet att köra en server på ett hemmaabonnemang (vissa operatörer förbjuder det explicit)

Fungerar bra för test/lågtrafik, men enda felkälla är hans hem, hans nät, hans el — sämre redundans än en riktig VPS. Rimligt för nuvarande fas, värt att ha i åtanke som avvägning inför skarp lansering.

## Rekommendation

**Fas 1 (MVP, nu):** Hetzner CX23 (2 vCPU/4 GB) om ni vill slippa tänka på det, **eller** STRATO VPS M om ni redan pratar med STRATO-kontakten — båda klarar kravspecen utan vidare åtgärd. Vill ni pressa kostnaden till STRATO XS/S-nivå (20-30 kr/mån), gör build-i-CI-fixen ovan först.

**Fas 2 (public launch):** GleSYS Falkenberg — "helt svenskt" narrativ viktig för civic tech.

**Fas 3 (SaaS/enterprise):** Eventuellt City Network om kommuner blir kunder (compliance-krav).

**Öppen fråga, oavsett fas:** var Astro-statikens build ska publiceras (se anmärkning överst) — inte bråttom, men olöst.

---

*Senast uppdaterad: 2026-07-03 (STRATO + webhotell-utvärdering, build-i-CI-fyndet, Astro/Hono-uppdelning förtydligad)*
