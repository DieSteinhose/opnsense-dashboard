import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import https from 'node:https';
import { ipFamily, ipToBigInt } from './ip.js';

// Offline IP -> ASN lookup based on the free iptoasn.com dataset (public domain).
// IPv4 ranges live in Uint32Arrays, IPv6 ranges are reduced to their upper 64 bits.
const SOURCE = 'https://iptoasn.com/data/ip2asn-combined.tsv.gz';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export class AsnDb {
  constructor(dataDir, log = console) {
    this.file = path.join(dataDir, 'ip2asn-combined.tsv.gz');
    this.log = log;
    this.loaded = false;
    this.count = 0;
    this.cache = new Map();
  }

  async init() {
    try {
      const stat = fs.existsSync(this.file) ? fs.statSync(this.file) : null;
      if (!stat || Date.now() - stat.mtimeMs > MAX_AGE_MS) await this.download();
      await this.load();
    } catch (err) {
      this.log.warn(`[asn] lookup disabled: ${err.message}`);
    }
    // weekly refresh
    setInterval(() => this.download().then(() => this.load()).catch((e) => this.log.warn(`[asn] refresh failed: ${e.message}`)), MAX_AGE_MS).unref();
  }

  download() {
    this.log.info('[asn] downloading ' + SOURCE);
    const tmp = this.file + '.part';
    return new Promise((resolve, reject) => {
      const get = (url, redirects = 0) =>
        https
          .get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
              res.resume();
              return get(new URL(res.headers.location, url).toString(), redirects + 1);
            }
            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error(`download HTTP ${res.statusCode}`));
            }
            const out = fs.createWriteStream(tmp);
            res.pipe(out);
            out.on('finish', () => out.close(() => (fs.renameSync(tmp, this.file), resolve())));
            out.on('error', reject);
          })
          .on('error', reject);
      get(SOURCE);
    });
  }

  async load() {
    const v4s = [], v4e = [], v4i = [];
    const v6s = [], v6e = [], v6i = [];
    const infos = [];
    const infoIndex = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(this.file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      const [start, end, asn, country, ...descr] = line.split('\t');
      if (!asn || asn === '0') continue;
      const key = asn;
      let idx = infoIndex.get(key);
      if (idx === undefined) {
        idx = infos.length;
        infos.push({ asn: Number(asn), country: country === 'None' ? '' : country, name: cleanName(descr.join(' ')) });
        infoIndex.set(key, idx);
      }
      if (ipFamily(start) === 4) {
        v4s.push(Number(ipToBigInt(start)));
        v4e.push(Number(ipToBigInt(end)));
        v4i.push(idx);
      } else if (ipFamily(start) === 6) {
        v6s.push(hi64(start));
        v6e.push(hi64(end));
        v6i.push(idx);
      }
    }
    this.v4 = { s: Uint32Array.from(v4s), e: Uint32Array.from(v4e), i: Uint32Array.from(v4i) };
    this.v6 = { s: BigUint64Array.from(v6s), e: BigUint64Array.from(v6e), i: Uint32Array.from(v6i) };
    this.infos = infos;
    this.count = v4s.length + v6s.length;
    this.loaded = true;
    this.cache.clear();
    this.log.info(`[asn] loaded ${this.count} ranges, ${infos.length} networks`);
  }

  lookup(ip) {
    if (!this.loaded || !ip) return null;
    if (this.cache.has(ip)) return this.cache.get(ip);
    const fam = ipFamily(ip);
    let res = null;
    if (fam === 4) res = search(this.v4, Number(ipToBigInt(ip)), this.infos);
    else if (fam === 6) res = search(this.v6, hi64(ip), this.infos);
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(ip, res);
    return res;
  }
}

function hi64(ip) {
  return (ipToBigInt(ip) >> 64n) & 0xffffffffffffffffn;
}

function search({ s, e, i }, v, infos) {
  let lo = 0, hi = s.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= v) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && v <= e[found] ? infos[i[found]] : null;
}

// "VALVE-CORPORATION - Valve Corporation" -> "Valve Corporation"
function cleanName(name) {
  const parts = name.split(' - ');
  const pick = parts.length > 1 ? parts.slice(1).join(' - ') : parts[0];
  return pick.replace(/,\s*[A-Z]{2}$/, '').trim() || name.trim();
}
