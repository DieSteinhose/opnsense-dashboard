import net from 'node:net';

// IPv4 -> BigInt, IPv6 -> BigInt. Both families share one numeric space
// (IPv4 below 2^32), which keeps range lookups simple.
export function ipToBigInt(ip) {
  if (!ip) return null;
  ip = String(ip).replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(ip);
  if (family === 4) {
    return ip.split('.').reduce((acc, p) => (acc << 8n) + BigInt(Number(p)), 0n);
  }
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:1.2.3.4)
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return ipToBigInt(mapped[1]);
    let [head, tail] = ip.split('::');
    const h = head ? head.split(':') : [];
    let t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
    if (t.length && t[t.length - 1].includes('.')) {
      const v4 = ipToBigInt(t.pop());
      t.push(((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));
    }
    const fill = tail !== undefined ? 8 - h.length - t.length : 0;
    const parts = [...h, ...Array(fill).fill('0'), ...t];
    return parts.reduce((acc, p) => (acc << 16n) + BigInt(parseInt(p || '0', 16)), 0n) | (1n << 128n);
  }
  return null;
}

export function ipFamily(ip) {
  return net.isIP(String(ip || '').split('%')[0]);
}

export function parseCidr(cidr) {
  const [addr, bitsStr] = String(cidr).trim().split('/');
  const fam = ipFamily(addr);
  if (!fam) return null;
  const width = fam === 4 ? 32 : 128;
  const bits = bitsStr === undefined ? width : Number(bitsStr);
  if (!(bits >= 0 && bits <= width)) return null;
  const value = ipToBigInt(addr);
  const hostBits = BigInt(width - bits);
  const base = fam === 4 ? value : value & ~(1n << 128n);
  const start = (base >> hostBits) << hostBits;
  const end = start + (1n << hostBits) - 1n;
  const tag = fam === 6 ? 1n << 128n : 0n;
  return { cidr, family: fam, start: start | tag, end: end | tag };
}

export class CidrSet {
  constructor(cidrs = []) {
    this.ranges = [];
    for (const c of cidrs) this.add(c);
  }
  add(cidr) {
    const r = parseCidr(cidr);
    if (r && !this.ranges.some((x) => x.start === r.start && x.end === r.end)) this.ranges.push(r);
    return this;
  }
  has(ip) {
    const v = ipToBigInt(ip);
    if (v === null) return false;
    return this.ranges.some((r) => v >= r.start && v <= r.end);
  }
}

// RFC1918, CGNAT, ULA, link-local, loopback, multicast. Not "the internet".
export const NON_PUBLIC = new CidrSet([
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '224.0.0.0/4', '255.255.255.255/32', '0.0.0.0/8',
  '::1/128', '::/128', 'fc00::/7', 'fe80::/10', 'ff00::/8',
]);

export function isPublic(ip) {
  return ipFamily(ip) !== 0 && !NON_PUBLIC.has(ip);
}
