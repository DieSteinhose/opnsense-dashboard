// IP -> domain mapping built from the Unbound cache dump (unbound/diagnostics/dumpcache).
// CNAME chains are walked back to the name the client actually asked for, so an
// Akamai edge IP shows up as "steamcdn-a.akamaihd.net" or "cdn.steamcontent.com".
const KEEP_MS = 6 * 3600 * 1000;

export class DnsMap {
  constructor() {
    this.byIp = new Map(); // ip -> {name, seen}
    this.reverse = new Map(); // ip -> rDNS name (from iftop), weaker source
  }

  get size() {
    return this.byIp.size;
  }

  ingestCache(rows, now = Date.now()) {
    if (!Array.isArray(rows)) return 0;
    const parentOf = new Map();
    const addrs = [];
    for (const r of rows) {
      const type = String(r.rrtype || '').toUpperCase();
      const host = String(r.host || '').toLowerCase().replace(/\.$/, '');
      const value = String(r.value || '').trim().toLowerCase().replace(/\.$/, '');
      if (!host || !value) continue;
      if (type === 'CNAME') parentOf.set(value, host);
      else if (type === 'A' || type === 'AAAA') addrs.push([value, host]);
    }
    for (const [ip, host] of addrs) {
      let name = host;
      const seen = new Set([name]);
      while (parentOf.has(name) && !seen.has(parentOf.get(name))) {
        name = parentOf.get(name);
        seen.add(name);
      }
      this.byIp.set(ip, { name, seen: now });
    }
    for (const [ip, v] of this.byIp) if (now - v.seen > KEEP_MS) this.byIp.delete(ip);
    return addrs.length;
  }

  addReverse(ip, name) {
    if (!ip || !name) return;
    if (this.reverse.size > 20000) this.reverse.clear();
    this.reverse.set(ip, String(name).toLowerCase().replace(/\.$/, ''));
  }

  lookup(ip) {
    return this.byIp.get(ip)?.name || this.reverse.get(ip) || null;
  }
}
