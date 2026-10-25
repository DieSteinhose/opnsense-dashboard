# Prompt für Claude Code (Desktop) – Test gegen eine echte OPNsense

Den Block unten komplett in Claude Code auf dem Rechner einfügen, der Zugriff auf den Proxmox-Host bzw. die OPNsense hat. Vorher entscheiden: **Variante A** (eigene OPNsense, nur lesender API-Key, schneller und realistischer) oder **Variante B** (frische OPNsense-VM auf Proxmox, keine Gefahr für das Heimnetz). Die nicht gewählte Variante im Prompt löschen.

---

```text
Du arbeitest am Projekt "OPNsense Insight": ein Statistik-Dashboard im Stil des
UniFi-Network-Dashboards für OPNsense (Node.js >= 22.13, keine npm-Abhängigkeiten,
SQLite über node:sqlite, Frontend Vanilla JS ohne Build).
Repo: https://github.com/DieSteinhose/opnsense-dashboard
Branch: lege von main einen Branch "verify/real-opnsense" an und arbeite NUR dort.
README.md im Repo erklärt Architektur und Datenquellen. Lies es zuerst.

Der Code wurde OHNE Zugriff auf eine echte OPNsense geschrieben, nur nach Doku und
OPNsense-Quellcode (opnsense/core). Ein Demo-Modus (npm run demo) funktioniert.
Deine Aufgabe: den Code gegen eine echte OPNsense verifizieren, Fehler beheben, und
die Annahmen unten bestätigen oder korrigieren.

== Umgebung ==
[VARIANTE A – vorhandene OPNsense]
- OPNsense erreichbar unter: <URL eintragen, z. B. https://192.168.1.1>
- Lege dort (oder lass mich anlegen) einen Benutzer "insight" mit NUR lesenden Rechten
  an und einen API-Key. Ändere KEINE Firewall-Regeln, Interfaces oder Dienste.
  Keine POST-Aufrufe außer diagnostics/firewall/query_states (das ist nur eine Abfrage).

[VARIANTE B – Test-VM auf Proxmox]
- Proxmox-Host: <Host/IP eintragen>, Zugang: <SSH/API-Token eintragen>
- Lege eine OPNsense-VM an (aktuelles ISO von opnsense.org, 2 vCPU, 4 GB RAM, 20 GB):
  vtnet0 = WAN an der Bridge mit Internetzugang (DHCP), vtnet1 = LAN an einer neuen
  isolierten Bridge (z. B. vmbr99, 192.168.99.1/24, DHCP an).
- Lege eine kleine Linux-VM/LXC (Debian) an vmbr99 als "Client" an.
- In OPNsense: Unbound als Resolver aktiv lassen (Standard), API-User + Key anlegen.
- Erzeuge auf dem Client realistischen Traffic, damit es etwas zu messen gibt:
  * großer Download über HTTPS (z. B. ein Debian-ISO mit curl, Rate notieren)
  * Steam-ähnlich: curl auf einen Steam-CDN-Host, z. B.
    https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg in einer Schleife
  * Usenet-ähnlich: openssl s_client -connect news.eweka.nl:563 (Verbindung genügt)
  * DNS-Abfragen über die OPNsense (dig @192.168.99.1 ...)
  * einen IPv6-Fall, falls das WAN IPv6 hat

== Ablauf ==
1. Repo klonen, Branch auschecken, `cp .env.example .env`, Werte eintragen.
2. `npm test` (muss grün sein), dann `npm run probe`. Ergebnis und data/probe.json
   lesen. Jede FAIL-Zeile untersuchen.
3. `npm start`, Dashboard auf :8080 öffnen, mit Playwright oder dem Browser einen
   Screenshot machen, Zahlen mit OPNsense vergleichen (Reporting > Traffic,
   Diagnostics > States).

== Annahmen, die du konkret prüfen sollst ==
A1  POST /api/diagnostics/firewall/query_states liefert rows[] mit id, direction
    ("in"/"out"), src_addr, dst_addr, dst_port, proto und bytes als Array [a, b].
A2  Für eine ausgehende Verbindung eines LAN-Clients ist bytes[0] = Upload
    (Client -> Internet) und bytes[1] = Download. Prüfen mit einem großen Download:
    der wachsende Wert muss bytes[1] sein. Falls umgekehrt: collector.js pollStates fixen.
A3  Jede Verbindung erscheint einmal mit direction "in" (LAN-Seite) und ggf. einmal
    mit "out" (WAN-Seite/NAT). Der Collector zählt nur "in". Prüfen, dass dadurch
    nichts doppelt UND nichts gar nicht gezählt wird (auch bei Floating-Rules,
    iface = "all", und bei IPv6 ohne NAT).
A4  Die Summe der Dienste (Top Dienste, Fußzeile "x % zugeordnet") liegt bei großen
    Downloads nahe an den WAN-Interface-Bytes. Den Anteil "Nicht erfasst" notieren.
A5  GET /api/diagnostics/traffic/interface: Keys sind Interface-Keys (wan, lan, opt1)
    mit "bytes received"/"bytes transmitted". WAN "received" = Download.
A6  GET /api/diagnostics/traffic/top/lan: records[] mit address, rate_bits_in,
    rate_bits_out, details[]. Ist rate_bits_in für einen LAN-Client wirklich sein
    Download? (Gerade-aktiv-Liste "Clients")
A7  GET /api/unbound/diagnostics/dumpcache: {status, data:[{host, rrtype, value}]};
    die Domain-Zuordnung (Top Ziele) zeigt echte Namen wie debian.org / steamstatic.com.
A8  Pfade existieren in der installierten Version: diagnostics/system/system_time,
    system_resources, system_information, routes/gateway/status,
    diagnostics/interface/get_arp, get_ndp, get_interface_config.
A9  Lokale Netze werden aus get_interface_config richtig erkannt (Fußzeile im
    Dashboard). Bei IPv6 mit Prefix Delegation: gilt das LAN-/64 als lokal?
A10 Laufzeit von query_states bei vielen States (z. B. 5000+): bleibt der Poll unter
    dem Intervall von 15 s? Last auf der OPNsense (top) beobachten.
A11 Welche Privilegien braucht der API-User minimal? README-Abschnitt
    "API-Benutzer in OPNsense anlegen" mit den echten Namen korrigieren.

== Regeln ==
- Code-Stil des Projekts beibehalten (ES-Module, keine neuen npm-Abhängigkeiten).
- Für jede bestätigte oder widerlegte Annahme einen kurzen Eintrag in
  docs/VERIFICATION.md (Annahme, Ergebnis, OPNsense-Version, ggf. Fix).
- Neue Tests in test/core.test.js, wenn du Logik änderst. `npm test` muss grün sein.
- Keine Secrets, echten öffentlichen IPs oder MAC-Adressen committen
  (data/ und .env sind in .gitignore; probe.json bleibt lokal).
- Commits mit klaren Messages auf den Branch oben pushen, dann einen PR gegen main
  erstellen, damit der Docker-Workflow die Änderungen testet.
- Teste beide Sprachen kurz (LANGUAGE=de und LANGUAGE=en).
- Am Ende: Zusammenfassung, was funktioniert, was gefixt wurde, was offen ist.

Optional, falls Zeit bleibt: das Plugin os-ntopng installieren und prüfen, welche
REST-Endpunkte (v2) Anwendungs-Statistiken je Host liefern (nDPI-Protokolle wie
"Steam", "BitTorrent"). Ergebnis als Vorschlag in docs/VERIFICATION.md, noch nicht
einbauen.
```
