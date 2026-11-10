// Drawing engine: a drawing is a list of operations (pen/eraser strokes and bucket fills)
// in a fixed 2000-unit-wide 3:4 space, so every phone renders the same picture and a
// drawing travels as a few kB of numbers.
export const UNIT = 2000;
export const RATIO = 4 / 3;
export const HEIGHT = Math.round(UNIT * RATIO);
export const PEN = [8, 22, 54];
export const RUB = [26, 64, 140];
export const PAPER = '#FFFFFF';
export const COLORS = [
  ['#1B1C20', 'Nero'], ['#6B7080', 'Grigio'], ['#C3C7D0', 'Grigio chiaro'], ['#FFFFFF', 'Bianco'],
  ['#7B4A2B', 'Marrone'], ['#F3C9A3', 'Beige'], ['#E53935', 'Rosso'], ['#FF8F1F', 'Arancione'],
  ['#FFD60A', 'Giallo'], ['#86C34A', 'Verde chiaro'], ['#2E7D32', 'Verde scuro'], ['#4FC3F7', 'Azzurro'],
  ['#1E5BD8', 'Blu'], ['#7E57C2', 'Viola'], ['#F06292', 'Rosa'], ['#8E1E3B', 'Bordeaux']
];
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- wire format ----------
// stroke: { c: '#hex', w, p: 'x,y,x,y…' }   eraser: { e: 1, w, p }   fill: { f: 1, c: '#hex', w: 0, p: 'x,y' }
export function encode(s) {
  if (s.f) return { f: 1, c: s.c, w: 0, p: s.p[0] + ',' + s.p[1] };
  const o = { w: s.w, p: s.p.join(',') };
  if (s.e) o.e = 1; else o.c = s.c;
  return o;
}
function decode(o) {
  if (!o || typeof o !== 'object') return null;
  const p = String(o.p || '').split(',').map(Number).filter(Number.isFinite);
  if (p.length % 2) p.pop();
  if (p.length < 2) return null;
  if (o.f) {
    const x = Math.round(p[0]), y = Math.round(p[1]);
    if (x < 0 || y < 0 || x >= UNIT || y >= HEIGHT || !HEX.test(o.c)) return null;
    return { f: 1, c: o.c, p: [x, y] };
  }
  const w = Math.min(200, Math.max(1, +o.w || 22));
  return o.e ? { e: 1, w, p } : { c: HEX.test(o.c) ? o.c : '#1B1C20', w, p };
}
export function strokesFrom(obj) {
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : Object.keys(obj).sort().map(k => obj[k]);
  return list.map(decode).filter(Boolean);
}
export const strokeKey = i => 's' + String(i).padStart(4, '0');

// ---------- bucket fill ----------
// Fills must come out identical on every phone, so they are not computed from the canvas
// (browsers anti-alias differently). Each drawing is rasterised by this code into a small
// colour-index grid (1000 × 1334 cells), the flood fill runs on that grid, and the result is
// kept as a vector path that paints crisply at any size.
const RS = 0.5, RW = Math.round(UNIT * RS), RH = Math.round(HEIGHT * RS);
const FILLS = new WeakMap();    // fill op -> Path2D (drawing units) or NONE
const NONE = {};
const palette = new Map();      // colour -> grid value (0 is paper)
let grid = null, gridOps = [];  // the grid and the operations already painted on it
function colorIndex(hex) {
  hex = hex.toUpperCase();
  if (hex === PAPER) return 0;
  let i = palette.get(hex);
  if (!i) { i = Math.min(255, palette.size + 1); palette.set(hex, i); }
  return i;
}
// Paints a thick line with round ends: every cell whose centre is within r of the segment.
function capsule(x0, y0, x1, y1, r, v) {
  const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r)), xb = Math.min(RW - 1, Math.ceil(Math.max(x0, x1) + r));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r)), yb = Math.min(RH - 1, Math.ceil(Math.max(y0, y1) + r));
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy, r2 = r * r;
  for (let y = ya; y <= yb; y++) {
    const py = y + 0.5 - y0, row = y * RW;
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5 - x0;
      let t = len2 ? (px * dx + py * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - t * dx, ey = py - t * dy;
      if (ex * ex + ey * ey <= r2) grid[row + x] = v;
    }
  }
}
// Same geometry as drawStroke: a dot, curves through the midpoints, a straight tail.
function rasterStroke(s) {
  const p = s.p, n = p.length / 2, v = s.e ? 0 : colorIndex(s.c), r = Math.max(0.75, s.w * RS / 2);
  const X = i => p[i * 2] * RS, Y = i => p[i * 2 + 1] * RS;
  capsule(X(0), Y(0), X(0), Y(0), r, v);
  for (let i = 1; i < n; i++) {
    const sx = i === 1 ? X(0) : (X(i - 2) + X(i - 1)) / 2, sy = i === 1 ? Y(0) : (Y(i - 2) + Y(i - 1)) / 2;
    const cx = X(i - 1), cy = Y(i - 1), ex = (X(i - 1) + X(i)) / 2, ey = (Y(i - 1) + Y(i)) / 2;
    const steps = Math.min(16, Math.max(1, Math.ceil((Math.hypot(cx - sx, cy - sy) + Math.hypot(ex - cx, ey - cy)) / 2)));
    let ax = sx, ay = sy;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      const bx = u * u * sx + 2 * u * t * cx + t * t * ex, by = u * u * sy + 2 * u * t * cy + t * t * ey;
      capsule(ax, ay, bx, by, r, v);
      ax = bx; ay = by;
    }
  }
  if (n >= 2) capsule((X(n - 2) + X(n - 1)) / 2, (Y(n - 2) + Y(n - 1)) / 2, X(n - 1), Y(n - 1), r, v);
}
// Flood fill on the grid from the tapped cell. Returns the filled area as a path, or null
// when the area already has that colour.
function floodFill(op) {
  const sx = Math.min(RW - 1, Math.max(0, Math.floor(op.p[0] * RS)));
  const sy = Math.min(RH - 1, Math.max(0, Math.floor(op.p[1] * RS)));
  const from = grid[sy * RW + sx], to = colorIndex(op.c);
  if (from === to) return null;
  const path = new Path2D(), stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(); let x = stack.pop(), i = y * RW + x;
    if (grid[i] !== from) continue;
    while (x > 0 && grid[i - 1] === from) { x--; i--; }
    const x0 = x; let up = false, down = false;
    while (x < RW && grid[i] === from) {
      grid[i] = to;
      if (y > 0) { if (grid[i - RW] === from) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
      if (y < RH - 1) { if (grid[i + RW] === from) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false; }
      x++; i++;
    }
    // half a cell wider on every side, so the colour tucks under the soft edge of the lines around it
    path.rect(x0 / RS - 1, y / RS - 1, (x - x0) / RS + 2, 1 / RS + 2);
  }
  return path;
}
// Brings the grid up to date with the first `count` operations of a drawing.
function syncGrid(ops, count) {
  if (!grid) grid = new Uint8Array(RW * RH);
  let same = 0;
  while (same < gridOps.length && same < count && gridOps[same] === ops[same]) same++;
  if (same < gridOps.length) { grid.fill(0); gridOps = []; same = 0; }
  for (let i = same; i < count; i++) {
    const s = ops[i];
    if (s.f) { const path = floodFill(s); if (!FILLS.has(s)) FILLS.set(s, path || NONE); }
    else rasterStroke(s);
    gridOps.push(s);
  }
}
// Makes sure every fill in the list has its path (paths of earlier fills are reused).
export function ensureMasks(ops) {
  let last = -1;
  for (let i = 0; i < ops.length; i++) if (ops[i].f && !FILLS.has(ops[i])) last = i;
  if (last >= 0) syncGrid(ops, last + 1);
}
// Computes the fill for a new tap on top of the given drawing. Returns false if nothing would change.
function prepareFill(ops, op) {
  syncGrid(ops, ops.length);
  const path = floodFill(op);
  if (!path) return false;
  FILLS.set(op, path); gridOps.push(op);
  return true;
}

// ---------- rendering ----------
function prep(c, s) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = c.fillStyle = s.e ? PAPER : s.c;
  c.lineWidth = s.w;
}
function dot(c, s) { c.beginPath(); c.arc(s.p[0], s.p[1], s.w / 2, 0, Math.PI * 2); c.fill(); }
function seg(c, s, i) {
  const p = s.p, a = (i - 1) * 2, b = i * 2;
  const sx = i === 1 ? p[0] : (p[a - 2] + p[a]) / 2;
  const sy = i === 1 ? p[1] : (p[a - 1] + p[a + 1]) / 2;
  c.beginPath(); c.moveTo(sx, sy);
  c.quadraticCurveTo(p[a], p[a + 1], (p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2);
  c.stroke();
}
function tail(c, s) {
  const p = s.p, n = p.length / 2;
  if (n < 2) return;
  const a = (n - 2) * 2, b = (n - 1) * 2;
  c.beginPath(); c.moveTo((p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2); c.lineTo(p[b], p[b + 1]); c.stroke();
}
function drawFill(c, s) {
  const path = FILLS.get(s);
  if (!path || path === NONE) return;
  c.fillStyle = s.c; c.fill(path);
}
function drawStroke(c, s) {
  if (s.f) { drawFill(c, s); return; }
  prep(c, s); dot(c, s);
  const n = s.p.length / 2;
  for (let i = 1; i < n; i++) seg(c, s, i);
  tail(c, s);
}
// Paints a drawing into a rectangle (x, y, k = pixels per unit) of an existing context.
export function paintInto(c, x, y, k, strokes) {
  ensureMasks(strokes);
  c.save();
  c.translate(x, y); c.scale(k, k);
  c.fillStyle = PAPER; c.fillRect(0, 0, UNIT, HEIGHT);
  c.beginPath(); c.rect(0, 0, UNIT, HEIGHT); c.clip();
  for (const s of strokes) drawStroke(c, s);
  c.restore();
}
function paint(c, k, strokes) {
  ensureMasks(strokes);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = PAPER; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(k, 0, 0, k, 0, 0);
  for (const s of strokes) drawStroke(c, s);
}
export function sizeCanvas(canvas, cssWidth, maxDpr = 3) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(40, Math.floor(cssWidth));
  const h = Math.floor(w * RATIO);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  return canvas.width / UNIT;
}
// Frees a canvas's memory right away (phones keep it around otherwise).
export function release(canvas) { canvas.width = 0; canvas.height = 0; }
export function render(canvas, strokes) { paint(canvas.getContext('2d'), canvas.width / UNIT, strokes); }

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const weight = s => (s.f ? 12 : s.p.length / 2);   // a fill takes as long as a short stroke in the replay
// Redraws a drawing step by step; returns a function that stops the animation.
export function replay(canvas, strokes, maxMs = 4500) {
  const c = canvas.getContext('2d'), k = canvas.width / UNIT;
  ensureMasks(strokes);
  if (reduced() || !strokes.length) { paint(c, k, strokes); return () => {}; }
  paint(c, k, []);
  const total = strokes.reduce((a, s) => a + weight(s), 0);
  const dur = Math.min(maxMs, Math.max(1200, total * 6));
  let si = 0, pi = 0, drawn = 0, raf = 0, stopped = false;
  const t0 = performance.now();
  const step = now => {
    if (stopped) return;
    const target = Math.min(total, Math.ceil((now - t0) / dur * total));
    c.setTransform(k, 0, 0, k, 0, 0);
    while (drawn < target && si < strokes.length) {
      const s = strokes[si];
      if (s.f) { drawFill(c, s); drawn += weight(s); si++; pi = 0; continue; }
      const n = s.p.length / 2;
      prep(c, s);
      if (pi === 0) dot(c, s); else seg(c, s, pi);
      pi++; drawn++;
      if (pi >= n) { tail(c, s); si++; pi = 0; }
    }
    if (si < strokes.length) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { stopped = true; cancelAnimationFrame(raf); paint(c, k, strokes); };
}

// ---------- interactive pad ----------
// One finger draws. Two fingers zoom (1x–4x) and move the sheet; the view is local to this phone.
const ZMAX = 4;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export class Pad {
  constructor(canvas, stage, { onAdd, onUndo, onView } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.stage = stage;
    this.onAdd = onAdd || (() => {}); this.onUndo = onUndo || (() => {}); this.onView = onView || (() => {});
    this.strokes = []; this.cur = null; this.curId = null; this.startT = 0;
    this.tool = 'pen'; this.color = COLORS[0][0]; this.size = 1; this.k = 1; this.locked = false;
    this.z = 1; this.tx = 0; this.ty = 0;          // view: zoom and offset in canvas pixels
    this.pts = new Map();                           // fingers on the sheet, in canvas pixels
    this.pinch = null; this.gesture = false; this.tap = null; this.raf = 0;
    this.cost = 0; this.snap = null; this.snapCv = null;
    new ResizeObserver(() => this.fit()).observe(stage);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    // The canvas only draws: no scrolling, page zoom, text selection, magnifier or long-press menu.
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(t, stop, { passive: false });
    for (const t of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) canvas.addEventListener(t, stop);
  }
  fit() {
    const r = this.stage.getBoundingClientRect();
    const w = Math.floor(Math.min(r.width, r.height / RATIO));
    if (w <= 0) return;
    const old = this.cv.width;
    this.k = sizeCanvas(this.cv, w);
    if (old && this.cv.width !== old) { const f = this.cv.width / old; this.tx *= f; this.ty *= f; }
    this.clampView();
    this.redraw();
  }
  // --- view ---
  view() { const s = this.k * this.z; this.ctx.setTransform(s, 0, 0, s, this.tx, this.ty); }
  clampView() {
    const W = this.cv.width, H = this.cv.height;
    this.z = Math.min(ZMAX, Math.max(1, this.z));
    this.tx = Math.min(0, Math.max(W - W * this.z, this.tx));
    this.ty = Math.min(0, Math.max(H - H * this.z, this.ty));
  }
  setView(z, tx, ty) {
    this.z = z; this.tx = tx; this.ty = ty; this.clampView();
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.redraw(); });
    this.onView(this.z);
  }
  resetView() { this.z = 1; this.tx = 0; this.ty = 0; this.redraw(); this.onView(1); }
  zoomAt(p, z) {   // keep the point p (canvas pixels) still while zooming
    z = Math.min(ZMAX, Math.max(1, z));
    const ux = (p.x - this.tx) / this.z, uy = (p.y - this.ty) / this.z;
    this.setView(z, p.x - ux * z, p.y - uy * z);
  }
  redraw() {
    const c = this.ctx, W = this.cv.width, H = this.cv.height;
    if (this.gesture && this.snap) {
      // a heavy drawing follows the fingers as a picture; it is redrawn sharp when they lift
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.snap, this.tx, this.ty, W * this.z, H * this.z);
      return;
    }
    const t0 = performance.now();
    ensureMasks(this.strokes);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
    this.view();
    for (const s of this.strokes) drawStroke(c, s);
    if (this.cur) drawStroke(c, this.cur);
    this.cost = performance.now() - t0;
  }
  takeSnap() {
    this.snap = null;
    if (this.cost < 7) return;                    // light drawing: redrawing every frame is smooth enough
    const cv = this.snapCv || (this.snapCv = document.createElement('canvas'));
    cv.width = this.cv.width; cv.height = this.cv.height;
    paint(cv.getContext('2d'), this.k, this.strokes);
    this.snap = cv;
  }
  load(strokes) {
    this.cur = null; this.curId = null; this.pts.clear(); this.pinch = null; this.gesture = false; this.tap = null; this.snap = null;
    this.strokes = strokes.slice();
    this.resetView();
  }
  // --- coordinates ---
  cpos(e) {
    const r = this.cv.getBoundingClientRect(), f = this.cv.width / r.width;
    return { x: (e.clientX - r.left) * f, y: (e.clientY - r.top) * f };
  }
  unit(p) {
    const s = this.k * this.z;
    return [Math.round((p.x - this.tx) / s), Math.round((p.y - this.ty) / s)];
  }
  // --- input ---
  down(e) {
    if (e.cancelable) e.preventDefault();
    if (this.locked) return;
    if (e.pointerType === 'mouse' && e.button > 0) return;
    this.pts.set(e.pointerId, this.cpos(e));
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) {}
    if (this.pts.size >= 2) { this.startPinch(); return; }
    if (this.gesture) return;
    const [x, y] = this.unit(this.pts.get(e.pointerId));
    if (this.tool === 'fill') { this.tap = { id: e.pointerId, x, y, at: this.pts.get(e.pointerId) }; return; }
    this.curId = e.pointerId; this.startT = performance.now();
    this.cur = this.tool === 'rub' ? { e: 1, w: RUB[this.size], p: [x, y] } : { c: this.color, w: PEN[this.size], p: [x, y] };
    this.view(); prep(this.ctx, this.cur); dot(this.ctx, this.cur);
  }
  startPinch() {
    if (this.cur) {
      // the first finger had just started a line: that was the start of the pinch, not a stroke
      if (performance.now() - this.startT < 400 || this.cur.p.length <= 12) { this.cur = null; this.redraw(); }
      else this.finish();
    }
    this.curId = null; this.tap = null;
    if (!this.gesture) this.takeSnap();
    this.gesture = true;
    const [a, b] = [...this.pts.values()];
    this.pinch = { d0: Math.max(1, dist(a, b)), m0: mid(a, b), z0: this.z, tx0: this.tx, ty0: this.ty };
  }
  move(e) {
    if (!this.pts.has(e.pointerId)) return;
    if (e.cancelable) e.preventDefault();
    this.pts.set(e.pointerId, this.cpos(e));
    if (this.pinch) {
      const [a, b] = [...this.pts.values()], P = this.pinch, m = mid(a, b);
      const z = Math.min(ZMAX, Math.max(1, P.z0 * dist(a, b) / P.d0));
      const ux = (P.m0.x - P.tx0) / P.z0, uy = (P.m0.y - P.ty0) / P.z0;
      this.setView(z, m.x - ux * z, m.y - uy * z);
      return;
    }
    if (this.tap && this.tap.id === e.pointerId) {
      if (dist(this.tap.at, this.pts.get(e.pointerId)) > 14 * (this.cv.width / this.cv.getBoundingClientRect().width)) this.tap = null;
      return;
    }
    if (e.pointerId !== this.curId || !this.cur) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const c = this.ctx;
    this.view(); prep(c, this.cur);
    for (const ev of (list.length ? list : [e])) {
      const [x, y] = this.unit(this.cpos(ev)), p = this.cur.p, n = p.length;
      const dx = x - p[n - 2], dy = y - p[n - 1];
      if (dx * dx + dy * dy < 9) continue;
      if (p.length >= 3000) { this.finish(); return; }   // very long stroke: close it and keep it reasonable in size
      p.push(x, y);
      seg(c, this.cur, p.length / 2 - 1);
    }
  }
  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.gesture) {
      if (this.pts.size < 2) this.pinch = null;
      if (this.pts.size === 0) {
        this.gesture = false; this.snap = null;
        if (this.z < 1.06) this.resetView(); else this.redraw();
      }
      return;
    }
    if (this.tap && this.tap.id === e.pointerId) {
      const t = this.tap; this.tap = null;
      if (e.type === 'pointerup') this.fillAt(t.x, t.y);
      return;
    }
    if (e.pointerId === this.curId) this.finish();
  }
  wheel(e) {
    if (this.locked) return;
    e.preventDefault();
    const p = this.cpos(e);
    if (e.ctrlKey || e.metaKey) this.zoomAt(p, this.z * Math.exp(-e.deltaY * 0.01));   // trackpad pinch
    else if (this.z > 1) this.setView(this.z, this.tx - e.deltaX, this.ty - e.deltaY);
  }
  fillAt(x, y) {
    if (x < 0 || y < 0 || x >= UNIT || y >= HEIGHT) return;
    const op = { f: 1, c: this.color, p: [x, y] };
    if (!prepareFill(this.strokes, op)) return;
    this.strokes.push(op);
    this.view(); drawFill(this.ctx, op);
    this.onAdd(op, this.strokes.length - 1);
  }
  finish() {
    const s = this.cur; if (!s) return;
    this.view(); prep(this.ctx, s); tail(this.ctx, s);
    this.cur = null; this.curId = null;
    if (s.p.length < 2) return;
    this.strokes.push(s);
    this.onAdd(s, this.strokes.length - 1);
  }
  undo() {
    if (this.locked || !this.strokes.length) return false;
    this.strokes.pop(); this.redraw();
    this.onUndo(this.strokes.length);
    return true;
  }
  cancelStroke() { if (this.cur) { this.cur = null; this.curId = null; this.redraw(); } }
}
