# Hosting — jämförelse

> Detta dokument gäller **backend** (`packages/api`, Hono + Postgres — den enda delen som behöver en riktig server). `packages/web` (Astro) bygger statiska filer och publiceras separat via GitHub Pages, se "Statisk sajt" nedan.

## Status: LIVE ✅ (2026-07-08)

| Vad | Var | Status |
|---|---|---|
| API + Postgres + Caddy | Hetzner CX23, Helsinki (FI), IP `62.238.20.174` | ✅ `https://api.dearbetarfordig.se` — verkligt Let's Encrypt-cert, `/healthz` → `200 {"status":"ok","db":"connected"}` |
| Databas | Samma server, seedad | 971 politiker, 23 429 grafnoder, 122 504 grafkanter |
| Statisk sajt (Astro) | GitHub Pages | ✅ `https://dearbetarfordig.se` — eget cert (`approved`, giltigt t.o.m. 2026-10-06), `www.` redirectar till apex |
| Repository | GitHub, `DeArbetarForDig/dearbetarfordig.se` | ✅ Publikt (AGPL-3.0, "public money, public code") |
| CI/CD | `.github/workflows/ci.yml` | ✅ Grönt — `lint`, `test`, `build-and-push` (GHCR), `deploy-pages` (GitHub Pages), alla auto på push till `main` |
| Manuell serverdeploy | `.github/workflows/deploy.yml` | Konfigurerad (`workflow_dispatch` + `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`-secrets), ännu inte kört skarpt en gång |

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

**Klart (server provisionerad 2026-07-07/08 — Hetzner CX23, Helsinki, `62.238.20.174`):**
1. ✅ **GHCR-paketets synlighet:** `ghcr.io/dearbetarfordig/dearbetarfordig.se` är publikt — `docker compose pull` funkar utan login på servern.
2. ✅ **Två separata SSH-nycklar, olika riktning** (lätt att blanda ihop, så här skiljer de sig):
   - `id_ed25519_daf_deploy` — GitHub Actions → server. Privat halva i secret `DEPLOY_SSH_KEY`, publik i serverns `authorized_keys` med `command="eval \"$SSH_ORIGINAL_COMMAND\"",no-pty,no-X11-forwarding,no-agent-forwarding,no-port-forwarding` (tillåter `deploy.yml`s multi-steg `&&`-kommandon men blockerar interaktiv shell/port-forwarding om nyckeln läcker).
   - `id_ed25519_daf_github_deploykey` — server → GitHub (för `git pull` av privat/publik repo). Privat halva bara på servern (`~/.ssh/github_deploy_key` + `~/.ssh/config`), publik som read-only Deploy key i GitHub-inställningarna.
3. ✅ **Brandvägg (`ufw`):** aktiv, endast 22/80/443 (v4+v6). **Fallgrop:** cloud-init körde `runcmd` (ufw+SSH-hårdning) aldrig automatiskt vid första boot — fastnade i en oändlig retry-loop mot Hetzners metadata-endpoint (`169.254.169.254`, "Network is unreachable"). Löst genom att köra samma kommandon manuellt via SSH, med verifiering (ny anslutning) efter varje steg innan nästa. Värt att dubbelkolla `cloud-init status --long` manuellt på framtida servrar istället för att lita blint på att `runcmd` körts.
4. ✅ **SSH-hårdning:** `PasswordAuthentication no`, bara nyckel.
5. ✅ **DNS:** `api.dearbetarfordig.se` → serverns IP via LoopiaDNS (10 SEK/mån-uppgradering, krävdes för att DNS-editorn skulle låsas upp).
6. ⚠️ **Rotera GitHub-token:** fortfarande inte bekräftat gjort — samma PAT i klartext i lokal `git remote -v` som flaggades tidigare. Kvarstår.
7. ⬜ **Backup** (pg_dump → Storage Box/restic) — inte påbörjat.

## Statisk sajt (`packages/web`, Astro) — GitHub Pages

Löst 2026-07-08, se `Status`-tabellen ovan för slutresultat.

- **`ci.yml`s `deploy-pages`-jobb** bygger och publicerar på varje push till `main`. Kräver *exakt* samma uppstartssekvens som `test`-jobbet (Postgres-service + `db:seed` + starta API + vänta på `/healthz`) — upptäckt av en riktig lokal `astro build`-krasch: `getStaticPaths` i `[id].astro`-sidor gör `fetch()` mot en **levande** API-server vid byggtiden (`packages/web/src/data/api.ts`, default `http://localhost:3000`), inte bara mot statiska data-filer.
- **`packages/web/public/CNAME`** (innehåll: `dearbetarfordig.se`) — kopieras till `dist/CNAME` av Astro, men **gör ingenting automatiskt** när Pages byggs via `build_type: "workflow"` (GitHub Actions). Det automatiska CNAME-igenkänningen gäller bara legacy-metoden "Deploy from a branch". Custom domain måste sättas explicit i Settings → Pages → Custom domain (eller via `PUT /repos/{owner}/{repo}/pages`-API, som dock kräver högre repo-rättigheter än en vanlig `repo`-scope PAT från ett collaborator-konto gav — fick göras via UI).
- **Privat repo blockerar Pages helt** ("Upgrade or make this repository public to enable Pages") — inte bara en begränsning, en hård spärr på gratisplan för org-repos. Löstes av att göra repot publikt (se nedan), inte av att betala för GitHub Team.
- **`bad_authz`-fallgrop:** om custom domain sätts *innan* DNS hunnit peka rätt (A-poster mot GitHub: `185.199.108/109/110/111.153`), fastnar ACME-auktoriseringen i `bad_authz` och läker inte av sig själv ("We need to start over"). Fix: rensa Custom domain-fältet, spara, vänta ~15 sek, fyll i domänen igen — startar om cert-utfärdandet mot nu-korrekt DNS.
- **`www`-subdomän:** CNAME mot `dearbetarfordig.github.io.` (inte A-poster) — redirectar till apex.

## Repository-synlighet: publikt (2026-07-08)

Motivering: AGPL-3.0-licensen och projektets "public money, public code"-hållning gjorde publikt repo till en naturlig, inte påtvingad, förändring — och det var samtidigt enda gratisvägen att låsa upp GitHub Pages och Rulesets (båda kräver antingen publikt repo eller betald GitHub Team-plan för org-repos).

- **`docs/ANALYS-2026-07.md` borttagen ur *hela* git-historiken** (inte bara nuvarande state) innan publicering — filen var skriven på ryska, projektets övriga dokumentation/kod är på svenska/engelska. Gjort med `git filter-repo --path docs/ANALYS-2026-07.md --invert-paths --force` på en färsk klon (inte arbetskopian), verifierat med blob-sökning över hela historiken (0 träffar) innan force push. Lokal kopia sparad i `.tmp/` (gitignorad).
- Ett enda commit-meddelande innehöll ett ryskt ord (`typecheck-долг`) — fixat separat med `git filter-repo --message-callback` → `typecheck-debt`.
- **Konsekvens av båda filter-repo-körningarna:** alla 303 commit-hashar skrevs om (oundvikligt — filter-repo skriver om varje commit som är barn av en ändrad commit). Fullständig mirror-backup av historiken innan varje omskrivning sparades lokalt, ifall något behöver hämtas därifrån.
- **Rulesets** (`main`-branch, Settings → Rules): kräver PR + `lint`/`test`-status-checks, linjär historik (squash/rebase only, ingen merge-commit), blockerar force push/deletions. Repository-admin på bypass-listan för att inte blockera egna direkta pushar. **Observera:** rulesets på org-repo tillämpas inte alls förrän repot är publikt (eller kontot uppgraderas till Team) — samma spärr som Pages.

## Rekommendation

**Fas 1 (MVP) — genomförd 2026-07-07/08:** Hetzner CX23 (Helsinki) kom tillbaka i lager och användes, se `Status`-tabellen överst. one.com/STRATO kvarstår som dokumenterade alternativ om Hetzner tar slut igen, men är inte längre aktuella att agera på.

**Fas 2 (public launch):** GleSYS Falkenberg — "helt svenskt" narrativ viktig för civic tech. Fortfarande bara en idé, ej påbörjad.

**Fas 3 (SaaS/enterprise):** Eventuellt City Network om kommuner blir kunder (compliance-krav).

---

*Senast uppdaterad: 2026-07-08 (Hetzner-servern live: API+Postgres+Caddy med riktigt Let's Encrypt-cert; Astro-sajten publicerad via GitHub Pages med eget cert; repot publikt med Rulesets; kvarstående punkt: rotera exponerad GitHub-token)*
