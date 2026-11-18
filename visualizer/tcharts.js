// Small canvas charts for the Tests tab: a scrolling strip chart (live telemetry) and an XY chart (results).
// One y-axis per chart, recessive grid, 2 px lines, ≥ 8 px markers with a surface ring, legend above the plot,
// hover crosshair + tooltip. Colours come from the page's CSS tokens (X = --pitch blue, Y = --yaw orange,
// references = muted ink, dashed). Text never takes a series colour.

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const FONT = '500 10px "Barlow Semi Condensed", "Barlow Condensed", system-ui, sans-serif';

function niceStep(range, target = 4) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function ticks(lo, hi, target) {
  const s = niceStep(hi - lo || 1, target), out = [];
  for (let v = Math.ceil(lo / s) * s; v <= hi + s * 1e-6; v += s) out.push(+v.toFixed(10));
  return out;
}
const fmt = (v, step) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const s = v.toFixed(d);
  return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s;
};

export class Chart {
  // tile: container; opts: { kind: 'strip'|'xy', title, sub, unit, xUnit, xLabel, span, yMin, yMax, minRange, symmetric,
  //                          xMin, xMax, series: [{ id, label, color, dash, line, marker }], refs: [{ y } | { fn }], empty }
  constructor(tile, opts) {
    this.o = { kind: 'strip', span: 10, minRange: 2, unit: '', xUnit: '', ...opts };
    this.data = {};
    for (const s of this.o.series) this.data[s.id] = [];
    tile.classList.add('t-tile', 't-chart');
    tile.innerHTML = `<div class="t-tile-h"><b></b><span></span></div><div class="t-legend"></div><div class="t-plot"><canvas></canvas><div class="t-empty"></div><div class="t-tip" hidden></div></div>`;
    tile.querySelector('.t-tile-h b').textContent = this.o.title;
    tile.querySelector('.t-tile-h span').textContent = this.o.sub || '';
    this.tile = tile;
    this.cv = tile.querySelector('canvas');
    this.tip = tile.querySelector('.t-tip');
    this.emptyEl = tile.querySelector('.t-empty');
    this.ctx = this.cv.getContext('2d');
    this.hover = null;
    this.setLegend();
    new ResizeObserver(() => this.resize()).observe(this.cv.parentElement);
    const plot = this.cv.parentElement;
    plot.addEventListener('pointermove', e => { const r = this.cv.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.draw(); });
    plot.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
  }
  setLegend() {
    const ser = this.o.series.filter(s => !s.hideLegend);
    const lg = this.tile.querySelector('.t-legend');
    lg.hidden = ser.length < 2;
    lg.innerHTML = ser.map(s => `<span><i class="${s.dash ? 'dash' : ''} ${s.line === false ? 'dot' : ''}" style="--c:${s.color}"></i>${s.label}</span>`).join('');
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect(), d = devicePixelRatio || 1;
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.cv.width = Math.round(this.w * d); this.cv.height = Math.round(this.h * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.draw();
  }
  // Strip: push(now, { id: value }); XY: set({ id: [[x, y], …] })
  push(t, vals) {
    for (const s of this.o.series) {
      const v = vals[s.id];
      if (v == null || !Number.isFinite(v)) continue;
      const a = this.data[s.id];
      a.push([t, v]);
      while (a.length && t - a[0][0] > (this.o.span + 1) * 1000) a.shift();
    }
  }
  clear() { for (const k in this.data) this.data[k] = []; }
  set(data) { for (const s of this.o.series) this.data[s.id] = data[s.id] || []; }
  visible() { return this.tile.offsetParent !== null && this.w; }

  draw(now = performance.now()) {
    if (!this.visible()) return;
    const { ctx, w, h, o } = this;
    const muted = css('--muted'), dim = css('--dim'), line = css('--line'), line2 = css('--line-2'), surf = css('--panel'), text = css('--text');
    ctx.clearRect(0, 0, w, h);
    const strip = o.kind === 'strip';
    // x range
    let x0, x1;
    if (strip) { x1 = now; x0 = now - o.span * 1000; }
    else {
      const xs = Object.values(this.data).flat().map(p => p[0]);
      x0 = o.xMin ?? (xs.length ? Math.min(...xs) : 0); x1 = o.xMax ?? (xs.length ? Math.max(...xs) : 1);
      if (x1 - x0 < 1e-9) { x0 -= 1; x1 += 1; }
    }
    // y range from what's on screen
    const ys = [];
    for (const s of o.series) for (const [x, y] of this.data[s.id]) if (x >= x0 - 1 && x <= x1 + 1) ys.push(y);
    for (const r of o.refs || []) if (r.y != null) ys.push(r.y);
    let y0 = o.yMin ?? (ys.length ? Math.min(...ys) : -1), y1 = o.yMax ?? (ys.length ? Math.max(...ys) : 1);
    if (o.yMin == null && o.zero !== false) y0 = Math.min(y0, 0);
    if (o.yMax == null && o.zero !== false) y1 = Math.max(y1, 0);
    if (o.symmetric) { const m = Math.max(Math.abs(y0), Math.abs(y1), o.minRange / 2); y0 = -m; y1 = m; }
    if (y1 - y0 < o.minRange) { const c = (y0 + y1) / 2; y0 = c - o.minRange / 2; y1 = c + o.minRange / 2; }
    const pad = (y1 - y0) * 0.08; if (o.yMin == null) y0 -= pad; if (o.yMax == null) y1 += pad;
    // layout
    ctx.font = FONT;
    const yt = ticks(y0, y1, h < 130 ? 3 : 4), ystep = yt[1] - yt[0] || 1;
    const lw = Math.max(...yt.map(v => ctx.measureText(fmt(v, ystep)).width)) + 8;
    const L = Math.ceil(lw), R = 12, T = 8, B = 20;
    const pw = w - L - R, ph = h - T - B;
    const X = x => L + (x - x0) / (x1 - x0) * pw, Y = y => T + (1 - (y - y0) / (y1 - y0)) * ph;
    this.geom = { X, Y, L, R, T, B, pw, ph, x0, x1 };
    // grid + y labels
    ctx.lineWidth = 1; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const v of yt) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? line2 : line; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      ctx.fillStyle = dim; ctx.fillText(fmt(v, ystep), L - 6, y);
    }
    // x labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = dim;
    if (strip) {
      for (let s = 0; s <= o.span; s += o.span > 20 ? 10 : o.span > 8 ? 2 : 1) ctx.fillText(s === 0 ? 'now' : `−${s} s`, X(x1 - s * 1000), h - 5);
    } else {
      const xt = ticks(x0, x1, Math.max(3, Math.floor(pw / 70))), xs = xt[1] - xt[0] || 1;
      for (const v of xt) ctx.fillText(fmt(v, xs) + (o.xUnit && v === xt.at(-1) ? ' ' + o.xUnit : ''), X(v), h - 5);
    }
    // references
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = muted; ctx.lineWidth = 1;
    for (const r of o.refs || []) {
      ctx.beginPath();
      if (r.y != null) { ctx.moveTo(L, Y(r.y)); ctx.lineTo(w - R, Y(r.y)); }
      else if (r.fn) { for (let i = 0; i <= 40; i++) { const x = x0 + (x1 - x0) * i / 40, y = r.fn(x); i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); } }
      ctx.stroke();
    }
    ctx.restore();
    // series
    ctx.save(); ctx.beginPath(); ctx.rect(L, T - 4, pw, ph + 8); ctx.clip();
    let any = false;
    for (const s of o.series) {
      const pts = this.data[s.id].filter(([x]) => x >= x0 - (strip ? 1000 : 0));
      if (!pts.length) continue;
      any = true;
      const color = s.color;
      if (s.line !== false && pts.length > 1) {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.setLineDash(s.dash ? [5, 4] : []);
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (s.marker || s.line === false) for (const [x, y] of pts) {
        ctx.beginPath(); ctx.arc(X(x), Y(y), 4, 0, Math.PI * 2);
        ctx.fillStyle = s.hollow ? surf : color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = s.hollow ? color : surf; ctx.stroke();
      }
    }
    ctx.restore();
    this.emptyEl.textContent = any ? '' : (o.empty || 'No data yet');
    // hover
    this.tip.hidden = true;
    if (!this.hover || !any) return;
    const { x: hx, y: hy } = this.hover;
    if (hx < L || hx > w - R) return;
    const rows = [];
    if (strip) {
      const t = x0 + (hx - L) / pw * (x1 - x0);
      ctx.strokeStyle = line2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, T); ctx.lineTo(Math.round(hx) + 0.5, T + ph); ctx.stroke();
      for (const s of o.series) {
        const a = this.data[s.id]; if (!a.length) continue;
        let best = a[0]; for (const p of a) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
        if (Math.abs(best[0] - t) > 400) continue;
        ctx.beginPath(); ctx.arc(X(best[0]), Y(best[1]), 4, 0, Math.PI * 2); ctx.fillStyle = s.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = surf; ctx.stroke();
        rows.push([s, best[1]]);
      }
      if (!rows.length) return;
      this.showTip(hx, hy, `${((x1 - t) / 1000).toFixed(1)} s ago`, rows.map(([s, v]) => [s, `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)} ${o.unit}`]));
    } else {
      let best = null;
      for (const s of o.series) for (const p of this.data[s.id]) {
        const d = Math.hypot(X(p[0]) - hx, Y(p[1]) - hy);
        if (d < 24 && (!best || d < best.d)) best = { s, p, d };
      }
      if (!best) return;
      ctx.beginPath(); ctx.arc(X(best.p[0]), Y(best.p[1]), 6, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = text; ctx.stroke();
      this.showTip(X(best.p[0]), Y(best.p[1]), `${o.xLabel || 'x'} ${fmt(best.p[0], 0.01)} ${o.xUnit}`, [[best.s, `${best.p[1].toFixed(2)} ${o.unit}`]]);
    }
  }
  showTip(x, y, head, rows) {
    const t = this.tip;
    t.innerHTML = `<div class="tt-h">${head}</div>` + rows.map(([s, v]) => `<div><i style="--c:${s.color}" class="${s.dash ? 'dash' : ''}"></i>${s.label}<b>${v}</b></div>`).join('');
    t.hidden = false;
    const tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = Math.min(Math.max(4, x + 12), this.w - tw - 4) + 'px';
    t.style.top = Math.min(Math.max(4, y - th - 8), this.h - th - 4) + 'px';
    if (x + 12 + tw > this.w) t.style.left = Math.max(4, x - tw - 12) + 'px';
  }
}
