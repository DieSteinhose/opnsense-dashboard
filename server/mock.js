// Demo backend: answers the same API calls as OpnsenseClient with OPNsense-shaped
// JSON, so the real parsing code runs in demo mode too. On first start it also
// seeds two weeks of plausible history so the trend charts are not empty.
const MBIT = 1e6 / 8; // bytes per second for 1 Mbit/s

const CLIENTS = [
  { ip: '192.168.1.20', mac: 'a8:a1:59:12:34:01', hostname: 'gaming-pc', vendor: 'ASRock', intf: 'igc1' },
  { ip: '192.168.1.10', mac: '00:11:32:aa:bb:02', hostname: 'nas', vendor: 'Synology', intf: 'igc1' },
  { ip: '192.168.1.30', mac: '64:1c:ae:45:67:03', hostname: 'living-room-tv', vendor: 'Samsung', intf: 'igc1' },
  { ip: '192.168.1.41', mac: 'f0:18:98:23:45:04', hostname: 'iphone', vendor: 'Apple', intf: 'igc1' },
  { ip: '192.168.1.42', mac: '3c:22:fb:66:77:05', hostname: 'macbook-pro', vendor: 'Apple', intf: 'igc1' },
  { ip: '192.168.1.44', mac: '98:fa:9b:11:22:06', hostname: 'office-laptop', vendor: 'Lenovo', intf: 'igc1' },
  { ip: '192.168.1.5', mac: 'dc:a6:32:01:02:07', hostname: 'homeassistant', vendor: 'Raspberry Pi', intf: 'igc1' },
  { ip: '10.0.20.15', mac: '24:0a:c4:aa:00:08', hostname: 'shelly-plug', vendor: 'Espressif', intf: 'igc2' },
];
CLIENTS.push({ ip: '2a02:8071:1234:5600::20', mac: CLIENTS[0].mac, hostname: 'gaming-pc', vendor: 'ASRock', intf: 'igc1' });

const NAMED_BY_ARP = new Set(['192.168.1.10', '192.168.1.20', '192.168.1.30']);
const LEASED = new Set(['192.168.1.41', '192.168.1.42', '10.0.20.15']);

// remote endpoints, real network ranges so the ASN lookup works in demo mode too
const REMOTES = {
  steam: { host: 'cache2-fra1.steamcontent.com', ip: '155.133.248.36', port: 443, proto: 'tcp' },
  steamGame: { ip: '155.133.226.75', port: 27031, proto: 'udp' },
  usenet: { host: 'news.eweka.nl', ip: '81.171.92.234', port: 563, proto: 'tcp' },
  youtube: { host: 'rr4---sn-4g5edndz.googlevideo.com', ip: '173.194.182.71', port: 443, proto: 'udp' },
  youtube6: { host: 'rr2---sn-4g5e6nsz.googlevideo.com', ip: '2a00:1450:4001:82a::6', port: 443, proto: 'udp' },
  netflix: { host: 'ipv4-c012-fra002-ix.1.oca.nflxvideo.net', ip: '45.57.91.1', port: 443, proto: 'tcp' },
  prime: { host: 'd25xi40x97liuc.cloudfront.net', alias: 'atv-ps-eu.aiv-cdn.net', ip: '13.224.103.18', port: 443, proto: 'tcp' },
  twitch: { host: 'video-edge-c2a1f8.fra05.abs.hls.ttvnw.net', ip: '185.42.204.21', port: 443, proto: 'tcp' },
  spotify: { host: 'audio-ak-spotify-com.akamaized.net', ip: '2.21.20.137', port: 443, proto: 'tcp' },
  discord: { host: 'frankfurt8812.discord.media', ip: '66.22.231.40', port: 50003, proto: 'udp' },
  winupdate: { host: 'wu-b-net.trafficmanager.net', alias: '7.tlu.dl.delivery.mp.microsoft.com', ip: '2.16.106.40', port: 80, proto: 'tcp' },
  icloud: { host: 'p52-content.icloud.com', ip: '17.248.211.65', port: 443, proto: 'tcp' },
  whatsapp: { host: 'mmg.whatsapp.net', ip: '157.240.17.52', port: 443, proto: 'tcp' },
  github: { host: 'objects.githubusercontent.com', ip: '185.199.110.133', port: 443, proto: 'tcp' },
  docker: { host: 'production.cloudflare.docker.com', ip: '104.16.98.215', port: 443, proto: 'tcp' },
  teams: { ip: '52.112.87.4', port: 3479, proto: 'udp' },
  hetzner: { ip: '116.203.28.116', port: 443, proto: 'tcp' },
  cloudflare: { ip: '104.18.32.47', port: 443, proto: 'tcp' },
  web: { host: 'www.heise.de', ip: '193.99.144.85', port: 443, proto: 'tcp' },
  ha: { host: 'cloud.nabucasa.com', ip: '3.120.44.12', port: 443, proto: 'tcp' },
  ntp: { ip: '78.46.102.180', port: 123, proto: 'udp' },
  wireguard: { ip: '91.65.12.3', port: 51820, proto: 'udp' },
};

// client, remote, Mbit down, Mbit up, active hours [from, to), duty cycle (0..1)
const SESSIONS = [
  ['192.168.1.20', 'steam', 420, 6, [17, 24], 0.25],
  ['192.168.1.20', 'steamGame', 1.2, 0.6, [18, 24], 0.8],
  ['192.168.1.20', 'discord', 0.3, 0.15, [18, 24], 0.9],
  ['192.168.1.20', 'twitch', 7, 0.2, [16, 23], 0.4],
  ['2a02:8071:1234:5600::20', 'youtube6', 12, 0.4, [14, 23], 0.4],
  ['192.168.1.10', 'usenet', 350, 3, [0, 7], 0.6],
  ['192.168.1.10', 'usenet', 120, 1, [10, 18], 0.3],
  ['192.168.1.10', 'docker', 40, 0.5, [3, 5], 0.3],
  ['192.168.1.10', 'github', 15, 0.5, [2, 6], 0.2],
  ['192.168.1.10', 'hetzner', 4, 18, [1, 4], 0.5],
  ['192.168.1.30', 'netflix', 16, 0.3, [19, 24], 0.8],
  ['192.168.1.30', 'prime', 12, 0.2, [20, 23], 0.5],
  ['192.168.1.30', 'youtube', 9, 0.3, [12, 20], 0.4],
  ['192.168.1.41', 'whatsapp', 0.8, 0.4, [7, 24], 0.5],
  ['192.168.1.41', 'spotify', 0.35, 0.02, [7, 19], 0.6],
  ['192.168.1.41', 'icloud', 6, 12, [22, 24], 0.4],
  ['192.168.1.42', 'web', 2.5, 0.3, [8, 23], 0.6],
  ['192.168.1.42', 'cloudflare', 3, 0.4, [8, 23], 0.6],
  ['192.168.1.42', 'icloud', 4, 2, [9, 22], 0.3],
  ['192.168.1.44', 'teams', 2.4, 2.1, [8, 17], 0.5],
  ['192.168.1.44', 'winupdate', 90, 0.8, [12, 13], 0.5],
  ['192.168.1.5', 'ha', 0.05, 0.08, [0, 24], 1],
  ['192.168.1.5', 'ntp', 0.001, 0.001, [0, 24], 1],
  ['10.0.20.15', 'cloudflare', 0.01, 0.01, [0, 24], 1],
  ['192.168.1.42', 'wireguard', 1.5, 0.8, [9, 17], 0.3],
];

const SERVICE_OF = {
  steam: ['steam', 'gaming'], steamGame: ['steam', 'gaming'], usenet: ['usenet', 'downloads'], youtube: ['youtube', 'streaming'],
  youtube6: ['youtube', 'streaming'], netflix: ['netflix', 'streaming'], prime: ['prime', 'streaming'], twitch: ['twitch', 'streaming'],
  spotify: ['spotify', 'streaming'], discord: ['discord', 'social'], winupdate: ['winupdate', 'updates'], icloud: ['apple', 'updates'],
  whatsapp: ['whatsapp', 'social'], github: ['github', 'updates'], docker: ['linux', 'updates'], teams: ['teams', 'social'],
  hetzner: ['hetzner', 'cloud'], cloudflare: ['cloudflare', 'cloud'], web: ['https', 'web'], ha: ['aws', 'cloud'], ntp: ['ntp', 'infra'],
  wireguard: ['wireguard', 'infra'],
};
const NAMES = {
  steam: 'Steam', usenet: 'Usenet', youtube: 'YouTube', netflix: 'Netflix', prime: 'Prime Video', twitch: 'Twitch', spotify: 'Spotify',
  discord: 'Discord', winupdate: 'Windows Update', apple: 'Apple / iCloud', whatsapp: 'WhatsApp', github: 'GitHub', linux: 'Linux & Pakete',
  teams: 'Teams / Zoom / Meet', hetzner: 'Hetzner', cloudflare: 'Cloudflare', https: 'Web (HTTPS)', aws: 'Amazon / AWS', ntp: 'NTP', wireguard: 'WireGuard / VPN',
};
const CATS = { gaming: 'Gaming', downloads: 'Downloads & Usenet', streaming: 'Streaming', social: 'Social & Kommunikation', updates: 'Updates & Software', cloud: 'Cloud & CDN', web: 'Web & Sonstiges', infra: 'Infrastruktur & VPN' };
const ASNS = {
  steam: [32590, 'Valve Corporation', 'US'], steamGame: [32590, 'Valve Corporation', 'US'], usenet: [60781, 'LeaseWeb Netherlands B.V.', 'NL'],
  youtube: [15169, 'Google LLC', 'US'], youtube6: [15169, 'Google LLC', 'US'], netflix: [2906, 'Netflix Streaming Services Inc.', 'US'],
  prime: [16509, 'Amazon.com, Inc.', 'US'], twitch: [46489, 'Twitch Interactive Inc.', 'US'], spotify: [20940, 'Akamai International B.V.', 'NL'],
  discord: [49544, 'i3D.net B.V', 'NL'], winupdate: [20940, 'Akamai International B.V.', 'NL'], icloud: [714, 'Apple Inc.', 'US'],
  whatsapp: [32934, 'Facebook, Inc.', 'US'], github: [54113, 'Fastly, Inc.', 'US'], docker: [13335, 'Cloudflare, Inc.', 'US'],
  teams: [8075, 'Microsoft Corporation', 'US'], hetzner: [24940, 'Hetzner Online GmbH', 'DE'], cloudflare: [13335, 'Cloudflare, Inc.', 'US'],
  web: [12306, 'Plus.line AG', 'DE'], ha: [16509, 'Amazon.com, Inc.', 'US'], ntp: [24940, 'Hetzner Online GmbH', 'DE'], wireguard: [3209, 'Vodafone GmbH', 'DE'],
};

function rand(seed) {
  // deterministic pseudo random in [0, 1)
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Is a session active at a given time? On/off windows of ~20 minutes, deterministic.
function activeFactor(session, idx, tsSec) {
  const [, , , , [from, to], duty] = session;
  const d = new Date(tsSec * 1000);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < from || h >= to) return 0;
  const slot = Math.floor(tsSec / 1200);
  const day = Math.floor(tsSec / 86400);
  if (rand(slot * 31 + idx * 7) > duty) return 0;
  if (rand(day * 13 + idx) < 0.15 && duty < 0.9) return 0; // some days the activity just doesn't happen
  return 0.6 + 0.4 * rand(slot + idx * 101 + Math.floor(tsSec / 20));
}

export class MockClient {
  constructor({ store, wan = 'wan' }) {
    this.store = store;
    this.wan = wan;
    this.start = Date.now();
    this.last = Date.now() / 1000;
    this.counters = { [wan]: [9.1e12, 6.4e11], lan: [6.3e11, 8.9e12], opt1: [2.1e9, 1.8e9] };
    this.conns = SESSIONS.map((s, i) => ({ idx: i, id: this.newId(), bytes: [0, 0], since: Date.now() / 1000 }));
    if (!store.kv('demoSeeded')) this.seed();
  }

  newId() {
    return `${Math.floor(Math.random() * 2 ** 48).toString(16).padStart(16, '0')}/${'1a2b3c4d'}`;
  }

  // advance simulation to "now"
  advance() {
    const now = Date.now() / 1000;
    const dt = Math.max(0, now - this.last);
    this.last = now;
    let down = 0, up = 0, iot = 0;
    SESSIONS.forEach((s, i) => {
      const f = activeFactor(s, i, now);
      const c = this.conns[i];
      const d = s[2] * MBIT * f * dt * (0.85 + Math.random() * 0.3);
      const u = s[3] * MBIT * f * dt * (0.85 + Math.random() * 0.3);
      if (f > 0) {
        // remote -> client is the second counter for an outbound state
        c.bytes[0] += u;
        c.bytes[1] += d;
        c.active = true;
      } else c.active = false;
      if (now - c.since > 120 + rand(i) * 600) Object.assign(c, { id: this.newId(), bytes: [0, 0], since: now });
      down += d;
      up += u;
      if (s[0].startsWith('10.0.20.')) iot += d + u;
    });
    // ~6 % of traffic belongs to short lived connections the state poll never sees
    const extraD = down * 0.06 + 40e3 * dt, extraU = up * 0.06 + 15e3 * dt;
    this.counters[this.wan][0] += down + extraD;
    this.counters[this.wan][1] += up + extraU;
    this.counters.lan[0] += up + extraU;
    this.counters.lan[1] += down + extraD;
    this.counters.opt1[0] += iot * 0.5 + 500 * dt;
    this.counters.opt1[1] += iot * 0.5 + 800 * dt;
  }

  async interfaceTraffic() {
    this.advance();
    const it = (name, [rx, tx]) => ({ name, 'bytes received': String(Math.round(rx)), 'bytes transmitted': String(Math.round(tx)), 'packets received': '0', 'packets transmitted': '0' });
    return {
      interfaces: { [this.wan]: it('WAN', this.counters[this.wan]), lan: it('LAN', this.counters.lan), opt1: it('IoT', this.counters.opt1) },
      time: Date.now() / 1000,
    };
  }

  async states() {
    this.advance();
    const rows = [];
    SESSIONS.forEach((s, i) => {
      const r = REMOTES[s[1]];
      const c = this.conns[i];
      const client = CLIENTS.find((x) => x.ip === s[0]);
      const v6 = r.ip.includes(':');
      const base = { label: '', descr: '', proto: r.proto, ipproto: v6 ? 'ipv6' : 'ipv4', flags: [], state: 'ESTABLISHED:ESTABLISHED', age: '00:01:12', expires: '23:59:50' };
      rows.push({ ...base, id: c.id, iface: client.intf, direction: 'in', src_addr: s[0], src_port: String(40000 + i), dst_addr: r.ip, dst_port: String(r.port), bytes: c.bytes.map(Math.round), pkts: c.bytes.map((b) => Math.round(b / 1200)) });
      // the matching NAT state on WAN (direction out) must be ignored by the collector
      rows.push({ ...base, id: c.id.replace(/^./, 'f'), iface: 'pppoe0', direction: 'out', src_addr: v6 ? s[0] : '84.150.12.34', src_port: String(50000 + i), dst_addr: r.ip, dst_port: String(r.port), nat_addr: s[0], bytes: c.bytes.map(Math.round), pkts: [0, 0] });
    });
    // LAN-internal noise
    rows.push({ id: 'aaaa000000000001/1a2b3c4d', iface: 'igc1', proto: 'tcp', direction: 'in', src_addr: '192.168.1.42', src_port: '51000', dst_addr: '192.168.1.10', dst_port: '445', bytes: [Math.round(this.last * 1000) % 1e9, 1e6], pkts: [1, 1] });
    return { rows, rowCount: rows.length, total: rows.length + 412, current: 1 };
  }

  async topTalkers(ifaces) {
    const out = {};
    for (const key of ifaces) {
      const intf = key === 'lan' ? 'igc1' : 'igc2';
      const now = Date.now() / 1000;
      const records = CLIENTS.filter((c) => c.intf === intf).map((c) => {
        let rx = 0, tx = 0;
        const details = [];
        SESSIONS.forEach((s, i) => {
          if (s[0] !== c.ip) return;
          const f = activeFactor(s, i, now);
          rx += s[2] * 1e6 * f;
          tx += s[3] * 1e6 * f;
          if (f) details.push({ address: REMOTES[s[1]].ip, rate: '', rate_bits: Math.round((s[2] + s[3]) * 1e6 * f), cumulative: '', cumulative_bytes: 0, tags: [] });
        });
        return { address: c.ip, rate_bits_in: Math.round(rx), rate_bits_out: Math.round(tx), rate_bits: Math.round(rx + tx), cumulative_bytes_in: 0, cumulative_bytes_out: 0, cumulative_bytes: 0, tags: ['private'], details, rname: '' };
      });
      out[key] = { status: 'ok', records: records.filter((r) => r.rate_bits > 0) };
    }
    return out;
  }

  async dnsCache() {
    const data = [];
    for (const r of Object.values(REMOTES)) {
      if (!r.host) continue;
      if (r.alias) {
        // the client asked for the alias, which is a CNAME to the CDN host
        data.push({ host: r.alias + '.', ttl: '120', type: 'IN', rrtype: 'CNAME', value: r.host + '.' });
        data.push({ host: r.host + '.', ttl: '60', type: 'IN', rrtype: 'A', value: r.ip });
      } else data.push({ host: r.host + '.', ttl: '300', type: 'IN', rrtype: r.ip.includes(':') ? 'AAAA' : 'A', value: r.ip });
    }
    return { status: 'ok', data };
  }

  // like on many real setups, ARP knows only some names; the rest come from DHCP leases or reverse DNS
  async arp() {
    return CLIENTS.filter((c) => !c.ip.includes(':')).map((c) => ({ ip: c.ip, mac: c.mac, hostname: NAMED_BY_ARP.has(c.ip) ? c.hostname : '', manufacturer: c.vendor, intf: c.intf, intf_description: c.intf === 'igc1' ? 'LAN' : 'IoT', expired: false, permanent: false, type: 'ethernet' }));
  }

  async leases(source) {
    if (source !== 'dnsmasq') throw Object.assign(new Error('HTTP 404'), { status: 404 });
    const rows = CLIENTS.filter((c) => LEASED.has(c.ip)).map((c) => ({ address: c.ip, hwaddr: c.mac, hostname: c.hostname, if_descr: 'LAN' }));
    return { rows, rowCount: rows.length, total: rows.length, current: 1 };
  }

  async reverseLookup(ips) {
    return Object.fromEntries(ips.map((ip) => {
      const c = CLIENTS.find((x) => x.ip === ip);
      return [ip, c && !LEASED.has(ip) && !NAMED_BY_ARP.has(ip) ? `${c.hostname}.home.arpa` : ip];
    }));
  }

  async ndp() {
    return CLIENTS.filter((c) => c.ip.includes(':')).map((c) => ({ ip: c.ip, mac: c.mac, manufacturer: c.vendor, intf: c.intf, intf_description: 'LAN' }));
  }

  async interfaceConfig() {
    return {
      igc0: { ipv4: [{ ipaddr: '84.150.12.34', subnetbits: 32 }], ipv6: [] },
      igc1: { ipv4: [{ ipaddr: '192.168.1.1', subnetbits: 24 }], ipv6: [{ ipaddr: '2a02:8071:1234:5600::1', subnetbits: 64 }, { ipaddr: 'fe80::1%igc1', subnetbits: 64, 'link-local': true }] },
      igc2: { ipv4: [{ ipaddr: '10.0.20.1', subnetbits: 24 }], ipv6: [] },
    };
  }

  async interfaceNames() {
    return { igc0: 'WAN', igc1: 'LAN', igc2: 'IoT' };
  }

  async gateways() {
    const t = Date.now() / 1000;
    return {
      items: [
        { name: 'WAN_PPPOE', address: '62.155.244.1', status: 'none', status_translated: 'Online', delay: `${(8.5 + Math.sin(t / 60) * 1.5 + Math.random()).toFixed(1)} ms`, stddev: '0.6 ms', loss: '0.0 %' },
        { name: 'WAN_PPPOE6', address: 'fe80::1', status: 'none', status_translated: 'Online', delay: `${(9.4 + Math.random()).toFixed(1)} ms`, stddev: '0.8 ms', loss: '0.0 %' },
      ],
      status: 'ok',
    };
  }

  async systemTime() {
    const up = (Date.now() - this.start) / 1000 + 23 * 86400 + 4 * 3600;
    const d = Math.floor(up / 86400);
    const hms = new Date((up % 86400) * 1000).toISOString().slice(11, 19);
    return { uptime: `${d} days ${hms}`, datetime: new Date().toString(), loadavg: `${(0.3 + Math.random() * 0.3).toFixed(2)}, 0.41, 0.38` };
  }

  async systemResources() {
    return { memory: { total: String(8 * 1024 ** 3), used: Math.round(2.6 * 1024 ** 3 + Math.random() * 1e8), total_frmt: '8192', used_frmt: '2700' } };
  }

  async systemInformation() {
    return { name: 'opnsense.home.arpa', versions: ['OPNsense 26.7.4-amd64', 'FreeBSD 14.3-RELEASE-p4', 'OpenSSL 3.0.17'], updates: '' };
  }

  // two weeks of history, written straight into the store
  seed() {
    const now = Math.floor(Date.now() / 1000);
    const startHour = Math.floor((now - 14 * 86400) / 3600) * 3600;
    const minFrom = now - 2 * 86400;
    this.store.tx(() => {
      for (let h = startHour; h < Math.floor(now / 60) * 60; h += 60) {
        const isHourStart = h % 3600 === 0;
        let down = 0, up = 0;
        const flows = {};
        SESSIONS.forEach((s, i) => {
          const f = activeFactor(s, i, h + 30);
          if (!f) return;
          const d = s[2] * MBIT * f * 60, u = s[3] * MBIT * f * 60;
          down += d;
          up += u;
          if (h < minFrom - 3600 && !isHourStart) return; // older history: accumulate hourly flows only on a sample
          const mult = h < minFrom - 3600 ? 60 : 1;
          const [svc, cat] = SERVICE_OF[s[1]];
          const r = REMOTES[s[1]];
          const a = ASNS[s[1]];
          const add = (kind, key, label, extra) => {
            const k = `${kind}|${key}`;
            const v = flows[k] || (flows[k] = { kind, key, label, extra, rx: 0, tx: 0 });
            v.rx += d * mult;
            v.tx += u * mult;
          };
          const client = CLIENTS.find((c) => c.ip === s[0]);
          add('service', svc, NAMES[svc], { category: cat });
          add('category', cat, CATS[cat], null);
          add('client', client.mac, client.hostname, { ip: s[0], mac: client.mac, vendor: client.vendor });
          add('asn', String(a[0]), a[1], { country: a[2] });
          add('country', a[2], a[2], null);
          const dest = r.alias || r.host ? baseDomain(r.alias || r.host) : r.ip;
          add('dest', dest, r.host ? dest : null, { service: svc, host: r.alias || r.host || '', asn: a[1] });
        });
        const extraD = down * 0.06 + 40e3 * 60, extraU = up * 0.06 + 15e3 * 60;
        const totalD = down + extraD, totalU = up + extraU;
        const hour = h - (h % 3600);
        if (h >= minFrom) {
          this.store.stmt.min.run(h, this.wan, Math.round(totalD), Math.round(totalU));
          this.store.stmt.min.run(h, 'lan', Math.round(totalU), Math.round(totalD));
        }
        this.store.stmt.hour.run(hour, this.wan, Math.round(totalD), Math.round(totalU));
        this.store.stmt.hour.run(hour, 'lan', Math.round(totalU), Math.round(totalD));
        for (const v of Object.values(flows)) this.store.addFlow(hour, v.kind, v.key, v.label, v.extra, v.rx, v.tx);
      }
    });
    this.store.kv('demoSeeded', true);
  }
}

function baseDomain(name) {
  const parts = name.split('.');
  return parts.length <= 2 ? name : parts.slice(-2).join('.');
}
