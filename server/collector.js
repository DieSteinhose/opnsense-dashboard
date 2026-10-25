import { EventEmitter } from 'node:events';
import { CidrSet, isPublic, ipFamily } from './ip.js';

const LIVE_POINTS = 300; // 10 minutes at 2 s
const SKIP_IFACES = /^(lo\d*|enc\d*|pfsync\d*|pflog\d*)$/i;

// Polls OPNsense, turns cumulative counters into deltas and rates, classifies
// connections and writes hourly aggregates to the store.
export class Collector extends EventEmitter {
  constructor({ client, store, classifier, dns, config, log = console }) {
    super();
    Object.assign(this, { client, store, classifier, dns, config, log });
    this.wan = new Set(config.wanInterfaces);
    this.ifaces = new Map(); // key -> {key, name, wan, rxBps, txBps, last}
    this.live = []; // [{ts, rx, tx, ifaces: {key: [rx, tx]}}]  (bits per second, WAN aggregated in rx/tx)
    this.localNets = new CidrSet(config.localNets);
    this.ownAddrs = new Set();
    this.clients = new Map(); // ip -> {ip, mac, hostname, vendor, iface}
    this.macs = new Map(); // mac -> {hostname, vendor}; lets IPv4 and IPv6 of one device count as one client
    this.stateMemo = new Map(); // state id -> [bytes0, bytes1]
    this.statesPrimed = false;
    this.pending = new Map(); // flow aggregation buffer
    this.liveFlows = { ts: 0, services: [], clients: [], categories: [], dests: [] };
    this.topTalkers = { ts: 0, clients: [] };
    this.status = { gateways: [], system: {}, info: {}, states: 0, statesLimit: null };
    this.health = {}; // endpoint -> {ok, error, ts}
    this.timers = [];
  }

  async start() {
    await this.safe('meta', () => this.pollMeta());
    this.every(this.config.intervals.meta, 'meta', () => this.pollMeta());
    this.every(this.config.intervals.traffic, 'traffic', () => this.pollTraffic());
    this.every(this.config.intervals.status, 'status', () => this.pollStatus());
    this.every(this.config.intervals.dns, 'dns', () => this.pollDns());
    this.every(this.config.intervals.states, 'states', () => this.pollStates());
    this.every(this.config.intervals.top, 'top', () => this.pollTop());
    this.every(60000, 'flush', () => this.flush());
    this.every(3600000, 'prune', () => this.store.prune(this.config.retention));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.flush();
  }

  every(ms, name, fn) {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      await this.safe(name, fn);
      running = false;
    };
    run();
    this.timers.push(setInterval(run, ms));
  }

  async safe(name, fn) {
    try {
      await fn();
      this.health[name] = { ok: true, ts: Date.now() };
    } catch (err) {
      const prev = this.health[name];
      if (!prev || prev.ok || prev.error !== err.message) this.log.warn(`[collector] ${name}: ${err.message}`);
      this.health[name] = { ok: false, error: err.message, ts: Date.now() };
    }
  }

  isLocal(ip) {
    return this.ownAddrs.has(ip) || this.localNets.has(ip) || (ipFamily(ip) !== 0 && !isPublic(ip));
  }

  // --- interface metadata, local networks, ARP --------------------------------
  async pollMeta() {
    const [cfg, arp, info, ndp] = await Promise.allSettled([
      this.client.interfaceConfig(),
      this.client.arp(),
      this.client.systemInformation(),
      this.client.ndp(),
    ]);
    if (cfg.status === 'fulfilled' && cfg.value && typeof cfg.value === 'object') {
      for (const dev of Object.values(cfg.value)) {
        for (const a of [...(dev?.ipv4 || []), ...(dev?.ipv6 || [])]) {
          const addr = String(a.ipaddr || '').split('%')[0];
          if (!addr || ipFamily(addr) === 0) continue;
          this.ownAddrs.add(addr);
          const isLL = a['link-local'] || /^fe80:/i.test(addr);
          if (isLL || !a.subnetbits) continue;
          // private LAN prefixes, plus delegated IPv6 GUA prefixes (/48../64) which LAN clients use directly
          const bits = Number(a.subnetbits);
          if (!isPublic(addr) || (ipFamily(addr) === 6 && bits >= 48 && bits <= 64)) this.localNets.add(`${addr}/${bits}`);
        }
      }
    }
    for (const res of [arp, ndp]) {
      if (res.status !== 'fulfilled') continue;
      const rows = Array.isArray(res.value) ? res.value : res.value?.rows || [];
      for (const r of rows) {
        if (!r.ip) continue;
        const ip = String(r.ip).split('%')[0];
        const mac = String(r.mac || '').toLowerCase();
        const prev = this.clients.get(ip) || {};
        const entry = {
          ip,
          mac: mac || prev.mac || '',
          hostname: r.hostname || prev.hostname || '',
          vendor: r.manufacturer || prev.vendor || '',
          iface: r.intf_description || r.intf || prev.iface || '',
        };
        this.clients.set(ip, entry);
        if (entry.mac) {
          const m = this.macs.get(entry.mac) || {};
          this.macs.set(entry.mac, { hostname: entry.hostname || m.hostname || '', vendor: entry.vendor || m.vendor || '' });
        }
      }
    }
    if (info.status === 'fulfilled' && info.value) this.status.info = info.value;
    if (cfg.status === 'rejected' && arp.status === 'rejected') throw cfg.reason;
  }

  clientInfo(ip) {
    const c = this.clients.get(ip);
    const m = c?.mac ? this.macs.get(c.mac) : null;
    return { ip, key: c?.mac || ip, name: c?.hostname || m?.hostname || '', mac: c?.mac || '', vendor: c?.vendor || m?.vendor || '' };
  }

  // breakdown keys are MAC addresses where known, IPs otherwise
  clientByKey(key) {
    const m = this.macs.get(key);
    return m ? { name: m.hostname, vendor: m.vendor } : this.clientInfo(key);
  }

  // --- interface counters -> realtime rates + minute/hour totals -------------
  async pollTraffic() {
    const res = await this.client.interfaceTraffic();
    const now = Date.now();
    const ts = Math.floor(now / 1000);
    const point = { ts: now, rx: 0, tx: 0, ifaces: {} };
    const writes = [];
    for (const [key, it] of Object.entries(res?.interfaces || {})) {
      if (SKIP_IFACES.test(key)) continue;
      const rxB = Number(it['bytes received']);
      const txB = Number(it['bytes transmitted']);
      if (!Number.isFinite(rxB) || !Number.isFinite(txB)) continue;
      let entry = this.ifaces.get(key);
      if (!entry) {
        entry = { key, name: it.name || key, wan: this.wan.has(key), rxBps: 0, txBps: 0, last: null };
        this.ifaces.set(key, entry);
      }
      entry.name = it.name || key;
      if (entry.last) {
        const dt = (now - entry.last.ts) / 1000;
        const dRx = rxB - entry.last.rx;
        const dTx = txB - entry.last.tx;
        if (dt > 0 && dRx >= 0 && dTx >= 0) {
          entry.rxBps = (dRx * 8) / dt;
          entry.txBps = (dTx * 8) / dt;
          writes.push([key, dRx, dTx]);
          point.ifaces[key] = [entry.rxBps, entry.txBps];
          if (entry.wan) {
            point.rx += entry.rxBps;
            point.tx += entry.txBps;
          }
        }
      }
      entry.last = { ts: now, rx: rxB, tx: txB };
    }
    if (writes.length) {
      this.store.tx(() => writes.forEach(([k, rx, tx]) => this.store.addTraffic(ts, k, rx, tx)));
      this.live.push(point);
      if (this.live.length > LIVE_POINTS) this.live.shift();
      this.emit('tick', point);
    }
  }

  // --- pf states -> per service / client / network / destination ------------
  async pollStates() {
    const res = await this.client.states(this.config.maxStates);
    const rows = res?.rows || [];
    this.status.states = Number(res?.total ?? rows.length);
    const now = Date.now();
    const hour = Math.floor(now / 1000 / 3600) * 3600;
    const seen = new Set();
    const agg = { service: new Map(), category: new Map(), client: new Map(), asn: new Map(), country: new Map(), dest: new Map() };

    for (const s of rows) {
      if (s.direction !== 'in' || !s.id || !Array.isArray(s.bytes)) continue;
      seen.add(s.id);
      const b0 = Number(s.bytes[0]) || 0;
      const b1 = Number(s.bytes[1]) || 0;
      const prev = this.stateMemo.get(s.id);
      this.stateMemo.set(s.id, [b0, b1]);
      if (!this.statesPrimed) continue; // first poll only establishes the baseline
      const d0 = prev ? b0 - prev[0] : b0;
      const d1 = prev ? b1 - prev[1] : b1;
      if (d0 <= 0 && d1 <= 0) continue;

      const srcLocal = this.isLocal(s.src_addr);
      const dstLocal = this.isLocal(s.dst_addr);
      let client, remote, rport, up, down;
      if (srcLocal && !dstLocal) {
        [client, remote, rport, up, down] = [s.src_addr, s.dst_addr, s.dst_port, d0, d1];
      } else if (!srcLocal && dstLocal) {
        // inbound (port forward): first counter is what the remote sent us
        // the service is identified by our local port (e.g. 22 for an SSH port forward)
        [client, remote, rport, up, down] = [s.dst_addr, s.src_addr, s.dst_port, d1, d0];
      } else continue; // LAN <-> LAN or transit

      const { service, domain, network } = this.classifier.classify(remote, rport, s.proto);
      const cat = this.classifier.category(service.category);
      add(agg.service, service.id, service.name, { category: cat.id }, down, up);
      add(agg.category, cat.id, cat.label, null, down, up);
      const ci = this.clientInfo(client);
      add(agg.client, ci.key, ci.name || null, { ip: client, mac: ci.mac, vendor: ci.vendor }, down, up);
      if (network) {
        add(agg.asn, String(network.asn), network.name, { country: network.country }, down, up);
        if (network.country) add(agg.country, network.country, network.country, null, down, up);
      }
      const destKey = domain ? baseDomain(domain) : remote;
      add(agg.dest, destKey, domain ? destKey : null, { service: service.id, host: domain || '', asn: network?.name || '' }, down, up);
    }
    for (const id of this.stateMemo.keys()) if (!seen.has(id)) this.stateMemo.delete(id);

    const dt = this.lastStatesTs ? (now - this.lastStatesTs) / 1000 : 0;
    this.lastStatesTs = now;
    if (!this.statesPrimed) {
      this.statesPrimed = true;
      return;
    }
    for (const [kind, map] of Object.entries(agg)) {
      for (const [key, v] of map) {
        const pk = `${hour}|${kind}|${key}`;
        const p = this.pending.get(pk) || { hour, kind, key, label: v.label, extra: v.extra, rx: 0, tx: 0 };
        p.rx += v.rx;
        p.tx += v.tx;
        this.pending.set(pk, p);
      }
    }
    if (dt > 0) {
      const rates = (map, n = 12) =>
        [...map.entries()]
          .map(([key, v]) => ({ key, label: v.label, extra: v.extra, rx: (v.rx * 8) / dt, tx: (v.tx * 8) / dt }))
          .sort((a, b) => b.rx + b.tx - (a.rx + a.tx))
          .slice(0, n);
      this.liveFlows = {
        ts: now,
        interval: dt,
        services: rates(agg.service),
        categories: rates(agg.category),
        clients: rates(agg.client),
        dests: rates(agg.dest),
        asns: rates(agg.asn),
      };
    }
  }

  // --- iftop top talkers on LAN-side interfaces -------------------------------
  async pollTop() {
    const lan = [...this.ifaces.values()].filter((i) => !i.wan).map((i) => i.key);
    if (!lan.length) return;
    const res = await this.client.topTalkers(lan);
    const list = [];
    for (const [iface, data] of Object.entries(res || {})) {
      for (const r of data?.records || []) {
        for (const d of r.details || []) if (d.address && !this.isLocal(d.address)) this.dns.addReverse(d.address, d.rname);
        if (r.rname && !this.isLocal(r.address)) this.dns.addReverse(r.address, r.rname);
        if (!this.isLocal(r.address) || this.ownAddrs.has(r.address)) continue;
        const ci = this.clientInfo(r.address);
        list.push({
          ip: r.address,
          name: ci.name || r.rname || '',
          vendor: ci.vendor,
          iface: this.ifaces.get(iface)?.name || iface,
          rx: Number(r.rate_bits_in) || 0,
          tx: Number(r.rate_bits_out) || 0,
          peers: (r.details || []).length,
        });
      }
    }
    list.sort((a, b) => b.rx + b.tx - (a.rx + a.tx));
    this.topTalkers = { ts: Date.now(), clients: list.slice(0, 25) };
  }

  async pollDns() {
    const res = await this.client.dnsCache();
    this.dns.ingestCache(res?.data ?? res);
  }

  async pollStatus() {
    const [gw, time, resources] = await Promise.allSettled([
      this.client.gateways(),
      this.client.systemTime(),
      this.client.systemResources(),
    ]);
    if (gw.status === 'fulfilled') {
      this.status.gateways = (gw.value?.items || []).map((g) => ({
        name: g.name,
        address: g.address,
        status: g.status,
        label: g.status_translated || g.status,
        delay: parseFloat(g.delay) || null,
        stddev: parseFloat(g.stddev) || null,
        loss: parseFloat(g.loss) || 0,
      }));
    }
    if (time.status === 'fulfilled') this.status.system.time = time.value;
    if (resources.status === 'fulfilled') this.status.system.memory = resources.value?.memory;
    if ([gw, time, resources].every((r) => r.status === 'rejected')) throw gw.reason;
  }

  flush() {
    if (!this.pending.size) return;
    const items = [...this.pending.values()];
    this.pending.clear();
    this.store.tx(() => items.forEach((p) => this.store.addFlow(p.hour, p.kind, p.key, p.label, p.extra, p.rx, p.tx)));
  }
}

function add(map, key, label, extra, rx, tx) {
  const v = map.get(key) || { label, extra, rx: 0, tx: 0 };
  v.rx += Math.max(0, rx);
  v.tx += Math.max(0, tx);
  map.set(key, v);
}

// "cache12.steamcontent.com" -> "steamcontent.com", keeps "co.uk"-style suffixes intact
function baseDomain(name) {
  const parts = name.split('.');
  if (parts.length <= 2) return name;
  const sld = parts[parts.length - 2];
  const n = sld.length <= 3 && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}
