import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { CidrSet, isPublic, ipToBigInt } from '../server/ip.js';
import { DnsMap } from '../server/dnsmap.js';
import { Classifier } from '../server/classifier.js';
import { Collector } from '../server/collector.js';
import { Store } from '../server/db.js';
import { config, ROOT } from '../server/config.js';

test('ip helpers', () => {
  assert.equal(ipToBigInt('1.2.3.4'), 0x01020304n);
  assert.ok(isPublic('8.8.8.8'));
  assert.ok(!isPublic('192.168.1.5'));
  assert.ok(!isPublic('fd00::1'));
  assert.ok(isPublic('2a00:1450:4001::6'));
  const set = new CidrSet(['2a02:8071:1234:5600::/64', '10.0.0.0/8']);
  assert.ok(set.has('2a02:8071:1234:5600::20'));
  assert.ok(!set.has('2a02:8071:1234:5601::20'));
  assert.ok(set.has('10.9.8.7'));
  assert.ok(!set.has('11.0.0.1'));
});

test('dns map follows CNAME chains back to the requested name', () => {
  const dns = new DnsMap();
  dns.ingestCache([
    { host: 'cdn.steamcontent.com.', rrtype: 'CNAME', value: 'cdn.steamcontent.com.edgesuite.net.' },
    { host: 'cdn.steamcontent.com.edgesuite.net.', rrtype: 'CNAME', value: 'a1.akamai.net.' },
    { host: 'a1.akamai.net.', rrtype: 'A', value: '2.16.1.1' },
  ]);
  assert.equal(dns.lookup('2.16.1.1'), 'cdn.steamcontent.com');
});

test('classifier: domain beats port beats asn beats fallback', () => {
  const dns = new DnsMap();
  dns.ingestCache([{ host: 'steamcdn-a.akamaihd.net', rrtype: 'A', value: '2.2.2.2' }, { host: 'x.akamaihd.net', rrtype: 'A', value: '2.2.2.3' }]);
  const asn = { lookup: (ip) => (ip === '9.9.9.9' ? { asn: 13335, name: 'Cloudflare', country: 'US' } : null) };
  const c = new Classifier(path.join(ROOT, 'config/services.json'), { dns, asn });
  assert.equal(c.classify('2.2.2.2', 443, 'tcp').service.id, 'steam'); // longest suffix wins
  assert.equal(c.classify('2.2.2.3', 443, 'tcp').service.id, 'akamai');
  assert.equal(c.classify('5.5.5.5', 563, 'tcp').service.id, 'usenet');
  assert.equal(c.classify('9.9.9.9', 443, 'tcp').service.id, 'cloudflare');
  assert.equal(c.classify('5.5.5.5', 443, 'udp').service.id, 'quic');
  assert.equal(c.classify('5.5.5.5', 12345, 'tcp').service.id, 'other');
});

test('collector counts only direction=in states, by delta, with up/down per side', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-'));
  const store = new Store(dir);
  const dns = new DnsMap();
  const classifier = new Classifier(path.join(ROOT, 'config/services.json'), { dns, asn: null });
  let rows = [];
  const client = { states: async () => ({ rows, total: rows.length }) };
  const col = new Collector({ client, store, classifier, dns, config: { ...config, localNets: ['192.168.1.0/24'] }, log: { warn() {}, info() {} } });
  const st = (id, dir, src, dst, dport, bytes) => ({ id, direction: dir, src_addr: src, src_port: '40000', dst_addr: dst, dst_port: String(dport), proto: 'tcp', bytes });
  rows = [st('a', 'in', '192.168.1.10', '81.171.92.1', 563, [100, 1000]), st('b', 'out', '84.1.1.1', '81.171.92.1', 563, [100, 1000])];
  await col.pollStates(); // baseline only
  rows = [st('a', 'in', '192.168.1.10', '81.171.92.1', 563, [300, 51000]), st('b', 'out', '84.1.1.1', '81.171.92.1', 563, [300, 51000]),
    st('c', 'in', '192.168.1.10', '192.168.1.20', 445, [5, 5]), st('d', 'in', '203.0.113.9', '192.168.1.10', 22, [700, 70])];
  await col.pollStates();
  col.flush();
  const now = Math.floor(Date.now() / 1000);
  const svc = Object.fromEntries(store.flowTop('service', now - 7200, now + 3600, 10).map((r) => [r.key, r]));
  assert.deepEqual([svc.usenet.rx, svc.usenet.tx], [50000, 200]); // only the delta, NAT state ignored
  assert.deepEqual([svc.ssh.rx, svc.ssh.tx], [700, 70]); // inbound: first counter is download
  assert.equal(store.flowTop('client', now - 7200, now + 3600, 10).length, 1); // LAN<->LAN ignored
});

test('day keys are ISO dates independent of the ICU build', async () => {
  const { dayKey } = await import('../server/api.js');
  assert.match(dayKey(Date.UTC(2026, 9, 25, 12) / 1000), /^2026-10-2[456]$/);
});
