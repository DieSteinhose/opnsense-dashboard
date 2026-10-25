// UI strings. The language comes from LANGUAGE in .env; the server stamps it
// into <html lang="..."> so the page renders in the right language right away.
const STRINGS = {
  de: {
    'nav.overview': 'Übersicht', 'nav.traffic': 'Durchsatz', 'nav.services': 'Dienste', 'nav.clients': 'Clients', 'nav.system': 'System',
    'nav.theme': 'Hell/Dunkel umschalten', 'nav.label': 'Navigation',
    'top.connecting': 'verbinde …', 'top.demo': 'Demo-Daten', 'top.live': 'Live', 'top.range': 'Zeitraum',
    'range.1h': '1 Std', 'range.24h': '24 Std', 'range.7d': '7 Tage', 'range.30d': '30 Tage',
    'rangeLong.1h': 'letzte Stunde', 'rangeLong.24h': 'letzte 24 Std', 'rangeLong.7d': 'letzte 7 Tage', 'rangeLong.30d': 'letzte 30 Tage',
    'internet.title': 'Internet', 'internet.download': 'Download', 'internet.upload': 'Upload', 'internet.latency': 'Latenz',
    'internet.loss': 'Paketverlust', 'internet.gateway': 'Gateway', 'internet.online': 'Online', 'internet.degraded': 'Beeinträchtigt', 'internet.offline': 'Offline', 'internet.noGateway': 'Kein Gateway',
    'tile.todayRx': 'Heute empfangen', 'tile.todayTx': 'Heute gesendet', 'tile.states': 'Aktive Verbindungen', 'tile.statesSub': 'pf States',
    'tile.clients': 'Clients mit Traffic', 'tile.clientsSub': 'gerade aktiv', 'tile.yesterday': 'gestern {v}',
    'tp.title': 'Durchsatz', 'tp.live': 'Live', 'tp.range': 'Zeitraum',
    'tp.footLive': 'WAN, letzte {span} · Spitze ↓ {peak} · Mittel ↓ {avg}',
    'tp.footRange': 'WAN, {range} · ↓ {rx} · ↑ {tx} · Spitze ↓ {peak} (Mittel je {step})',
    'unit.seconds': '{n} Sekunden', 'unit.minutes': '{n} Minuten', 'unit.hours': '{n} Std', 'unit.min': '{n} Min',
    'cat.title': 'Traffic nach Kategorie', 'cat.total': 'gesamt', 'cat.untracked': 'Nicht erfasst', 'cat.noData': 'Noch keine Daten',
    'daily.title': 'Tagestrend', 'daily.dir': 'Down / Up', 'daily.cat': 'Kategorien', 'daily.days': '{n} T', 'daily.sum': 'Summe',
    'svc.title': 'Top Dienste', 'svc.foot': '{p} des WAN-Traffics einzelnen Verbindungen zugeordnet',
    'cli.title': 'Top Clients', 'cli.unknown': 'unbekanntes Gerät',
    'asn.title': 'Top Netzwerke', 'asn.sub': 'nach ASN',
    'now.title': 'Gerade aktiv', 'now.services': 'Dienste', 'now.clients': 'Clients', 'now.dests': 'Ziele',
    'now.collecting': 'Sammle Verbindungsdaten … (ca. 30 s nach dem Start)', 'now.quiet': 'Gerade kein nennenswerter Traffic.',
    'dest.title': 'Top Ziele', 'dest.sub': 'Domains via DNS', 'country.title': 'Länder',
    'if.title': 'Interfaces', 'if.name': 'Interface', 'if.rxNow': '↓ jetzt', 'if.txNow': '↑ jetzt', 'if.rxDay': '↓ heute', 'if.txDay': '↑ heute', 'if.trend': 'Verlauf',
    'sys.title': 'System', 'sys.host': 'Host', 'sys.version': 'Version', 'sys.uptime': 'Laufzeit', 'sys.load': 'Last', 'sys.memory': 'Arbeitsspeicher',
    'list.empty': 'Noch keine Daten – das füllt sich mit der Zeit.',
    'tip.traffic': 'Traffic', 'tip.share': 'Anteil',
    'foot.since': 'Daten seit {v}', 'foot.dns': '{v} IP→Domain-Zuordnungen aus Unbound', 'foot.asn': '{v} ASN-Netzbereiche',
    'foot.asnOff': 'ASN-Lookup aus', 'foot.localNets': 'Lokale Netze: {v}', 'foot.errors': 'Fehler: {v}',
    'uptime.days': 'Tage', 'uptime.day': 'Tag',
  },
  en: {
    'nav.overview': 'Overview', 'nav.traffic': 'Throughput', 'nav.services': 'Services', 'nav.clients': 'Clients', 'nav.system': 'System',
    'nav.theme': 'Toggle light/dark', 'nav.label': 'Navigation',
    'top.connecting': 'connecting …', 'top.demo': 'Demo data', 'top.live': 'Live', 'top.range': 'Time range',
    'range.1h': '1 h', 'range.24h': '24 h', 'range.7d': '7 days', 'range.30d': '30 days',
    'rangeLong.1h': 'last hour', 'rangeLong.24h': 'last 24 h', 'rangeLong.7d': 'last 7 days', 'rangeLong.30d': 'last 30 days',
    'internet.title': 'Internet', 'internet.download': 'Download', 'internet.upload': 'Upload', 'internet.latency': 'Latency',
    'internet.loss': 'Packet loss', 'internet.gateway': 'Gateway', 'internet.online': 'Online', 'internet.degraded': 'Degraded', 'internet.offline': 'Offline', 'internet.noGateway': 'No gateway',
    'tile.todayRx': 'Received today', 'tile.todayTx': 'Sent today', 'tile.states': 'Active connections', 'tile.statesSub': 'pf states',
    'tile.clients': 'Clients with traffic', 'tile.clientsSub': 'active right now', 'tile.yesterday': 'yesterday {v}',
    'tp.title': 'Throughput', 'tp.live': 'Live', 'tp.range': 'Time range',
    'tp.footLive': 'WAN, last {span} · peak ↓ {peak} · average ↓ {avg}',
    'tp.footRange': 'WAN, {range} · ↓ {rx} · ↑ {tx} · peak ↓ {peak} (averaged per {step})',
    'unit.seconds': '{n} seconds', 'unit.minutes': '{n} minutes', 'unit.hours': '{n} h', 'unit.min': '{n} min',
    'cat.title': 'Traffic by category', 'cat.total': 'total', 'cat.untracked': 'Not tracked', 'cat.noData': 'No data yet',
    'daily.title': 'Daily trend', 'daily.dir': 'Down / Up', 'daily.cat': 'Categories', 'daily.days': '{n} d', 'daily.sum': 'Total',
    'svc.title': 'Top services', 'svc.foot': '{p} of WAN traffic attributed to individual connections',
    'cli.title': 'Top clients', 'cli.unknown': 'unknown device',
    'asn.title': 'Top networks', 'asn.sub': 'by ASN',
    'now.title': 'Active now', 'now.services': 'Services', 'now.clients': 'Clients', 'now.dests': 'Destinations',
    'now.collecting': 'Collecting connection data … (about 30 s after start)', 'now.quiet': 'No notable traffic right now.',
    'dest.title': 'Top destinations', 'dest.sub': 'domains via DNS', 'country.title': 'Countries',
    'if.title': 'Interfaces', 'if.name': 'Interface', 'if.rxNow': '↓ now', 'if.txNow': '↑ now', 'if.rxDay': '↓ today', 'if.txDay': '↑ today', 'if.trend': 'Trend',
    'sys.title': 'System', 'sys.host': 'Host', 'sys.version': 'Version', 'sys.uptime': 'Uptime', 'sys.load': 'Load', 'sys.memory': 'Memory',
    'list.empty': 'No data yet – this fills up over time.',
    'tip.traffic': 'Traffic', 'tip.share': 'Share',
    'foot.since': 'Data since {v}', 'foot.dns': '{v} IP→domain mappings from Unbound', 'foot.asn': '{v} ASN ranges',
    'foot.asnOff': 'ASN lookup off', 'foot.localNets': 'Local networks: {v}', 'foot.errors': 'Errors: {v}',
    'uptime.days': 'days', 'uptime.day': 'day',
  },
};

export const lang = document.documentElement.lang === 'en' ? 'en' : 'de';
export const locale = lang === 'en' ? 'en-GB' : 'de-DE';

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.de[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// <el data-i18n="key">, data-i18n-title="key" (title + aria-label), data-i18n-label="key" (aria-label)
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  });
  root.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
}
