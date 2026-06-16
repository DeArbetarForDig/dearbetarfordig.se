# Hosting — jämförelse

> Krav: 2+ vCPU, 4+ GB RAM, 40+ GB SSD, Docker, EU/Sverige

## Sammanfattning

| Leverantör | Land | Pris/mån | Spec | Notering |
|---|---|---|---|---|
| **Hetzner** | 🇩🇪/🇫🇮 | ~50 SEK (€4.49) | 2 vCPU, 4 GB, 40 GB | Billigast, Helsinki=EU |
| **Scaleway** | 🇫🇷/🇳🇱 | ~100 SEK (€9.34) | 3 vCPU, 4 GB, 40 GB | EU, bra API |
| **GleSYS** | 🇸🇪 | ~300-1000 SEK | 2 vCPU, 4 GB, 40 GB | Helt svenskt, komponent-prissättning |
| **Bahnhof** | 🇸🇪 | ~1195 SEK | Dedicerad | Integritetsfokus, dyrt |
| **City Network / Cleura** | 🇸🇪 | Enterprise-prissättning | Offert | Offentlig sektor, OpenStack |

## Detaljer

### Hetzner (rekommendation för MVP)
- **Pris:** CX22 = €4.49/mån, CX32 = €8.49/mån
- **Datacenter:** Falkenstein (DE), Helsinki (FI)
- **Fördelar:** Extrem prisprestanda, Docker-stöd, bra API, stora community
- **Nackdelar:** Inte svenskt. Tyskt/finskt bolag.
- **GDPR:** Ja (EU-baserat, uppfyller alla krav)

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

## Rekommendation

**Fas 1 (MVP):** Hetzner Helsinki — €4.49/mån. EU-baserat, Docker-ready, kostar ingenting.

**Fas 2 (public launch):** GleSYS Falkenberg — "helt svenskt" narrativ viktig för civic tech.

**Fas 3 (SaaS/enterprise):** Eventuellt City Network om kommuner blir kunder (compliance-krav).

---

*Senast uppdaterad: 2026-06-16*
