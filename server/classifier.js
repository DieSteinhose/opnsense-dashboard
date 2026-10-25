import fs from 'node:fs';
import { CidrSet } from './ip.js';

// Maps a remote endpoint (ip, port, proto) to a service, using in this order:
// 1. the domain the client resolved for that IP (from the Unbound cache), longest suffix wins
// 2. service specific ports (Usenet 563, Steam UDP 27xxx, ...)
// 3. the network the IP belongs to (ASN or CIDR)
// 4. generic fallbacks (HTTPS, QUIC, HTTP)
export class Classifier {
  constructor(file, { dns, asn, lang = 'de' }) {
    this.dns = dns;
    this.asn = asn;
    this.lang = lang;
    this.load(file);
  }

  load(file) {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    // "label"/"name" are German, "label_en"/"name_en" optional English variants
    const en = this.lang === 'en';
    this.categories = cfg.categories.map((c) => ({ id: c.id, label: (en && c.label_en) || c.label }));
    this.categoryById = new Map(this.categories.map((c, i) => [c.id, { ...c, order: i }]));
    const norm = (s) => ({ id: s.id, name: (en && s.name_en) || s.name, category: s.category });
    this.services = cfg.services.map(norm);
    this.unknown = norm(cfg.unknown);
    this.domainRules = new Map();
    this.portRules = [];
    this.asnRules = new Map();
    this.cidrRules = [];
    this.fallbackRules = [];
    for (const s of cfg.services) {
      for (const d of s.domains || []) this.domainRules.set(d.toLowerCase(), norm(s));
      for (const p of s.ports || []) this.portRules.push({ ...parsePort(p), service: norm(s) });
      for (const a of s.asn || []) this.asnRules.set(Number(a), norm(s));
      if (s.cidrs?.length) this.cidrRules.push({ set: new CidrSet(s.cidrs), service: norm(s) });
    }
    for (const s of cfg.fallbacks || []) {
      this.services.push(norm(s));
      for (const p of s.ports || []) this.fallbackRules.push({ ...parsePort(p), service: norm(s) });
    }
    this.services.push(this.unknown);
    this.serviceById = new Map(this.services.map((s) => [s.id, s]));
  }

  category(id) {
    return this.categoryById.get(id) || { id, label: id, order: 99 };
  }

  matchDomain(domain) {
    if (!domain) return null;
    let d = domain.toLowerCase().replace(/\.$/, '');
    while (d) {
      const hit = this.domainRules.get(d);
      if (hit) return hit;
      const i = d.indexOf('.');
      if (i < 0) break;
      d = d.slice(i + 1);
    }
    return null;
  }

  classify(ip, port, proto) {
    const domain = this.dns?.lookup(ip) || null;
    const network = this.asn?.lookup(ip) || null;
    const p = Number(port) || 0;
    const pr = String(proto || '').toLowerCase();
    let service = this.matchDomain(domain);
    let via = service && 'dns';
    if (!service) {
      const r = this.portRules.find((r) => portMatch(r, p, pr));
      if (r) [service, via] = [r.service, 'port'];
    }
    if (!service && network) {
      const s = this.asnRules.get(network.asn);
      if (s) [service, via] = [s, 'asn'];
    }
    if (!service) {
      const r = this.cidrRules.find((r) => r.set.has(ip));
      if (r) [service, via] = [r.service, 'cidr'];
    }
    if (!service) {
      const r = this.fallbackRules.find((r) => portMatch(r, p, pr));
      if (r) [service, via] = [r.service, 'port'];
    }
    if (!service) [service, via] = [this.unknown, 'none'];
    return { service, via, domain, network };
  }
}

function parsePort(spec) {
  const m = String(spec).match(/^(tcp|udp|any)\/(\d+)(?:-(\d+))?$/i);
  if (!m) throw new Error(`invalid port spec "${spec}" (expected tcp/443 or udp/27000-27100)`);
  return { proto: m[1].toLowerCase(), from: Number(m[2]), to: Number(m[3] || m[2]) };
}

function portMatch(rule, port, proto) {
  return port >= rule.from && port <= rule.to && (rule.proto === 'any' || rule.proto === proto);
}
