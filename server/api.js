// HTTP API consumed by the dashboard. All byte values are bytes, all rates bits/s.
const RANGES = {
  '1h': { secs: 3600, step: 60 },
  '6h': { secs: 6 * 3600, step: 120 },
  '24h': { secs: 86400, step: 600 },
  '7d': { secs: 7 * 86400, step: 3600 },
  '30d': { secs: 30 * 86400, step: 6 * 3600 },
};

export function rangeOf(name) {
  return RANGES[name] ? { name, ...RANGES[name] } : { name: '24h', ...RANGES['24h'] };
}

// YYYY-MM-DD in the process time zone (TZ). Built by hand: Alpine's Node ships
// without full ICU, so locale based formatting is not reliable there.
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (tsSec) => {
  const d = new Date(tsSec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function createApi({ collector, store, classifier, dns, asn, config, version }) {
  const wanKeys = () => {
    const known = [...collector.ifaces.values()].filter((i) => i.wan).map((i) => i.key);
    return known.length ? known : config.wanInterfaces;
  };
  const now = () => Math.floor(Date.now() / 1000);

  const routes = {
    'GET /api/meta': () => ({
      version,
      demo: config.demo,
      lang: config.lang,
      hostname: collector.status.info?.name || '',
      firmware: collector.status.info?.versions?.[0] || '',
      wan: wanKeys(),
      interfaces: [...collector.ifaces.values()].map(({ key, name, wan }) => ({ key, name, wan })),
      categories: classifier.categories,
      services: classifier.services,
      features: {
        dnsNames: dns.size,
        asnRanges: asn?.count || 0,
        localNets: collector.localNets.ranges.map((r) => r.cidr),
      },
      health: collector.health,
      since: store.firstTs(),
    }),

    'GET /api/live': () => {
      const ifaces = [...collector.ifaces.values()].map((i) => ({ key: i.key, name: i.name, wan: i.wan, rx: i.rxBps, tx: i.txBps }));
      const today = startOfLocalDay(Date.now());
      const per = Object.fromEntries(store.trafficPerIface(today, now() + 60).map((r) => [r.iface, r]));
      const wan = wanKeys();
      const todayWan = wan.reduce((a, k) => ({ rx: a.rx + (per[k]?.rx || 0), tx: a.tx + (per[k]?.tx || 0) }), { rx: 0, tx: 0 });
      const clientsOnline = new Set([...collector.topTalkers.clients.map((c) => c.ip), ...collector.liveFlows.clients.map((c) => c.extra?.ip || c.key)]).size;
      return {
        ts: Date.now(),
        series: collector.live,
        interfaces: ifaces.map((i) => ({ ...i, today: per[i.key] || { rx: 0, tx: 0 } })),
        today: todayWan,
        gateways: collector.status.gateways,
        system: collector.status.system,
        states: collector.status.states,
        clientsOnline,
        flows: collector.liveFlows,
        talkers: collector.topTalkers,
      };
    },

    'GET /api/history': (q) => {
      const r = rangeOf(q.range);
      const to = now();
      const from = Math.floor((to - r.secs) / r.step) * r.step;
      const ifaces = q.iface ? [q.iface] : wanKeys();
      const rows = store.trafficSeries(ifaces, from, to + r.step, r.step);
      const byTs = new Map(rows.map((x) => [x.b, x]));
      const points = [];
      for (let t = from; t <= to; t += r.step) {
        const x = byTs.get(t);
        // bytes per bucket -> average bits per second
        points.push([t * 1000, x ? (x.rx * 8) / r.step : 0, x ? (x.tx * 8) / r.step : 0, x?.rx || 0, x?.tx || 0]);
      }
      const total = rows.reduce((a, x) => ({ rx: a.rx + x.rx, tx: a.tx + x.tx }), { rx: 0, tx: 0 });
      return { range: r.name, step: r.step, ifaces, points, total };
    },

    'GET /api/daily': (q) => {
      const days = Math.min(Math.max(Number(q.days) || 14, 1), 90);
      const start = startOfLocalDay(Date.now() - (days - 1) * 86400000);
      const end = now() + 3600;
      const out = new Map();
      for (let i = 0; i < days; i++) {
        const key = dayKey(start + i * 86400 + 7200);
        out.set(key, { day: key, rx: 0, tx: 0, categories: {} });
      }
      for (const h of store.hourly(wanKeys(), start, end)) {
        const d = out.get(dayKey(h.ts));
        if (d) (d.rx += h.rx), (d.tx += h.tx);
      }
      collector.flush();
      for (const h of store.flowHourly('category', start, end)) {
        const d = out.get(dayKey(h.ts));
        if (d) d.categories[h.key] = (d.categories[h.key] || 0) + h.rx + h.tx;
      }
      return { days: [...out.values()] };
    },

    'GET /api/breakdown': (q) => {
      const kind = ['service', 'category', 'client', 'asn', 'country', 'dest'].includes(q.kind) ? q.kind : 'service';
      const r = rangeOf(q.range);
      const limit = Math.min(Number(q.limit) || 10, 100);
      const to = now() + 3600;
      const from = Math.floor((now() - r.secs) / 3600) * 3600;
      collector.flush();
      const rows = store.flowTop(kind, from, to, limit).map((x) => ({
        key: x.key,
        label: x.label || x.key,
        extra: x.extra ? JSON.parse(x.extra) : null,
        rx: x.rx,
        tx: x.tx,
      }));
      if (kind === 'client') {
        for (const row of rows) {
          const c = collector.clientByKey(row.key);
          row.label = c.name || row.label;
          row.extra = { ...row.extra, vendor: c.vendor || row.extra?.vendor };
        }
      }
      if (kind === 'service') {
        for (const row of rows) {
          const svc = classifier.serviceById.get(row.key);
          row.label = svc?.name || row.label;
          row.extra = { ...row.extra, category: svc?.category || row.extra?.category };
        }
      }
      if (kind === 'category') for (const row of rows) row.label = classifier.categoryById.get(row.key)?.label || row.label;
      const tracked = store.flowTotal(kind, from, to);
      const wan = store.hourly(wanKeys(), from, to).reduce((a, x) => ({ rx: a.rx + x.rx, tx: a.tx + x.tx }), { rx: 0, tx: 0 });
      // Short lived connections can open and close between two state polls; that traffic
      // shows up in the interface counters but not in the states. Report it honestly.
      const untracked = { rx: Math.max(0, wan.rx - tracked.rx), tx: Math.max(0, wan.tx - tracked.tx) };
      return { kind, range: r.name, rows, tracked, wan, untracked };
    },
  };

  return function handle(method, pathname, query) {
    const fn = routes[`${method} ${pathname}`];
    return fn ? fn(query) : undefined;
  };
}
