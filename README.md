# OPNsense Insight

[![Docker image](https://github.com/DieSteinhose/opnsense-dashboard/actions/workflows/docker.yml/badge.svg)](https://github.com/DieSteinhose/opnsense-dashboard/actions/workflows/docker.yml)

> **English:** A UniFi-style statistics dashboard for OPNsense: live throughput, daily trend, and where your traffic goes (services such as Steam, Usenet, YouTube, categories, clients, networks/ASN, countries). No plugins required. Set `LANGUAGE=en` for an English UI. Quick start: copy `.env.example` to `.env`, fill in the OPNsense API key, then `docker compose up -d`. Image: `ghcr.io/diesteinhose/opnsense-dashboard` (amd64 + arm64, Alpine based).

Ein Statistik-Dashboard für OPNsense im Stil des UniFi-Network-Dashboards: Live-Durchsatz, Tagestrend, und vor allem **wohin** der Traffic geht, aufgeteilt nach Diensten (Steam, Usenet, YouTube, Netflix, ...), Kategorien, Clients, Netzwerken (ASN) und Ländern. Dark Mode ist der Standard, Hell gibt es per Umschalter.

![Screenshot (Demo-Daten)](docs/screenshot.jpg)

## Was es zeigt

| Bereich | Quelle in OPNsense |
|---|---|
| Live-Durchsatz WAN und alle Interfaces (alle 2 s) | `diagnostics/traffic/interface` (Interface-Bytezähler) |
| Heute / gestern, Verlauf 1 Std bis 30 Tage, Tagestrend | dieselben Zähler, lokal in SQLite aggregiert (Minuten 7 Tage, Stunden 400 Tage) |
| Top Dienste, Kategorien, Clients, Netzwerke, Länder, Ziele | `diagnostics/firewall/query_states` (pf-States mit Byte-Zählern je Verbindung) |
| IP → Domain (z. B. `cache2-fra1.steamcontent.com`) | `unbound/diagnostics/dumpcache` (Unbound-DNS-Cache, inkl. CNAME-Ketten) |
| IP → Netzwerk/Land | freie iptoasn.com-Datenbank, lokal, wöchentlich aktualisiert |
| Hostnamen, Hersteller, IPv4/IPv6 eines Geräts zusammengeführt | `diagnostics/interface/get_arp` + `get_ndp` (per MAC) |
| "Gerade aktiv"-Clients | `diagnostics/traffic/top` (iftop) |
| Latenz, Paketverlust, Gateways | `routes/gateway/status` |
| Laufzeit, Last, RAM, Version | `diagnostics/system/*` |

**Keine Plugins nötig.** Alles oben kommt aus OPNsense-Core. Voraussetzung ist nur, dass Unbound der DNS-Resolver ist (Standard), sonst fehlen die Domainnamen und es wird nach Ports/ASN zugeordnet.

### Wie die Zuordnung zu Diensten funktioniert

Jede Verbindung (pf-State) wird alle 15 s abgefragt, der Byte-Zuwachs seit der letzten Abfrage wird dem Dienst zugerechnet. Die Regeln stehen in [`config/services.json`](config/services.json) und greifen in dieser Reihenfolge:

1. **Domain** aus dem DNS-Cache (längster Treffer gewinnt, `steamcdn-a.akamaihd.net` ist Steam, nicht Akamai)
2. **Port** (Usenet `tcp/563`, Steam `udp/27000-27100`, WireGuard, ...)
3. **ASN/Netz** (Valve AS32590, Netflix AS2906, Hetzner, Cloudflare, ...)
4. Fallback **Web (HTTPS/QUIC/HTTP)**, sonst **Sonstiges**

Eigene Regeln einfach in `services.json` ergänzen (z. B. deinen Usenet-Provider oder deinen VPN-Server). `label`/`name` sind deutsch, optionale `label_en`/`name_en` werden bei `LANGUAGE=en` verwendet.

### Ehrliche Grenzen

- Verbindungen, die zwischen zwei State-Abfragen auf- **und** wieder abgebaut werden, sieht der Collector nicht. Diese Differenz zu den Interface-Zählern wird als **"Nicht erfasst"** angezeigt, statt sie zu verschweigen. Bei großen Downloads (Steam, Usenet) ist der Anteil klein, bei vielen kurzen Web-Requests größer. Das Intervall ist per `POLL_STATES_MS` einstellbar.
- Die Historie beginnt mit dem ersten Start, OPNsense liefert keine rückwirkenden Daten pro Verbindung.
- Echte App-Erkennung per DPI (z. B. "Steam" über einen generischen CDN ohne DNS-Treffer) kann nur ein DPI-Plugin. Siehe unten.

## Start

### Docker (empfohlen)

Fertige Images für `linux/amd64` und `linux/arm64` (z. B. Raspberry Pi) baut GitHub Actions bei jedem Push auf `main` auf Basis von **Alpine 3.22**:

```bash
cp .env.example .env      # OPNSENSE_URL, OPNSENSE_KEY, OPNSENSE_SECRET, LANGUAGE eintragen
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d      # zieht ghcr.io/diesteinhose/opnsense-dashboard:latest
# http://<host>:8080
```

Selbst bauen statt ziehen: in `docker-compose.yml` `build: .` statt `image:` verwenden.

Image-Tags: `latest` (Stand von `main`), `sha-<commit>`, und bei Git-Tags `v1.2.3` zusätzlich `1.2.3` und `1.2`.

> Ist das Repository privat, ist auch das Paket auf GHCR privat. Dann vor dem Pull `docker login ghcr.io` mit einem Personal Access Token (Recht `read:packages`), oder das Paket unter *GitHub → Packages → opnsense-dashboard → Package settings* öffentlich schalten.

### Ohne Docker (Node.js ≥ 22.13, keine npm-Abhängigkeiten)

```bash
cp .env.example .env
npm start
```

### Demo ohne OPNsense

```bash
npm run demo     # erzeugt 14 Tage Beispielhistorie und simuliert Live-Traffic
```

### Verbindung prüfen

```bash
npm run probe    # prüft jeden genutzten API-Endpunkt und schreibt data/probe.json
```

## API-Benutzer in OPNsense anlegen

1. *System → Access → Users*: neuen Benutzer, z. B. `insight`, ohne Login-Shell.
2. Unter **Effective Privileges** nur Lesendes vergeben:
   - `Diagnostics: ARP Table`, `Diagnostics: NDP Table`, `Diagnostics: Show States`, `Diagnostics: Traffic Graph`, `Diagnostics: Interface`, `Diagnostics: System Activity`
   - `Status: Gateways`, `Reporting: Health`, `Services: Unbound DNS: Diagnostics`, `Dashboard (all)`
3. Beim Benutzer unter **API keys** einen Schlüssel erzeugen, Key und Secret in die `.env`.

(Die Privilegien-Namen variieren leicht zwischen OPNsense-Versionen. `npm run probe` zeigt, was fehlt: ein `HTTP 403` heißt fehlendes Recht.)

## Optional: mehr Datenquellen

| Plugin | Bringt | Status |
|---|---|---|
| **os-ntopng** | echte App-Erkennung per nDPI (Steam, Netflix, BitTorrent ... auch ohne DNS) | gute Ergänzung, Anbindung als nächster Schritt geplant |
| **Zenarmor (os-sunnyvalley)** | App- und Kategorie-Erkennung, sehr detailliert | Free-Version reicht für Statistiken |
| **Netflow / Insight** (Core, *Reporting → NetFlow*) | Flow-Daten auch für kurzlebige Verbindungen | würde "Nicht erfasst" verkleinern |

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `LANGUAGE` | `de` | Sprache der Oberfläche: `de` oder `en` |
| `OPNSENSE_URL` | | z. B. `https://192.168.1.1` |
| `OPNSENSE_KEY` / `OPNSENSE_SECRET` | | API-Schlüssel |
| `OPNSENSE_INSECURE` | `true` | selbstsigniertes Zertifikat akzeptieren; besser `OPNSENSE_CA` setzen |
| `WAN_INTERFACES` | `wan` | OPNsense-Interface-Keys der WANs, kommagetrennt |
| `LOCAL_NETS` | automatisch | zusätzliche lokale Netze (CIDR) |
| `ASN_LOOKUP` | `true` | iptoasn.com-Datenbank laden |
| `POLL_STATES_MS` | `15000` | State-Abfrage-Intervall |
| `MAX_STATES` | `20000` | maximale States pro Abfrage |
| `RETENTION_*_DAYS` | 7 / 400 / 90 / 14 | Aufbewahrung Minuten / Stunden / Dienste / Ziele |

## Aufbau

```
server/
  index.js        HTTP-Server, statische Dateien, SSE-Livestream
  opnsense.js     API-Client (Basic Auth, TLS)
  collector.js    Polling, Deltas, Klassifizierung, Aggregation
  classifier.js   Dienst-Regeln (DNS > Port > ASN > Fallback)
  dnsmap.js       IP → Domain aus dem Unbound-Cache
  asn.js          IP → ASN/Land (offline)
  db.js           SQLite (node:sqlite)
  api.js          JSON-API für das Frontend
  mock.js         Demo-Backend mit OPNsense-förmigen Antworten
public/           Frontend ohne Build-Schritt (Vanilla JS, Canvas-Charts)
  i18n.js         Texte Deutsch/Englisch
.github/workflows/docker.yml   Tests + Multi-Arch-Image nach GHCR
config/services.json
scripts/probe.js  Endpunkt-Check gegen eine echte OPNsense
```
