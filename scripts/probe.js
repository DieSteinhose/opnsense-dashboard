// Checks every OPNsense endpoint the collector relies on and reports whether
// the response looks the way the code expects. Usage: npm run probe
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { OpnsenseClient } from '../server/opnsense.js';

const client = new OpnsenseClient(config.opnsense);
const report = {};
const shape = (v, depth = 0) => {
  if (Array.isArray(v)) return depth > 2 ? `array(${v.length})` : [`array(${v.length})`, v.length ? shape(v[0], depth + 1) : null];
  if (v && typeof v === 'object') return depth > 2 ? 'object' : Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v;
};

async function check(name, fn, expect) {
  const t = Date.now();
  try {
    const res = await fn();
    const problems = expect(res) || [];
    report[name] = { ok: problems.length === 0, ms: Date.now() - t, problems, shape: shape(res) };
  } catch (err) {
    report[name] = { ok: false, ms: Date.now() - t, problems: [err.message] };
  }
  const r = report[name];
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(18)} ${String(r.ms).padStart(5)} ms  ${r.problems.join('; ')}`);
}

await check('interfaceTraffic', () => client.interfaceTraffic(), (r) => {
  const ifs = r?.interfaces || {};
  const p = [];
  if (!Object.keys(ifs).length) p.push('no interfaces');
  for (const w of config.wanInterfaces) if (!ifs[w]) p.push(`WAN key "${w}" not found, keys: ${Object.keys(ifs).join(',')}`);
  const first = Object.values(ifs)[0] || {};
  if (!('bytes received' in first)) p.push('field "bytes received" missing');
  return p;
});
await check('states', () => client.states(500), (r) => {
  const rows = r?.rows || [];
  const p = [];
  if (!rows.length) p.push('no states returned');
  const s = rows.find((x) => x.direction === 'in');
  if (!s) p.push('no state with direction "in"');
  else {
    if (!Array.isArray(s.bytes)) p.push('state.bytes is not an array [a, b] - per-connection traffic impossible');
    for (const k of ['id', 'src_addr', 'dst_addr', 'dst_port', 'proto']) if (!(k in s)) p.push(`state.${k} missing`);
  }
  report.statesSample = rows.slice(0, 5);
  return p;
});
const lan = Object.keys((await client.interfaceTraffic().catch(() => ({})))?.interfaces || {}).filter((k) => !config.wanInterfaces.includes(k) && !/^lo/.test(k));
await check('topTalkers', () => client.topTalkers(lan.slice(0, 2)), (r) => {
  const p = [];
  const recs = Object.values(r || {}).flatMap((x) => x?.records || []);
  if (!recs.length) p.push('no iftop records (is anything flowing?)');
  else if (!('rate_bits_in' in recs[0])) p.push('rate_bits_in missing');
  report.topSample = recs.slice(0, 3);
  return p;
});
await check('dnsCache', () => client.dnsCache(), (r) => {
  const rows = r?.data ?? r;
  return Array.isArray(rows) && rows.some((x) => x.rrtype === 'A') ? [] : ['no A records in Unbound cache dump (is Unbound the resolver?)'];
});
await check('arp', () => client.arp(), (r) => ((Array.isArray(r) ? r : r?.rows || []).some((x) => x.ip && x.mac) ? [] : ['no ARP rows with ip/mac']));
await check('ndp', () => client.ndp(), () => []);
await check('interfaceConfig', () => client.interfaceConfig(), (r) => (Object.values(r || {}).some((d) => d?.ipv4?.[0]?.subnetbits) ? [] : ['no ipv4[].subnetbits found']));
await check('gateways', () => client.gateways(), (r) => (Array.isArray(r?.items) ? [] : ['items missing']));
await check('systemTime', () => client.systemTime(), (r) => (r?.uptime ? [] : ['uptime missing']));
await check('systemResources', () => client.systemResources(), (r) => (r?.memory ? [] : ['memory missing']));
await check('systemInformation', () => client.systemInformation(), (r) => (r?.versions ? [] : ['versions missing']));

fs.mkdirSync(config.dataDir, { recursive: true });
const out = path.join(config.dataDir, 'probe.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nfull report (shapes + samples, contains your IPs): ${out}`);
