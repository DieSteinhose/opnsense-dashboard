import { areaChart, barChart, donutChart, sparkline, redrawAll, cssVar, tipHtml } from './charts.js';
import { t, lang, locale, applyStatic } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const nf = (d = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: d, minimumFractionDigits: 0 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- formatting ----------
// Rates are always shown in Mbit/s, small values get more decimals instead of a smaller unit
function bitsParts(bps) {
  const v = Math.max(0, bps || 0) / 1e6;
  if (v > 0 && v < 0.01) return [`< ${nf(2).format(0.01)}`, 'Mbit/s'];
  return [nf(v >= 100 ? 0 : v >= 10 ? 1 : 2).format(v), 'Mbit/s'];
}
// axis ticks: Mbit without "/s", decimals only where the scale needs them
const fmtAxisMbit = (bps) => {
  const v = bps / 1e6;
  return `${nf(v === 0 || v >= 10 ? 0 : v >= 1 ? 1 : 3).format(v)} Mbit`;
};
function bytesParts(b) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let v = Math.max(0, b || 0), i = 0;
  while (v >= 1000 && i < units.length - 1) (v /= 1000), i++;
  return [nf(v >= 100 ? 0 : 1).format(v), units[i]];
}
const fmtBits = (v) => bitsParts(v).join(' ');
const fmtBytes = (v) => bytesParts(v).join(' ');
const htmlUnit = ([v, u]) => `${v}<small>${u}</small>`;
const pct = (a, b) => (b > 0 ? nf(1).format((a / b) * 100) + ' %' : '–');
const time = (ms) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const timeSec = (ms) => new Date(ms).toLocaleTimeString(locale);
const dateTime = (ms) => new Date(ms).toLocaleString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
const dayLong = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' });
const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐');
const COUNTRY = new Intl.DisplayNames([lang], { type: 'region' });
const countryName = (cc) => { try { return COUNTRY.of(cc); } catch { return cc; } };
const RANGE_LABEL = Object.fromEntries(['1h', '24h', '7d', '30d'].map((r) => [r, t(`rangeLong.${r}`)]));

// ---------- state ----------
const ui = load('ui', { range: '24h', tpMode: 'live', dailyMode: 'dir', dailyDays: 14, nowMode: 'services', theme: 'dark' });
let meta = null, live = null, liveSeries = [], lastTick = 0, history = null, daily = null;
const breakdowns = {};

function load(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return def; }
}
function save() {
  try { localStorage.setItem('ui', JSON.stringify(ui)); } catch { /* private mode */ }
}
async function get(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

// ---------- categories & colors (color follows the category, never the rank) ----------
const catIndex = () => new Map((meta?.categories || []).map((c, i) => [c.id, i]));
function catColor(id) {
  if (id === '_untracked') return '--other';
  const i = catIndex().get(id);
  return i === undefined ? '--other' : `--c${(i % 8) + 1}`;
}
const catLabel = (id) => (id === '_untracked' ? t('cat.untracked') : meta?.categories.find((c) => c.id === id)?.label || id);
const svcCat = (id) => meta?.services.find((s) => s.id === id)?.category;

// ---------- charts ----------
const tp = areaChart($('#tp-chart'), $('#tp-tip'), {
  mirror: true,
  fmtY: (v, exact) => (exact ? fmtBits(v) : fmtAxisMbit(v)),
  fmtX: (ms) => (ui.tpMode === 'live' ? timeSec(ms) : ui.range === '30d' || ui.range === '7d' ? new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) : time(ms)),
  fmtHead: (ms) => (ui.tpMode === 'live' ? timeSec(ms) : dateTime(ms)),
});
const heroSpark = sparkline($('#hero-spark'), { color: '--dl', fill: '--dl-fill', color2: '--ul', fill2: '--ul-fill' });
const donut = donutChart($('#cat-donut'), $('#cat-tip'), {
  fmtV: fmtBytes,
  fmtShare: (v, total) => pct(v, total),
  labels: { value: t('tip.traffic'), share: t('tip.share') },
  onHover: (i) => document.querySelectorAll('#cat-legend li').forEach((li, k) => li.classList.toggle('hl', k === i)),
});
const dailyChart = barChart($('#daily-chart'), $('#daily-tip'), {
  fmtY: (v) => fmtBytes(v),
  fmtTip: (i, d) => {
    const rows = d.stacks.filter((s) => s.values[i] > 0).map((s) => ({ name: s.name, color: cssVar(s.color), value: fmtBytes(s.values[i]) }));
    if (d.mode === 'stack') rows.reverse();
    const sum = d.stacks.reduce((a, s) => a + (s.values[i] || 0), 0);
    return tipHtml(dayLong(daily.days[i].day), [...rows, { name: t('daily.sum'), color: 'transparent', value: fmtBytes(sum) }]);
  },
});
const ifSparks = new Map();

// ---------- render: live ----------
function renderTick() {
  const last = liveSeries[liveSeries.length - 1];
  if (last) {
    $('#wan-rx').innerHTML = htmlUnit(bitsParts(last.rx));
    $('#wan-tx').innerHTML = htmlUnit(bitsParts(last.tx));
  }
  const tail = liveSeries.slice(-90);
  heroSpark.update(tail.map((p) => p.rx), tail.map((p) => p.tx));
  if (ui.tpMode === 'live') {
    tp.update({
      x: liveSeries.map((p) => p.ts),
      series: [
        { name: 'Download', color: '--dl', fill: '--dl-fill', values: liveSeries.map((p) => p.rx) },
        { name: 'Upload', color: '--ul', fill: '--ul-fill', values: liveSeries.map((p) => p.tx) },
      ],
    });
    const peak = Math.max(0, ...liveSeries.map((p) => p.rx));
    const avg = liveSeries.reduce((a, p) => a + p.rx, 0) / Math.max(1, liveSeries.length);
    const span = liveSeries.length > 1 ? (liveSeries[liveSeries.length - 1].ts - liveSeries[0].ts) / 1000 : 0;
    $('#tp-foot').textContent = t('tp.footLive', {
      span: span < 120 ? t('unit.seconds', { n: Math.round(span) }) : t('unit.minutes', { n: Math.round(span / 60) }),
      peak: fmtBits(peak),
      avg: fmtBits(avg),
    });
  }
  for (const [key, sp] of ifSparks) {
    const pts = liveSeries.slice(-90).map((p) => p.ifaces?.[key] || [0, 0]);
    sp.update(pts.map((x) => x[0]), pts.map((x) => x[1]));
  }
  if (last?.ifaces) {
    for (const [key, [rx, tx]] of Object.entries(last.ifaces)) {
      const row = document.querySelector(`#if-body tr[data-key="${CSS.escape(key)}"]`);
      if (!row) continue;
      row.querySelector('.rx-now').textContent = fmtBits(rx);
      row.querySelector('.tx-now').textContent = fmtBits(tx);
    }
  }
}

function gwClass(g) {
  if (!g) return '';
  if (/down|force_down/i.test(g.status)) return 'bad';
  if (/loss|delay/i.test(g.status) || g.loss > 2) return 'warn';
  return 'good';
}

function renderLive() {
  if (!live) return;
  const gws = live.gateways || [];
  const gw = gws[0];
  const st = $('#wan-status');
  st.className = 'status ' + gwClass(gw);
  st.querySelector('span').textContent = gw ? t(`internet.${{ good: 'online', warn: 'degraded', bad: 'offline' }[gwClass(gw)]}`) : t('internet.noGateway');
  $('#wan-latency').textContent = gw?.delay != null ? `${nf(1).format(gw.delay)} ms` : '–';
  $('#wan-loss').textContent = gw ? `${nf(1).format(gw.loss || 0)} %` : '–';
  $('#wan-gw').textContent = gw?.name || '–';

  $('#today-rx').innerHTML = htmlUnit(bytesParts(live.today.rx));
  $('#today-tx').innerHTML = htmlUnit(bytesParts(live.today.tx));
  const yday = daily?.days?.[daily.days.length - 2];
  if (yday) {
    $('#today-rx-s').textContent = t('tile.yesterday', { v: fmtBytes(yday.rx) });
    $('#today-tx-s').textContent = t('tile.yesterday', { v: fmtBytes(yday.tx) });
  }
  $('#states').textContent = nf(0).format(live.states || 0);
  $('#clients-online').textContent = nf(0).format(live.clientsOnline || 0);

  // interfaces table (rows are created once, live cells updated per tick)
  const body = $('#if-body');
  for (const it of live.interfaces) {
    let row = body.querySelector(`tr[data-key="${CSS.escape(it.key)}"]`);
    if (!row) {
      row = document.createElement('tr');
      row.dataset.key = it.key;
      row.innerHTML = `<td><span class="if-name"><span class="n"></span>${it.wan ? '<span class="if-tag">WAN</span>' : ''}</span><span class="muted small key"></span></td>
        <td class="num rx-now"></td><td class="num tx-now"></td><td class="num rx-day"></td><td class="num tx-day"></td><td class="spark-col"><canvas></canvas></td>`;
      body.appendChild(row);
      ifSparks.set(it.key, sparkline(row.querySelector('canvas'), { color: '--dl', fill: null, color2: '--ul', fill2: null }));
    }
    row.querySelector('.n').textContent = it.name;
    row.querySelector('.key').textContent = it.name.toLowerCase() === it.key ? '' : ` ${it.key}`;
    // for the WAN "received" is download; on LAN-side interfaces the firewall transmits what clients download
    row.querySelector('.rx-now').textContent = fmtBits(it.rx);
    row.querySelector('.tx-now').textContent = fmtBits(it.tx);
    row.querySelector('.rx-day').textContent = fmtBytes(it.today.rx);
    row.querySelector('.tx-day').textContent = fmtBytes(it.today.tx);
  }

  // system
  const sys = live.system || {};
  const kv = [
    [t('sys.host'), meta?.hostname || '–'],
    [t('sys.version'), meta?.firmware || '–'],
    [t('sys.uptime'), (sys.time?.uptime || '–').replace('days', t('uptime.days')).replace(/\bday\b/, t('uptime.day'))],
    [t('sys.load'), sys.time?.loadavg || '–'],
  ];
  $('#sys-kv').innerHTML = kv.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('');
  const mem = sys.memory;
  if (mem && Number(mem.total) > 0 && Number(mem.used) >= 0) {
    $('#mem-v').textContent = `${fmtBytes(Number(mem.used))} / ${fmtBytes(Number(mem.total))}`;
    $('#mem-bar').style.width = `${Math.min(100, (Number(mem.used) / Number(mem.total)) * 100)}%`;
  }
  $('#gw-list').innerHTML = gws.map((g) => `<div class="gw"><span class="status ${gwClass(g)}"><i></i></span><span>${esc(g.name)}</span>
      <span class="gw-v">${g.delay != null ? nf(1).format(g.delay) + ' ms' : ''} · ${nf(1).format(g.loss || 0)} %</span></div>`).join('');

  renderNow();
}

// ---------- top lists ----------
const DEV_ICON = '<svg viewBox="0 0 24 24"><path d="M4 5h16v10H4V5Zm-2 0v10a2 2 0 0 0 2 2h6v2H7v2h10v-2h-3v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>';
const initials = (s) => String(s || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function listHtml(rows, { icon, name, sub, rate = false, empty = t('list.empty') }) {
  if (!rows.length) return `<li class="empty">${empty}</li>`;
  const max = Math.max(...rows.map((r) => r.rx + r.tx), 1);
  const fmt = rate ? fmtBits : fmtBytes;
  return rows
    .map((r) => {
      const wd = ((r.rx / max) * 100).toFixed(2), wu = ((r.tx / max) * 100).toFixed(2);
      return `<li title="${esc(name(r))}">
        ${icon(r)}
        <span class="tl-name">${esc(name(r))}</span>
        <span class="tl-val"><span class="d">↓ ${fmt(r.rx)}</span></span>
        <span class="tl-sub">${esc(sub(r))}</span>
        <span class="tl-val"><span class="u">↑ ${fmt(r.tx)}</span></span>
        <span class="tl-bar" aria-hidden="true"><i class="dl" style="width:${wd}%"></i><i class="ul" style="width:${wu}%"></i></span>
      </li>`;
    })
    .join('');
}
const svcIcon = (id, label) => `<span class="ico" style="background:var(${catColor(svcCat(id) || id)})">${esc(initials(label))}</span>`;
const LIST_DEF = {
  service: {
    icon: (r) => svcIcon(r.key, r.label),
    name: (r) => r.label,
    sub: (r) => catLabel(r.extra?.category || svcCat(r.key)),
  },
  client: {
    icon: () => `<span class="ico dev">${DEV_ICON}</span>`,
    name: (r) => (r.label && r.label !== r.key ? r.label : r.extra?.ip || r.key),
    sub: (r) => [r.extra?.ip && r.extra.ip !== r.label ? r.extra.ip : r.key !== r.label ? r.key : '', r.extra?.vendor].filter(Boolean).join(' · ') || t('cli.unknown'),
  },
  asn: {
    icon: (r) => `<span class="ico flag">${flag(r.extra?.country)}</span>`,
    name: (r) => r.label,
    sub: (r) => `AS${r.key}${r.extra?.country ? ' · ' + countryName(r.extra.country) : ''}`,
  },
  dest: {
    icon: (r) => svcIcon(r.extra?.service, r.label || r.key),
    name: (r) => r.label || r.key,
    sub: (r) => [meta?.services.find((s) => s.id === r.extra?.service)?.name, r.extra?.asn].filter(Boolean).join(' · '),
  },
  country: {
    icon: (r) => `<span class="ico flag">${flag(r.key)}</span>`,
    name: (r) => countryName(r.key),
    sub: (r) => r.key,
  },
};

function renderBreakdown(kind) {
  const b = breakdowns[kind];
  if (!b) return;
  $(`#list-${kind}`).innerHTML = listHtml(b.rows, LIST_DEF[kind]);
  if (kind === 'service') {
    const total = b.wan.rx + b.wan.tx;
    $('#svc-foot').textContent = total
      ? t('svc.foot', { p: pct(b.tracked.rx + b.tracked.tx, total) })
      : ' ';
  }
  if (kind === 'category') renderDonut();
}

function renderDonut() {
  const b = breakdowns.category;
  if (!b) return;
  const order = catIndex();
  const items = b.rows
    .map((r) => ({ id: r.key, name: catLabel(r.key), color: catColor(r.key), value: r.rx + r.tx }))
    .sort((x, y) => (order.get(x.id) ?? 99) - (order.get(y.id) ?? 99));
  const untracked = b.untracked.rx + b.untracked.tx;
  // only show the "not tracked" slice when it is noticeable
  if (untracked > 0.02 * (b.wan.rx + b.wan.tx)) items.push({ id: '_untracked', name: t('cat.untracked'), color: '--other', value: untracked });
  const total = items.reduce((a, x) => a + x.value, 0);
  donut.update(items);
  $('#cat-total').textContent = fmtBytes(total);
  $('#cat-range').textContent = RANGE_LABEL[ui.range];
  $('#cat-legend').innerHTML = items.length
    ? items.map((it, i) => `<li data-i="${i}"><i style="background:var(${it.color})"></i><span class="n">${esc(it.name)}</span><span class="v">${fmtBytes(it.value)}<span class="p">${pct(it.value, total)}</span></span></li>`).join('')
    : `<li class="muted">${t('cat.noData')}</li>`;
  document.querySelectorAll('#cat-legend li[data-i]').forEach((li) => {
    li.onmouseenter = () => donut.highlight(Number(li.dataset.i));
    li.onmouseleave = () => donut.highlight(-1);
  });
}

function renderNow() {
  const f = live?.flows || {};
  let html;
  const empty = f.ts ? t('now.quiet') : t('now.collecting');
  if (ui.nowMode === 'talkers') {
    const rows = (live?.talkers?.clients || []).slice(0, 8).map((c) => ({ key: c.ip, label: c.name || c.ip, extra: { vendor: [c.vendor, c.iface].filter(Boolean).join(' · ') }, rx: c.rx, tx: c.tx }));
    html = listHtml(rows, { ...LIST_DEF.client, sub: (r) => [r.label !== r.key ? r.key : '', r.extra.vendor].filter(Boolean).join(' · '), rate: true, empty });
  } else if (ui.nowMode === 'dests') {
    html = listHtml((f.dests || []).slice(0, 8), { ...LIST_DEF.dest, rate: true, empty });
  } else {
    html = listHtml((f.services || []).slice(0, 8), { ...LIST_DEF.service, rate: true, empty });
  }
  $('#list-now').innerHTML = html;
}

// ---------- history & daily ----------
function renderHistory() {
  if (ui.tpMode !== 'range' || !history) return;
  tp.update({
    x: history.points.map((p) => p[0]),
    series: [
      { name: 'Download', color: '--dl', fill: '--dl-fill', values: history.points.map((p) => p[1]) },
      { name: 'Upload', color: '--ul', fill: '--ul-fill', values: history.points.map((p) => p[2]) },
    ],
  });
  const peak = Math.max(0, ...history.points.map((p) => p[1]));
  $('#tp-foot').textContent = t('tp.footRange', {
    range: RANGE_LABEL[ui.range],
    rx: fmtBytes(history.total.rx),
    tx: fmtBytes(history.total.tx),
    peak: fmtBits(peak),
    step: history.step >= 3600 ? t('unit.hours', { n: history.step / 3600 }) : t('unit.min', { n: history.step / 60 }),
  });
}

function renderDaily() {
  if (!daily) return;
  const labels = daily.days.map((d) => dayLabel(d.day));
  let stacks;
  if (ui.dailyMode === 'cat') {
    const cats = meta?.categories || [];
    stacks = cats.map((c) => ({ name: c.label, color: catColor(c.id), values: daily.days.map((d) => d.categories[c.id] || 0) }));
    // traffic seen on the interfaces but not attributable to a connection
    stacks.push({ name: t('cat.untracked'), color: '--other', values: daily.days.map((d) => Math.max(0, d.rx + d.tx - Object.values(d.categories).reduce((a, x) => a + x, 0))) });
    stacks = stacks.filter((s) => s.values.some((v) => v > 0));
    dailyChart.update({ labels, stacks, mode: 'stack' });
  } else {
    stacks = [
      { name: t('internet.download'), color: '--dl', values: daily.days.map((d) => d.rx) },
      { name: t('internet.upload'), color: '--ul', values: daily.days.map((d) => d.tx) },
    ];
    dailyChart.update({ labels, stacks, mode: 'group' });
  }
  $('#daily-legend').innerHTML = stacks.map((s) => `<span class="lg" style="background:var(${s.color})"></span>${esc(s.name)}`).join(' ');
}

function renderFoot() {
  if (!meta) return;
  const parts = [];
  if (meta.since) parts.push(t('foot.since', { v: `<b>${new Date(meta.since * 1000).toLocaleDateString(locale)}</b>` }));
  parts.push(t('foot.dns', { v: `<b>${nf(0).format(meta.features.dnsNames)}</b>` }));
  parts.push(meta.features.asnRanges ? t('foot.asn', { v: `<b>${nf(0).format(meta.features.asnRanges)}</b>` }) : t('foot.asnOff'));
  parts.push(t('foot.localNets', { v: `<b>${esc(meta.features.localNets.join(', ') || '–')}</b>` }));
  const bad = Object.entries(meta.health || {}).filter(([, h]) => !h.ok);
  if (bad.length) parts.push(`<span class="warn">${t('foot.errors', { v: bad.map(([k, h]) => `${esc(k)} (${esc(h.error)})`).join(', ') })}</span>`);
  parts.push(`v${esc(meta.version)}`);
  $('#foot').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

// ---------- loading ----------
async function loadMeta() {
  meta = await get('/api/meta');
  $('#hostname').textContent = meta.hostname || 'OPNsense';
  $('#firmware').textContent = meta.firmware || '';
  $('#demo-badge').hidden = !meta.demo;
  renderFoot();
}
async function loadLive() {
  live = await get('/api/live');
  if (!liveSeries.length || live.series.length > liveSeries.length) liveSeries = live.series.slice();
  renderLive();
  renderTick();
}
async function loadBreakdowns() {
  const kinds = { service: 8, category: 20, client: 8, asn: 8, dest: 8, country: 8 };
  await Promise.all(Object.entries(kinds).map(async ([kind, limit]) => {
    breakdowns[kind] = await get(`/api/breakdown?kind=${kind}&range=${ui.range}&limit=${limit}`);
    if (kind !== 'category') renderBreakdown(kind);
  }));
  renderDonut();
  renderBreakdown('service');
  document.querySelectorAll('.range-label').forEach((el) => (el.textContent = RANGE_LABEL[ui.range]));
}
async function loadHistory() {
  history = await get(`/api/history?range=${ui.range}`);
  renderHistory();
}
async function loadDaily() {
  daily = await get(`/api/daily?days=${ui.dailyDays}`);
  renderDaily();
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    const p = JSON.parse(e.data);
    lastTick = Date.now();
    liveSeries.push(p);
    if (liveSeries.length > 300) liveSeries.shift();
    renderTick();
  };
  es.onerror = () => $('#live-pill').classList.add('down');
  es.onopen = () => $('#live-pill').classList.remove('down');
}

// ---------- controls ----------
function seg(id, key, attr, onChange) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(ui[key]) === b.dataset[attr]));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui[key] = attr === 'days' ? Number(b.dataset[attr]) : b.dataset[attr];
    save();
    sync();
    onChange();
  });
  sync();
}
seg('#range-seg', 'range', 'range', () => {
  loadBreakdowns();
  loadHistory();
});
seg('#tp-mode', 'tpMode', 'mode', () => (ui.tpMode === 'live' ? renderTick() : loadHistory()));
seg('#daily-mode', 'dailyMode', 'mode', renderDaily);
seg('#daily-days', 'dailyDays', 'days', loadDaily);
seg('#now-mode', 'nowMode', 'mode', renderNow);

function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  redrawAll();
  renderBreakdown('service');
}
$('#theme-toggle').addEventListener('click', () => {
  ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
  save();
  applyTheme();
});

// highlight current section in the rail
const railLinks = [...document.querySelectorAll('.rail-item[href]')];
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const id = en.target.id;
    railLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
  }
}, { rootMargin: '-40% 0px -55% 0px' });
['top', 'sec-traffic', 'sec-services', 'sec-clients', 'sec-system'].forEach((id) => document.getElementById(id) && io.observe(document.getElementById(id)));

// ---------- boot ----------
document.documentElement.dataset.theme = ui.theme;
applyStatic();
document.querySelectorAll('#daily-days button').forEach((b) => (b.textContent = t('daily.days', { n: b.dataset.days })));
const safe = (fn) => () => fn().catch((err) => console.warn(err));
(async () => {
  await safe(loadMeta)();
  await Promise.all([safe(loadLive)(), safe(loadBreakdowns)(), safe(loadDaily)(), safe(loadHistory)()]);
  renderLive();
  connectStream();
  setInterval(safe(loadLive), 5000);
  setInterval(safe(loadBreakdowns), 60000);
  setInterval(safe(loadHistory), 60000);
  setInterval(safe(loadDaily), 300000);
  setInterval(safe(loadMeta), 60000);
  setInterval(() => $('#live-pill').classList.toggle('stale', Date.now() - lastTick > 10000), 2000);
})();
