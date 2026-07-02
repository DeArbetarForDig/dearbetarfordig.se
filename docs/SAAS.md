# SaaS-arkitektur

## Multi-tenant

```
dearbetarfordig.se              → Landing + demo
goteborg.dearbetarfordig.se     → Göteborgs data
malmo.dearbetarfordig.se        → Malmö
[kommun].dearbetarfordig.se     → Alla kommuner
```

Alternativt: kund pekar egen domän via CNAME (t.ex. `insyn.goteborg.se`).

## Systemöversikt

```
┌─────────────────────────────────────────────┐
│            Cloudflare (CDN, SSL, DDoS)       │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│  Astro (static HTML, pre-rendered per page)  │
│  + Pagefind (client-side search)             │
└─────────────────────┬───────────────────────┘
                      │ /api/* proxied
┌─────────────────────▼───────────────────────┐
│  Hono 4 (TypeScript, Node.js 22)             │
│  - Tenant routing via subdomain/header       │
│  - @hono/zod-openapi → OpenAPI 3.1 + Swagger │
│  - Rate limiting (in-memory, anonymous: /h)  │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│  PostgreSQL 16                               │
│  - Schema-per-tenant                         │
│  - Full-text search (swedish)                │
│  - PostGIS (optional, för geo-data)          │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│  Hetzner Object Storage (S3-compatible)      │
│  - PDF:er, bilder, media                     │
└─────────────────────────────────────────────┘
```

## Datapipeline

```
Datakällor (per kommun)          Pipeline                    Lagring
─────────────────────          ──────────                  ────────
Yttrandeprotokoll (PDF)  ─→  pdftotext + regex (talare)  ─→  debatter/
webb-TV (KF-sändning)    ─→  länkverifiering (fetch)      ─→  debatter/
politiker.goteborg.se    ─→  scraper (Cheerio)            ─→  politiker/
nämndhandlingar          ─→  PDF-parser                   ─→  beslut/
budget-PDF               ─→  pdftotext + regex            ─→  budget/
diarium                  ─→  adapter per system            ─→  ärenden/
```

Varje kommun har olika källsystem. Vi bygger **adapters**:

| Diariesystem | Kommuner som använder | Adapter |
|--------------|----------------------|---------|
| Public 360 | Göteborg, Malmö m.fl. | `adapters/public360.py` |
| Ciceron | Stockholm m.fl. | `adapters/ciceron.py` |
| W3D3 | Diverse | `adapters/w3d3.py` |
| Diabas | Mindre kommuner | `adapters/diabas.py` |

## Hosting (EU only)

| Komponent | Leverantör | Pris/mån |
|-----------|-----------|----------|
| VPS | Hetzner Cloud CX22 (start) | ~200 kr |
| PostgreSQL | Managed (Hetzner/Supabase EU) | ~300 kr |
| Object Storage | Hetzner | ~50 kr |
| CDN + DNS | Cloudflare Free | 0 kr |
| CI/CD | GitHub Actions | 0 kr |
| Monitoring | Grafana Cloud free | 0 kr |
| **Total** | | **~550 kr/mån** |

## Pricing

| Tier | Kommunstorlek | Pris/mån |
|------|--------------|----------|
| Pilot | <20k inv | 4 000 kr |
| Standard | 20–100k inv | 12 000 kr |
| Enterprise | 100k+ inv | 25 000 kr |
| Self-hosted | Alla | Engångs + support |

## Juridik

- **Licens:** AGPL-3.0
- **Data:** Offentliga handlingar → ingen GDPR-problematik
- **Varumärke:** Registrera hos PRV
- **AB:** Registreras vid första betalande kund

---

## AI-layer

| Tjänst | Uppgift | Leverantör | Kostnad |
|--------|---------|-----------|---------|
| Anföranden + speaker ID | Yttrandeprotokoll (PDF) → text med talare | Egen parser (pdftotext + regex) | Gratis |
| PDF → strukturerad data | Protokoll → JSON (votering, paragraf, beslut) | Claude API (Haiku) | ~$0.50/protokoll |
| Klassificering | Autotagga ärenden (IT, skola, budget...) | Claude Haiku | ~$0.01/ärende |
| Sammanfattning | Kort summary per beslut/debatt | Claude Haiku | ~$0.05/beslut |
| Semantic search | Embeddings för AI-sök (v0.3+) | OpenAI / Cohere | ~$0.10/1000 dok |

**Årskostnad (Göteborg, ~11 KF-möten + ~50 nämndprotokoll):** ~$30/år ≈ 330 kr/år (lägre än tidigare estimat tack vare gratis Yttrandeprotokoll-parsning istället för betald transkription)

---

## Finansieringsmodell

### Fas 1: Civic tech + donationer (2026)

| Kanal | Vad | Förväntad intäkt |
|-------|-----|-----------------|
| **GitHub Sponsors** | Recurring donations från devs/civic tech-community | 500–2000 kr/mån |
| **Ko-fi / Buy Me a Coffee** | Engångsdonationer från medborgare | Sporadiskt |
| **Open Collective** | Transparent collective (visar alla in/ut-flöden) | Legitimitet + donations |
| **Swish-donation** | Enkelt för svenska användare | Direkt |

**Mål fas 1:** Täcka driftkostnader (~600 kr/mån) + AI-kostnader (~50 kr/mån).  
**Behov:** ~650 kr/mån = ~8 000 kr/år. Realistiskt via 20-30 sponsorer à 30 kr/mån.

### Fas 2: Grants + innovation funding (2027)

| Källa | Vad | Belopp |
|-------|-----|--------|
| **Vinnova** | Civic tech / demokratiinnovation | 500k–2M kr |
| **DIGG** | Öppna data-initiativ | 200k–500k kr |
| **EU Digital Europe Programme** | Open source + democratic participation | €50k–200k |
| **Allmänna Arvsfonden** | Demokratistärkande projekt | 500k–3M kr |
| **Postkodstiftelsen** | Samhällsnytta | 500k–2M kr |

### Fas 3: SaaS-intäkter (2027+)

Kommuner betalar för hosting + support + adapters.  
Se pricing-tabell ovan.

### Fas 4: Premium-features (framtid)

- Bevakningar via e-post/push (gratis: 3 bevakningar, premium: obegränsat)
- API high-rate access (för media/forskare med stora behov)
- White-label (kommun hostar under eget varumärke)

### Princip: Grunddata alltid gratis

All offentlig data = gratis, öppet, utan login. Alltid.  
Vi tar ALDRIG betalt av medborgare för att se beslut.  
Intäkter = kommuner (SaaS) + donationer + grants + premium-verktyg.
