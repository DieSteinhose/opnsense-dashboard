import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { OpnsenseClient } from './opnsense.js';
import { MockClient } from './mock.js';
import { Store } from './db.js';
import { DnsMap } from './dnsmap.js';
import { AsnDb } from './asn.js';
import { Classifier } from './classifier.js';
import { Collector } from './collector.js';
import { createApi } from './api.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
};

const store = new Store(config.demo ? path.join(config.dataDir, 'demo') : config.dataDir);
const dns = new DnsMap();
const asn = config.asnLookup ? new AsnDb(config.dataDir, log) : null;
const classifier = new Classifier(config.servicesFile, { dns, asn, lang: config.lang });
const client = config.demo ? new MockClient({ store, wan: config.wanInterfaces[0] }) : new OpnsenseClient(config.opnsense);
const collector = new Collector({ client, store, classifier, dns, config, log });
const api = createApi({ collector, store, classifier, dns, asn, config, version: pkg.version });

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

let indexCache = null;
function indexHtml() {
  if (!indexCache) indexCache = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('<html lang="de"', `<html lang="${config.lang}"`);
  return indexCache;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const query = Object.fromEntries(url.searchParams);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const onTick = (point) => res.write(`data: ${JSON.stringify(point)}\n\n`);
    collector.on('tick', onTick);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => (collector.off('tick', onTick), clearInterval(ping)));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      const out = api(req.method, url.pathname, query);
      return out === undefined ? send(res, 404, { error: 'not found' }) : send(res, 200, out);
    } catch (err) {
      log.warn('[api]', url.pathname, err);
      return send(res, 500, { error: err.message });
    }
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    // the UI language is set via LANGUAGE in .env and stamped into <html lang>
    return send(res, 200, indexHtml(), 'text/html; charset=utf-8');
  }
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(config.port, config.host, async () => {
  log.info(`[http] OPNsense Insight ${pkg.version} on http://${config.host}:${config.port}${config.demo ? ' (DEMO mode)' : ''}, language ${config.lang}`);
  if (asn) asn.init(); // runs in the background, lookups start once loaded
  await collector.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    collector.stop();
    server.close();
    process.exit(0);
  });
}
