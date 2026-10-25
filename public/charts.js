// Small canvas chart kit: area/line, bars (stacked or grouped), donut, sparkline.
// Colors come from CSS custom properties so a theme switch only needs a redraw.
const charts = new Set();
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function redrawAll() {
  charts.forEach((c) => c.draw());
}

function setup(canvas, draw) {
  const ctx = canvas.getContext('2d');
  const state = { w: 0, h: 0 };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.w = r.width;
    state.h = r.height;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };
  new ResizeObserver(resize).observe(canvas);
  return { ctx, state, resize };
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function roundTop(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, Math.abs(h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function placeTip(tip, wrapW, x, y) {
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = x + 14;
  if (left + tw > wrapW) left = x - tw - 14;
  tip.style.left = Math.max(0, left) + 'px';
  tip.style.top = Math.max(0, y - th / 2) + 'px';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function tipHtml(head, rows) {
  return `<div class="t-h">${esc(head)}</div>` +
    rows.map((r) => `<div class="t-r"><span><i style="background:${r.color}"></i>${esc(r.name)}</span><b>${esc(r.value)}</b></div>`).join('');
}

const PAD = { l: 64, r: 12, t: 10, b: 24 };

// --- area chart -------------------------------------------------------------
export function areaChart(canvas, tip, { fmtY, fmtX, fmtHead }) {
  let data = { x: [], series: [] };
  let hover = -1;
  const { ctx, state } = setup(canvas, () => draw());

  function draw() {
    const { w, h } = state;
    ctx.clearRect(0, 0, w, h);
    const n = data.x.length;
    const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
    const max = niceMax(Math.max(1, ...data.series.flatMap((s) => s.values)));
    const X = (i) => PAD.l + (n <= 1 ? iw : (i / (n - 1)) * iw);
    const Y = (v) => PAD.t + ih - (v / max) * ih;
    // grid + y labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = i === 0 ? cssVar('--axis') : cssVar('--grid');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = cssVar('--muted');
      ctx.fillText(fmtY(v), PAD.l - 8, y);
    }
    if (n < 2) return;
    // x labels, ~6 ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = Math.max(2, Math.min(6, n, Math.floor(iw / 90)));
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / (ticks - 1)) * (n - 1));
      const x = X(i);
      ctx.textAlign = k === 0 ? 'left' : k === ticks - 1 ? 'right' : 'center';
      ctx.fillText(fmtX(data.x[i]), x, h - PAD.b + 8);
    }
    for (const s of data.series) {
      const color = cssVar(s.color);
      const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ih);
      grad.addColorStop(0, cssVar(s.fill));
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.lineTo(X(n - 1), Y(0));
      ctx.lineTo(X(0), Y(0));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (hover >= 0 && hover < n) {
      const x = Math.round(X(hover)) + 0.5;
      ctx.strokeStyle = cssVar('--axis');
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ih);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of data.series) {
        ctx.beginPath();
        ctx.arc(X(hover), Y(s.values[hover]), 4, 0, Math.PI * 2);
        ctx.fillStyle = cssVar(s.color);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssVar('--card');
        ctx.stroke();
      }
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    const n = data.x.length;
    if (n < 2) return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const iw = state.w - PAD.l - PAD.r;
    hover = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / iw) * (n - 1))));
    tip.innerHTML = tipHtml(fmtHead(data.x[hover]), data.series.map((s) => ({ name: s.name, color: cssVar(s.color), value: fmtY(s.values[hover], true) })));
    tip.classList.add('show');
    placeTip(tip, state.w, PAD.l + (hover / (n - 1)) * iw, e.clientY - r.top);
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = -1;
    tip.classList.remove('show');
    draw();
  });

  const api = {
    draw,
    update(d) {
      data = d;
      if (hover >= d.x.length) hover = -1;
      draw();
    },
  };
  charts.add(api);
  return api;
}

// --- bar chart --------------------------------------------------------------
// stacks: [{name, color(var), values[]}], mode 'stack' | 'group'
export function barChart(canvas, tip, { fmtY, fmtTip }) {
  let data = { labels: [], stacks: [], mode: 'group' };
  let hover = -1;
  const { ctx, state } = setup(canvas, () => draw());

  const geom = () => {
    const n = data.labels.length;
    const iw = state.w - PAD.l - PAD.r;
    const slot = n ? iw / n : iw;
    const bw = Math.max(4, Math.min(44, slot * 0.66));
    return { n, iw, slot, bw };
  };

  function draw() {
    const { w, h } = state;
    ctx.clearRect(0, 0, w, h);
    const { n, slot, bw } = geom();
    const ih = h - PAD.t - PAD.b;
    const totals = data.labels.map((_, i) =>
      data.mode === 'stack' ? data.stacks.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(0, ...data.stacks.map((s) => s.values[i] || 0)),
    );
    const max = niceMax(Math.max(1, ...totals));
    const Y = (v) => PAD.t + ih - (v / max) * ih;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = i === 0 ? cssVar('--axis') : cssVar('--grid');
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = cssVar('--muted');
      ctx.fillText(fmtY(v), PAD.l - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const every = Math.ceil(n / Math.max(1, Math.floor((w - PAD.l) / 56)));
    for (let i = 0; i < n; i++) {
      const cx = PAD.l + slot * i + slot / 2;
      if (i === hover) {
        ctx.fillStyle = cssVar('--card-2');
        ctx.fillRect(cx - slot / 2 + 1, PAD.t, slot - 2, ih);
      }
      if (i % every === 0 || i === n - 1) {
        ctx.fillStyle = i === n - 1 ? cssVar('--text-2') : cssVar('--muted');
        ctx.fillText(data.labels[i], cx, h - PAD.b + 8);
      }
      if (data.mode === 'stack') {
        let acc = 0;
        const visible = data.stacks.filter((s) => (s.values[i] || 0) > 0);
        visible.forEach((s, k) => {
          const v = s.values[i];
          const y0 = Y(acc), y1 = Y(acc + v);
          const top = k === visible.length - 1;
          const gap = k > 0 ? 2 : 0; // 2px surface gap between stacked segments
          ctx.fillStyle = cssVar(s.color);
          const hh = Math.max(0, y0 - y1 - gap);
          if (top) roundTop(ctx, cx - bw / 2, y1, bw, hh, 4);
          else (ctx.beginPath(), ctx.rect(cx - bw / 2, y1, bw, hh));
          ctx.fill();
          acc += v;
        });
      } else {
        const m = data.stacks.length;
        const each = (bw - (m - 1) * 2) / m;
        data.stacks.forEach((s, k) => {
          const v = s.values[i] || 0;
          if (!v) return;
          const x = cx - bw / 2 + k * (each + 2);
          ctx.fillStyle = cssVar(s.color);
          roundTop(ctx, x, Y(v), each, Y(0) - Y(v), 4);
          ctx.fill();
        });
      }
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const { n, slot } = geom();
    const i = Math.floor((e.clientX - r.left - PAD.l) / slot);
    if (i < 0 || i >= n) return canvas.dispatchEvent(new Event('pointerleave'));
    hover = i;
    tip.innerHTML = fmtTip(i, data);
    tip.classList.add('show');
    placeTip(tip, state.w, PAD.l + slot * i + slot / 2, e.clientY - r.top);
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = -1;
    tip.classList.remove('show');
    draw();
  });

  const api = { draw, update: (d) => ((data = d), draw()) };
  charts.add(api);
  return api;
}

// --- donut ------------------------------------------------------------------
export function donutChart(canvas, tip, { fmtV, fmtShare, labels, onHover }) {
  let items = [];
  let hover = -1;
  const { ctx, state } = setup(canvas, () => draw());
  const geo = () => {
    const size = Math.min(state.w, state.h);
    return { cx: state.w / 2, cy: state.h / 2, r: size / 2 - 4, inner: size / 2 - 22 };
  };

  function draw() {
    ctx.clearRect(0, 0, state.w, state.h);
    const total = items.reduce((a, x) => a + x.value, 0);
    const { cx, cy, r, inner } = geo();
    if (!total) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r + inner) / 2, 0, Math.PI * 2);
      ctx.strokeStyle = cssVar('--grid');
      ctx.lineWidth = r - inner;
      ctx.stroke();
      return;
    }
    let a = -Math.PI / 2;
    const gap = items.filter((x) => x.value > 0).length > 1 ? 0.012 : 0;
    items.forEach((it, i) => {
      const span = (it.value / total) * Math.PI * 2;
      if (span <= 0) return;
      const rr = i === hover ? r + 3 : r;
      const g = Math.min(gap, span / 4); // tiny slices: an end angle below the start would draw a full ring
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a + g, a + span - g);
      ctx.arc(cx, cy, inner, a + span - g, a + g, true);
      ctx.closePath();
      ctx.fillStyle = cssVar(it.color) || it.color;
      ctx.globalAlpha = hover >= 0 && hover !== i ? 0.45 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      it._a0 = a;
      it._a1 = a + span;
      a += span;
    });
  }

  function hit(e) {
    const rect = canvas.getBoundingClientRect();
    const { cx, cy, r, inner } = geo();
    const x = e.clientX - rect.left - cx, y = e.clientY - rect.top - cy;
    const d = Math.hypot(x, y);
    if (d < inner - 2 || d > r + 4) return -1;
    let ang = Math.atan2(y, x);
    if (ang < -Math.PI / 2) ang += Math.PI * 2;
    return items.findIndex((it) => ang >= it._a0 && ang < it._a1);
  }

  const setHover = (i, e) => {
    hover = i;
    onHover?.(i);
    if (i >= 0 && e) {
      const total = items.reduce((a, x) => a + x.value, 0);
      const it = items[i];
      tip.innerHTML = tipHtml(it.name, [{ name: labels.value, color: cssVar(it.color) || it.color, value: fmtV(it.value) }, { name: labels.share, color: 'transparent', value: fmtShare(it.value, total) }]);
      tip.classList.add('show');
      const rect = canvas.getBoundingClientRect();
      placeTip(tip, state.w, e.clientX - rect.left, e.clientY - rect.top);
    } else tip.classList.remove('show');
    draw();
  };
  canvas.addEventListener('pointermove', (e) => setHover(hit(e), e));
  canvas.addEventListener('pointerleave', () => setHover(-1));

  const api = { draw, update: (d) => ((items = d), draw()), highlight: (i) => ((hover = i), draw()) };
  charts.add(api);
  return api;
}

// --- sparkline ----------------------------------------------------------------
export function sparkline(canvas, { color = '--dl', fill = '--dl-fill', color2, fill2 } = {}) {
  let a = [], b = [];
  const { ctx, state } = setup(canvas, () => draw());
  function line(vals, max, c, f) {
    const { w, h } = state;
    if (vals.length < 2) return;
    const X = (i) => (i / (vals.length - 1)) * w;
    const Y = (v) => h - 2 - (v / max) * (h - 6);
    ctx.beginPath();
    vals.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    if (f) {
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, cssVar(f));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      vals.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    }
    ctx.strokeStyle = cssVar(c);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  function draw() {
    ctx.clearRect(0, 0, state.w, state.h);
    const max = Math.max(1, ...a, ...b) * 1.1;
    line(a, max, color, fill);
    if (color2) line(b, max, color2, fill2);
  }
  const api = { draw, update: (x, y = []) => ((a = x), (b = y), draw()) };
  charts.add(api);
  return api;
}
