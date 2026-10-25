import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so the app runs without extra dependencies.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));

export const config = {
  demo: bool(env.DEMO, false),
  lang: /^en/i.test(env.LANGUAGE || '') ? 'en' : 'de',
  port: num(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  opnsense: {
    url: (env.OPNSENSE_URL || '').replace(/\/+$/, ''),
    key: env.OPNSENSE_KEY || '',
    secret: env.OPNSENSE_SECRET || '',
    insecure: bool(env.OPNSENSE_INSECURE, true),
    ca: env.OPNSENSE_CA || '',
    timeoutMs: num(env.OPNSENSE_TIMEOUT_MS, 15000),
  },
  wanInterfaces: list(env.WAN_INTERFACES || 'wan'),
  localNets: list(env.LOCAL_NETS),
  asnLookup: bool(env.ASN_LOOKUP, true),
  servicesFile: env.SERVICES_FILE || path.join(ROOT, 'config', 'services.json'),
  intervals: {
    traffic: num(env.POLL_TRAFFIC_MS, 2000),
    states: num(env.POLL_STATES_MS, 15000),
    top: num(env.POLL_TOP_MS, 10000),
    dns: num(env.POLL_DNS_MS, 60000),
    status: num(env.POLL_STATUS_MS, 30000),
    meta: num(env.POLL_META_MS, 300000),
  },
  maxStates: num(env.MAX_STATES, 20000),
  retention: {
    minuteDays: num(env.RETENTION_MINUTE_DAYS, 7),
    hourDays: num(env.RETENTION_HOUR_DAYS, 400),
    flowDays: num(env.RETENTION_FLOW_DAYS, 90),
    destDays: num(env.RETENTION_DEST_DAYS, 14),
  },
};
