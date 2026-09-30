/* Canvas time-series chart in the PMW Speed Engine's hand-drawn style (see
 * its drawCruxHistory): DPR-aware canvas, faint grid, #5aa2ff series, muted
 * 10px axis labels, hover tooltip. No chart library — keeps the bundle small
 * and the look identical to the sibling tool. */

import { esc } from './dom';
import { fmtCompact, fmtDay, fmtInt } from './format';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ChartOptions {
  kind: 'line' | 'bar';
  label: string;
  /** Shade the last N points (the "current period" n8n compared). */
  highlightLast?: number;
  height?: number;
}

const C = {
  line: '#5aa2ff',
  fillTop: 'rgba(90,162,255,0.22)',
  fillBottom: 'rgba(90,162,255,0)',
  bar: 'rgba(90,162,255,0.55)',
  barHi: '#5aa2ff',
  grid: 'rgba(140,160,190,0.12)',
  axis: '#8494ab',
  band: 'rgba(90,162,255,0.06)',
  cursor: 'rgba(230,237,247,0.35)',
};

let tipEl: HTMLDivElement | null = null;
export function showTip(e: MouseEvent, html: string): void {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  tipEl.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tipEl.offsetWidth - 8)}px`;
  tipEl.style.top = `${Math.min(e.clientY + 14, window.innerHeight - tipEl.offsetHeight - 8)}px`;
}
export function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none';
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function draw(
  canvas: HTMLCanvasElement,
  points: SeriesPoint[],
  opts: ChartOptions,
  hover: number | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = opts.height ?? 200;
  if (!w) return null;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 42, r: 10, t: 10, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = points.length;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0) * 1.08);
  const slot = iw / Math.max(1, n);
  const x = (i: number) =>
    opts.kind === 'bar' ? pad.l + slot * (i + 0.5) : pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => pad.t + (1 - v / max) * ih;

  ctx.font = '10px Inter, -apple-system, sans-serif';
  // current-period band
  if (opts.highlightLast && opts.highlightLast < n) {
    const from =
      opts.kind === 'bar'
        ? pad.l + slot * (n - opts.highlightLast)
        : x(n - opts.highlightLast) - iw / Math.max(1, n - 1) / 2;
    ctx.fillStyle = C.band;
    ctx.fillRect(from, pad.t, pad.l + iw - from, ih);
  }
  // grid + y labels
  ctx.strokeStyle = C.grid;
  ctx.fillStyle = C.axis;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = (max / 4) * g;
    const gy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(w - pad.r, gy);
    ctx.stroke();
    const t = fmtCompact(v);
    ctx.fillText(t, pad.l - 6 - ctx.measureText(t).width, gy + 3);
  }
  // x labels — at most ~7, never overlapping
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  points.forEach((p, i) => {
    if ((n - 1 - i) % every !== 0) return;
    const t = n <= 7 ? fmtDay(p.date, 'weekday') : fmtDay(p.date);
    const tw = ctx.measureText(t).width;
    ctx.fillText(t, Math.min(Math.max(x(i) - tw / 2, pad.l - 4), w - pad.r - tw), h - 7);
  });

  if (opts.kind === 'bar') {
    const bw = Math.max(2, Math.min(28, slot * 0.62));
    points.forEach((p, i) => {
      const top = y(p.value);
      ctx.fillStyle =
        i === hover || (opts.highlightLast && i >= n - opts.highlightLast) ? C.barHi : C.bar;
      ctx.fillRect(x(i) - bw / 2, top, bw, pad.t + ih - top);
    });
  } else {
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, C.fillTop);
    grad.addColorStop(1, C.fillBottom);
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
    ctx.lineTo(x(n - 1), pad.t + ih);
    ctx.lineTo(x(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
    ctx.stroke();
    if (n <= 31) {
      ctx.fillStyle = C.line;
      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(x(i), y(p.value), i === hover ? 3.8 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    if (hover != null && points[hover]) {
      ctx.strokeStyle = C.cursor;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(x(hover)) + 0.5, pad.t);
      ctx.lineTo(Math.round(x(hover)) + 0.5, pad.t + ih);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  return { pad, iw, n, slot };
}

/** Render a chart into `canvas`, redrawing on resize and hover. */
export function renderChart(
  canvas: HTMLCanvasElement,
  points: SeriesPoint[],
  opts: ChartOptions,
): void {
  if (!points.length) return;
  let hover: number | null = null;
  let geom = draw(canvas, points, opts, hover);

  const indexAt = (e: MouseEvent) => {
    if (!geom) return null;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left - geom.pad.l;
    const i =
      opts.kind === 'bar' ? Math.floor(px / geom.slot) : Math.round((px / geom.iw) * (geom.n - 1));
    return Math.max(0, Math.min(geom.n - 1, i));
  };
  canvas.onmousemove = (e) => {
    const i = indexAt(e);
    if (i == null) return;
    if (i !== hover) {
      hover = i;
      geom = draw(canvas, points, opts, hover);
    }
    const p = points[i]!;
    showTip(
      e,
      `<b>${esc(fmtInt(p.value))}</b> ${esc(opts.label.toLowerCase())}<br><span class="c-muted">${esc(fmtDay(p.date, 'weekday'))}, ${esc(fmtDay(p.date))}</span>`,
    );
  };
  canvas.onmouseleave = () => {
    hover = null;
    geom = draw(canvas, points, opts, hover);
    hideTip();
  };

  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) return ro.disconnect();
    geom = draw(canvas, points, opts, hover);
  });
  ro.observe(canvas);
}
