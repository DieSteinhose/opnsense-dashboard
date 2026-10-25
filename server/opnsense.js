import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';

// Thin client for the OPNsense REST API (key/secret as HTTP basic auth).
// Endpoint names follow docs.opnsense.org/development/api/core/diagnostics.html
export class OpnsenseClient {
  constructor({ url, key, secret, insecure, ca, timeoutMs }) {
    if (!url) throw new Error('OPNSENSE_URL is not set (or use DEMO=1)');
    if (!key || !secret) throw new Error('OPNSENSE_KEY / OPNSENSE_SECRET are not set');
    this.base = new URL(url);
    this.auth = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
    this.timeoutMs = timeoutMs;
    const isHttps = this.base.protocol === 'https:';
    this.transport = isHttps ? https : http;
    this.agent = isHttps
      ? new https.Agent({
          keepAlive: true,
          rejectUnauthorized: !insecure || Boolean(ca),
          ca: ca ? fs.readFileSync(ca) : undefined,
        })
      : new http.Agent({ keepAlive: true });
  }

  request(method, path, body) {
    const url = new URL('/api/' + path.replace(/^\/+/, ''), this.base);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = this.transport.request(
        url,
        {
          method,
          agent: this.agent,
          timeout: this.timeoutMs,
          headers: {
            Authorization: this.auth,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const err = new Error(`${method} ${path} -> HTTP ${res.statusCode}`);
              err.status = res.statusCode;
              return reject(err);
            }
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch {
              reject(new Error(`${method} ${path} -> invalid JSON`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`${method} ${path} -> timeout`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body = {}) {
    return this.request('POST', path, body);
  }

  // --- endpoints used by the collector -------------------------------------
  // {interfaces: {wan: {name, 'bytes received', 'bytes transmitted', ...}}, time}
  interfaceTraffic() {
    return this.get('diagnostics/traffic/interface');
  }

  // {lan: {status, records: [{address, rate_bits_in, rate_bits_out, cumulative_bytes_in, rname, tags, ...}]}}
  topTalkers(ifaces) {
    return this.get('diagnostics/traffic/top/' + ifaces.join(','));
  }

  // {rows: [{id, iface, proto, direction, src_addr, src_port, dst_addr, dst_port, nat_addr, bytes: [a, b], pkts: [a, b]}], total}
  states(rowCount) {
    return this.post('diagnostics/firewall/query_states', { current: 1, rowCount });
  }

  // {status: 'ok', data: [{host, ttl, rrtype, value}]}
  dnsCache() {
    return this.get('unbound/diagnostics/dumpcache');
  }

  // [{mac, ip, intf, hostname, manufacturer, intf_description, expired}]
  arp() {
    return this.get('diagnostics/interface/get_arp');
  }

  // [{mac, ip, intf, manufacturer, intf_description}]
  ndp() {
    return this.get('diagnostics/interface/get_ndp');
  }

  // {"igb0": {ipv4: [{ipaddr, subnetbits}], ipv6: [...], ...}}
  interfaceConfig() {
    return this.get('diagnostics/interface/get_interface_config');
  }

  // {"igb0": "LAN", ...}
  interfaceNames() {
    return this.get('diagnostics/interface/get_interface_names');
  }

  // {items: [{name, address, status, status_translated, delay, stddev, loss}]}
  gateways() {
    return this.get('routes/gateway/status');
  }

  systemTime() {
    return this.get('diagnostics/system/system_time');
  }

  systemResources() {
    return this.get('diagnostics/system/system_resources');
  }

  systemInformation() {
    return this.get('diagnostics/system/system_information');
  }

  pfStatistics() {
    return this.get('diagnostics/firewall/pf_states');
  }
}
