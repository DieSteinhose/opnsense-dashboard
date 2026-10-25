import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Storage layout:
//  traffic_min   interface byte counters per minute (realtime-ish history, a few days)
//  traffic_hour  interface byte counters per hour (long term, daily trend)
//  flow_hour     classified traffic per hour and dimension (service, category, client, asn, country, dest)
export class Store {
  constructor(dataDir) {
    const file = path.join(dataDir, 'insight.db');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      this.db = new DatabaseSync(file);
    } catch (err) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
      throw new Error(`cannot open ${file} (${err.message}). The data directory must be writable for uid ${uid}, e.g. "sudo chown -R ${uid}:${uid} ./data" on the Docker host.`, { cause: err });
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS traffic_min (ts INTEGER NOT NULL, iface TEXT NOT NULL, rx INTEGER NOT NULL, tx INTEGER NOT NULL, PRIMARY KEY (ts, iface)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS traffic_hour (ts INTEGER NOT NULL, iface TEXT NOT NULL, rx INTEGER NOT NULL, tx INTEGER NOT NULL, PRIMARY KEY (ts, iface)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS flow_hour (ts INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, label TEXT, extra TEXT, rx INTEGER NOT NULL, tx INTEGER NOT NULL, PRIMARY KEY (ts, kind, key)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS flow_kind_ts ON flow_hour (kind, ts);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    `);
    const upsert = (table) =>
      this.db.prepare(`INSERT INTO ${table} (ts, iface, rx, tx) VALUES (?, ?, ?, ?)
        ON CONFLICT (ts, iface) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx`);
    this.stmt = {
      min: upsert('traffic_min'),
      hour: upsert('traffic_hour'),
      flow: this.db.prepare(`INSERT INTO flow_hour (ts, kind, key, label, extra, rx, tx) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ts, kind, key) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx,
        label = COALESCE(excluded.label, label), extra = COALESCE(excluded.extra, extra)`),
      kvGet: this.db.prepare('SELECT v FROM kv WHERE k = ?'),
      kvSet: this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  addTraffic(tsSec, iface, rx, tx) {
    const min = tsSec - (tsSec % 60);
    const hour = tsSec - (tsSec % 3600);
    this.stmt.min.run(min, iface, Math.round(rx), Math.round(tx));
    this.stmt.hour.run(hour, iface, Math.round(rx), Math.round(tx));
  }

  addFlow(hourTs, kind, key, label, extra, rx, tx) {
    this.stmt.flow.run(hourTs, kind, key, label ?? null, extra ? JSON.stringify(extra) : null, Math.round(rx), Math.round(tx));
  }

  // Bucketed series for one or more interfaces. Buckets are aligned to `step` seconds.
  trafficSeries(ifaces, fromSec, toSec, step) {
    const table = step >= 3600 ? 'traffic_hour' : 'traffic_min';
    const marks = ifaces.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT (ts / ?) * ? AS b, SUM(rx) AS rx, SUM(tx) AS tx FROM ${table}
        WHERE ts >= ? AND ts < ? AND iface IN (${marks}) GROUP BY b ORDER BY b`)
      .all(step, step, fromSec, toSec, ...ifaces);
    return rows;
  }

  trafficPerIface(fromSec, toSec) {
    const table = toSec - fromSec > 2 * 86400 ? 'traffic_hour' : 'traffic_min';
    return this.db
      .prepare(`SELECT iface, SUM(rx) AS rx, SUM(tx) AS tx FROM ${table} WHERE ts >= ? AND ts < ? GROUP BY iface`)
      .all(fromSec, toSec);
  }

  hourly(ifaces, fromSec, toSec) {
    const marks = ifaces.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT ts, SUM(rx) AS rx, SUM(tx) AS tx FROM traffic_hour WHERE ts >= ? AND ts < ? AND iface IN (${marks}) GROUP BY ts ORDER BY ts`)
      .all(fromSec, toSec, ...ifaces);
  }

  flowTop(kind, fromSec, toSec, limit = 10) {
    return this.db
      .prepare(`SELECT key, MAX(label) AS label, MAX(extra) AS extra, SUM(rx) AS rx, SUM(tx) AS tx FROM flow_hour
        WHERE kind = ? AND ts >= ? AND ts < ? GROUP BY key ORDER BY SUM(rx) + SUM(tx) DESC LIMIT ?`)
      .all(kind, fromSec, toSec, limit);
  }

  flowTotal(kind, fromSec, toSec) {
    return this.db
      .prepare('SELECT COALESCE(SUM(rx), 0) AS rx, COALESCE(SUM(tx), 0) AS tx FROM flow_hour WHERE kind = ? AND ts >= ? AND ts < ?')
      .get(kind, fromSec, toSec);
  }

  flowHourly(kind, fromSec, toSec) {
    return this.db
      .prepare('SELECT ts, key, rx, tx FROM flow_hour WHERE kind = ? AND ts >= ? AND ts < ? ORDER BY ts')
      .all(kind, fromSec, toSec);
  }

  firstTs() {
    return this.db.prepare('SELECT MIN(ts) AS ts FROM traffic_hour').get()?.ts ?? null;
  }

  kv(k, v) {
    if (v === undefined) {
      const row = this.stmt.kvGet.get(k);
      return row ? JSON.parse(row.v) : null;
    }
    this.stmt.kvSet.run(k, JSON.stringify(v));
  }

  prune(retention, nowSec = Math.floor(Date.now() / 1000)) {
    const d = 86400;
    this.db.prepare('DELETE FROM traffic_min WHERE ts < ?').run(nowSec - retention.minuteDays * d);
    this.db.prepare('DELETE FROM traffic_hour WHERE ts < ?').run(nowSec - retention.hourDays * d);
    this.db.prepare("DELETE FROM flow_hour WHERE kind <> 'dest' AND ts < ?").run(nowSec - retention.flowDays * d);
    this.db.prepare("DELETE FROM flow_hour WHERE kind = 'dest' AND ts < ?").run(nowSec - retention.destDays * d);
  }
}
