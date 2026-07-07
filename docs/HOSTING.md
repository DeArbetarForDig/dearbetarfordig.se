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

**✅ Implementerad 2026-07-07:** `ci.yml` bygger nu Docker-imagen i GitHub Actions och pushar till GHCR (`ghcr.io/dearbetarfordig/dearbetarfordig.se`); deploy-steget gör bara `docker compose pull && docker compose up -d` — ingen kompilering på servern längre, deploy på sekunder istället för minuter. Med den fixen på plats duger även de billigaste VPS-alternativen (se STRATO nedan).

## Varför inte vanligt webhotell (delat/managed hosting)?

Utvärderat och avfärdat, oavsett leverantör — det är en annan produktkategori:

- **Hetzner Webhosting S:** inget Node.js (bara PHP/CGI), inget SSH, inget Docker på S-nivån. Postgres finns förvånansvärt nog med, men det räddar inget när resten saknas.
- **Simply.com:** SSH och Node.js finns först från Pro-nivå — men priset är introduktion: 9.95 kr/mån år 1, sen **269.95 kr/mån** (~€24) vid förnyelse, dyrare än en riktig VPS. Docker nämns inte alls i produktbladet.
- **Mönster:** delat/managed webhotell (oavsett leverantör) är byggt kring PHP-FPM + cron + databas via kontrollpanel, för landningssidor/WordPress. SSH/Node.js låses bakom de dyraste nivåerna, Docker saknas i princip alltid. Vår stack (Docker Compose, långlivad Node-process, SSH-deploy) kräver kategorin **Cloud VPS/dedikerad**, inte webhotell — oavsett pris är det fel produkt.

## Sammanfattning — VPS-alternativ

| Leverantör | Land | Pris/mån | Spec | Notering |
|---|---|---|---|---|
| **Hetzner CX23** | 🇩🇪/🇫🇮 | ~€5-5.5 (verifiera i konsolen, se not) | 2 vCPU, 4 GB, 40 GB | ⚠️ **Slut i lager sedan 2026-06-26** (aktiv Hetzner-incident, hårdvarubrist, inget ETA — såg ~17 mån vid förra liknande incidenten). Helsinki=EU. CX22 hette detta innan namnbyte 2026-06-15 |
| **one.com Cloud Server S** | 🇩🇰 | 59 kr (~€5.2), 29 kr första mån | 2 vCPU, 4 GB, **100 GB NVMe** | **Ny rekommendation 2026-07-07** — root från start, valfri Linux-distro, SSH direkt, Plesk valfritt (ej tvingande). I lager, kringgår Hetzner-bristen helt. Mer disk än Hetzner för samma pris |
| **STRATO VPS M** | 🇩🇪 | 90 kr (~€7.9) | 4 vCPU, 4 GB, 120 GB | Docker-ready, root/SSH, KVM. Fler kärnor än CX23/one.com för lite mer pengar |
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

### one.com (utvärderad 2026-07-07, ny rekommendation p.g.a. Hetzner-brist)
- **Cloud Server S** (2 vCPU/4 GB/100 GB NVMe, 59 kr/mån, 29 kr första månaden) — samma CPU/RAM som Hetzner CX23 men 2,5x disk för samma/lägre pris
- Bekräftat: root-access från start, val av Ubuntu/Debian/AlmaLinux/CentOS, SSH-nyckel direkt, Plesk är tillval — inte det låsta mönster som webhotell-kategorin har (se ovan)
- Danskt bolag (inte "helt svenskt" som GleSYS, men EU/Norden — matchar GDPR-kravet)
- Öppen fråga: exakt datacenterort ej bekräftad från prissidan (sannolikt Danmark/EU)

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

## Säkerhet & deploy — vad som är fixat och vad som återstår

Genomgång 2026-07-07 hittade att `docker-compose.yml` exponerade Postgres (5432) och API:et (3000) direkt mot internet. Kodfixat samma dag:

- ✅ `db`/`api` publicerar inga host-portar längre (`expose` istället för `ports`) — enda internetvända tjänsten är Caddy på 80/443
- ✅ Ny `caddy`-tjänst i `docker-compose.yml` + `Caddyfile` (reverse proxy till `api`, automatisk HTTPS via Let's Encrypt)
- ✅ `POSTGRES_PASSWORD` flyttat till `.env` (redan gitignorat) via `.env.example`-mall — inget lösenord hårdkodat i repo
- ✅ Build-i-CI/GHCR-fixen (se ovan) — servern kör aldrig `pnpm install` längre. `ci.yml` splittat: `build-and-push` (automatisk, bygger+publicerar imagen) vs `deploy.yml` (`workflow_dispatch` — endast manuellt, väljer image-tag för ev. rollback). Krävde ett extra fix: `docker/setup-buildx-action` saknades, standard-buildx-drivern på GitHub-runners stödjer inte `cache-to: type=gha` alls. **Bekräftat grönt i CI 2026-07-08** (run #200) — inte bara antaget.
- ✅ **`Dockerfile` var trasig — upptäckt av en riktig container-smoke-test, inte bara läst kod:** `CMD` körde `tsx` från `/app`, men pnpm ger varje workspace-paket sin egen `node_modules` (ingen hoisting till root) — `tsx` (devDependency enbart i `@daf/api`) gick aldrig att resolva därifrån, containern crash-loopade på `ERR_MODULE_NOT_FOUND`. Provade också en `tsup`-bundlad prod-build (redan definierad som `pnpm --filter @daf/api build`/`start`-script) men den bryter alla `import.meta.dirname`-relativa sökvägar till `data/` (allt kod hamnar i en enda fil på annat djup) — övergiven till förmån för `WORKDIR /app/packages/api` + samma `tsx`-väg som redan är validerad i `ci.yml`s testjobb. Verifierat end-to-end: `docker compose up` → `db` healthy → `api` ansluter → `/healthz` → `200 {"status":"ok","db":"connected"}`.
- ⚠️ **Fallgrop hittad under samma test:** Postgres sätter bara `POSTGRES_PASSWORD` vid **första** starten på en tom volym — byter man lösenord i `.env` efter att `pgdata`-volymen redan finns ändras inget, `api` får `password authentication failed`. Vid en verklig lösenordsrotation: antingen döp om/nollställ volymen (dataförlust) eller kör `ALTER USER daf WITH PASSWORD '...'` inne i den körande `db`-containern.
- ⚠️ **Generera lösenordet med `openssl rand -hex 32`, inte `-base64`:** base64 kan innehålla `/` och `+`, vilket korrumperar `postgresql://`-URL:en lösenordet klistras in i rått (ingen URL-encoding sker). Redan uppdaterat i `.env.example`.

**Kvarstår — manuella steg på servern, kan inte göras från kodrepot:**
1. **GHCR-paketets synlighet:** gör `ghcr.io/dearbetarfordig/dearbetarfordig.se` publikt (Package settings på GitHub) så `docker compose pull` funkar utan extra login på servern — rimligt val för ett AGPL-projekt. Annars: `docker login ghcr.io` på servern med ett PAT som har `read:packages`.
2. **Dedikerad deploy-SSH-nyckel:** separat nyckel enbart för CI, gärna begränsad via `command=` i `authorized_keys` eller en egen `deploy`-användare utan full sudo — inte samma nyckel som används för annat.
3. **Brandvägg (`ufw`):** endast 22 (SSH), 80, 443 öppna. `ufw default deny incoming && ufw allow 22,80,443/tcp && ufw enable`.
4. **SSH-hårdning:** stäng av lösenordsinloggning (`PasswordAuthentication no` i `sshd_config`), bara nyckel.
5. **DNS:** peka `api.dearbetarfordig.se` mot serverns IP innan Caddy kan hämta ett certifikat.
6. **Rotera GitHub-token:** `git remote -v` lokalt visade en PAT i klartext i remote-URL:en — byt ut mot SSH-remote eller en credential helper, och återkalla den gamla token i GitHub-inställningarna.
7. **Backup** (pg_dump → Storage Box/restic, planerat i Fas 1 nedan) — inte påbörjat än.

**Öppen fråga, oavsett server:** var Astro-statiken (`packages/web`) ska publiceras — `Caddyfile` hanterar bara `api.`-subdomänen just nu, se anmärkning överst i dokumentet.

## Rekommendation

**Fas 1 (MVP, nu):** one.com Cloud Server S (2 vCPU/4 GB/100 GB, 59 kr/mån) — Hetzner CX23 är samma spec men **slut i lager utan ETA** sedan 2026-06-26, se tabellen. STRATO VPS M kvarstår som alternativ om ni redan pratar med STRATO-kontakten och vill ha fler kärnor.

**Fas 2 (public launch):** GleSYS Falkenberg — "helt svenskt" narrativ viktig för civic tech.

**Fas 3 (SaaS/enterprise):** Eventuellt City Network om kommuner blir kunder (compliance-krav).

**Öppen fråga, oavsett fas:** var Astro-statikens build ska publiceras (se anmärkning överst) — inte bråttom, men olöst.

---

*Senast uppdaterad: 2026-07-07 (Hetzner CX23 slut i lager → one.com ny rekommendation; docker-compose/Caddy-säkerhetsfix + GHCR-build implementerade; deploy-checklista tillagd)*
