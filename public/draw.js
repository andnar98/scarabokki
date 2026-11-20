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

// ---------- shapes ----------
// A shape is stored as an ordinary stroke whose points trace it, so the replay, the album
// picture, the bucket and older copies of the game all handle it like any other line.
// Extra points right next to each corner keep corners sharp despite the stroke smoothing.
export const SHAPES = ['line', 'rect', 'ellipse', 'tri'];
const SNAP_SIDE = 0.08;                  // sides within 8% of each other: square, circle, equilateral
const SNAP_LINE = 6 * Math.PI / 180;     // lines within 6° of a multiple of 45° straighten out
const CORNER = 2;                        // distance of the helper points from a corner, in units
function toward(a, b, d) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]; }
function polygon(vs) {
  const n = vs.length, out = [], start = [(vs[n - 1][0] + vs[0][0]) / 2, (vs[n - 1][1] + vs[0][1]) / 2];
  out.push(start);
  vs.forEach((v, i) => { out.push(toward(v, vs[(i + n - 1) % n], CORNER), v, toward(v, vs[(i + 1) % n], CORNER)); });
  out.push(start);
  return out;
}
// The shape dragged from a to b (drawing units): { p: [x, y, …], snapped } or null for a tap.
export function shapeOf(kind, ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay, snapped = false;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return null;
  let pts;
  if (kind === 'line') {
    const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), q = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(ang - q) < SNAP_LINE) { dx = Math.cos(q) * len; dy = Math.sin(q) * len; snapped = true; }
    pts = [[ax, ay], [ax + dx, ay + dy]];
  } else {
    let w = Math.abs(dx), h = Math.abs(dy);
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1, big = Math.max(w, h);
    if (kind === 'tri') {
      const eq = w * Math.sqrt(3) / 2;
      if (w > 8 && Math.abs(h - eq) < SNAP_SIDE * big) { h = eq; snapped = true; }
    } else if (Math.abs(w - h) < SNAP_SIDE * big) { w = h = big; snapped = true; }
    bx = ax + sx * w; by = ay + sy * h;
    if (kind === 'rect') pts = polygon([[ax, ay], [bx, ay], [bx, by], [ax, by]]);
    else if (kind === 'tri') pts = polygon([[(ax + bx) / 2, ay], [bx, by], [ax, by]]);   // the tip points to where the drag began
    else {
      const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = w / 2, ry = h / 2;
      const n = Math.max(24, Math.min(120, Math.round(2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) / 16)));
      pts = [];
      for (let i = 0; i <= n + 1; i++) { const t = -Math.PI / 2 + i * 2 * Math.PI / n; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    }
  }
  const p = [];
  for (const [x, y] of pts) {
    const X = Math.round(x), Y = Math.round(y), n = p.length;
    if (n && p[n - 2] === X && p[n - 1] === Y) continue;
    p.push(X, Y);
  }
  return p.length >= 4 ? { p, snapped } : null;
}

// ---------- interactive pad ----------
// One finger draws. Two fingers zoom, rotate and move the sheet; the view is local to this phone.
// The canvas covers the whole drawing area and paints the sheet itself, so the sheet can turn.
const ZMIN = 0.5, ZMAX = 5;
const QUARTER = Math.PI / 2;
const SNAP_ROT = 7 * Math.PI / 180;      // the sheet clicks onto straight (and 90°, 180°…) within 7°
const RADIUS = 14, MARGIN = 8;           // sheet corners and room for its shadow, in css px
const noop = () => {};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
// view: canvas px = s · R(r) · units + (tx, ty)
function unitAt(v, p) {
  const x = p.x - v.tx, y = p.y - v.ty, c = Math.cos(v.r), n = Math.sin(v.r);
  return { x: (x * c + y * n) / v.s, y: (-x * n + y * c) / v.s };
}
function anchored(u, p, s, r) {     // the view with scale s and angle r that puts unit point u at p
  const c = Math.cos(r), n = Math.sin(r);
  return { s, r, tx: p.x - s * (c * u.x - n * u.y), ty: p.y - s * (n * u.x + c * u.y) };
}
export function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}
export class Pad {
  constructor(canvas, stage, { onAdd, onUndo, onView, onSnap } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.stage = stage;
    this.onAdd = onAdd || noop; this.onUndo = onUndo || noop; this.onView = onView || noop; this.onSnap = onSnap || noop;
    this.strokes = []; this.cur = null; this.curId = null; this.startT = 0; this.draft = null;
    this.tool = 'pen'; this.shape = null; this.color = COLORS[0][0]; this.size = 1; this.locked = false;
    this.W = 0; this.H = 0; this.dpr = 1; this.radius = 1; this.shadow = null; this.box = null;
    this.home = { s: 1, r: 0, tx: 0, ty: 0 }; this.v = { ...this.home };
    this.pts = new Map();                           // fingers on the canvas, in canvas pixels
    this.pinch = null; this.gesture = false; this.tap = null; this.raf = 0;
    this.anim = null; this.live = false; this.cost = 0; this.snap = null; this.snapCv = null; this.baseCv = null;
    new ResizeObserver(() => this.fit()).observe(stage);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    // A finger whose end the browser never reported (notification, app switch, system gesture)
    // must not stay registered, or every new touch would be taken for a second finger.
    for (const t of ['touchend', 'touchcancel']) canvas.addEventListener(t, e => this.touchSync(e));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    // The canvas only draws: no scrolling, page zoom, text selection, magnifier or long-press menu.
    const stop = e => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(t, stop, { passive: false });
    for (const t of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) canvas.addEventListener(t, stop);
  }
  // The canvas is larger than the drawing area (stage): the sheet rests fitted in the stage.
  fit() {
    const sr = this.stage.getBoundingClientRect(), cr = this.cv.getBoundingClientRect();
    if (sr.width < 10 || sr.height < 10 || cr.width < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = Math.round(cr.width * dpr), H = Math.round(cr.height * dpr);
    const box = { x: (sr.left - cr.left) * dpr, y: (sr.top - cr.top) * dpr, w: sr.width * dpr, h: sr.height * dpr };
    const b0 = this.box;
    if (W === this.W && H === this.H && dpr === this.dpr && b0 && b0.w === box.w && b0.h === box.h && b0.x === box.x && b0.y === box.y) return;
    this.finishAnim();
    const first = !this.W, wasHome = this.atHome(), z = this.v.s / this.home.s;
    const uc = first ? null : unitAt(this.v, this.center());
    this.cv.width = W; this.cv.height = H; this.W = W; this.H = H; this.dpr = dpr; this.box = box;
    const m = MARGIN * dpr, s = Math.min((box.w - 2 * m) / UNIT, (box.h - 2 * m) / HEIGHT);
    this.home = { s, r: 0, tx: box.x + (box.w - s * UNIT) / 2, ty: box.y + (box.h - s * HEIGHT) / 2 };
    this.radius = RADIUS * dpr / s;
    this.makeShadow();
    // keep the same spot of the drawing in the middle, at the same zoom
    this.v = first || wasHome ? { ...this.home } : anchored(uc, this.center(), z * s, this.v.r);
    this.redraw(); this.notifyView();
  }
  center() { const b = this.box || { x: 0, y: 0, w: this.W, h: this.H }; return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  // The sheet's soft shadow, drawn once per size and reused at any zoom or angle.
  makeShadow() {
    const q = 0.5, s = this.home.s * q, d = this.dpr * q, m = Math.ceil(40 * d);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(UNIT * s) + 2 * m; cv.height = Math.ceil(HEIGHT * s) + 2 * m;
    const c = cv.getContext('2d');
    c.shadowColor = 'rgba(80, 60, 140, .16)'; c.shadowBlur = 24 * d; c.shadowOffsetY = 8 * d;
    c.fillStyle = PAPER; roundRectPath(c, m, m, UNIT * s, HEIGHT * s, RADIUS * d); c.fill();
    this.shadow = { cv, m: m / s, w: cv.width / s, h: cv.height / s };
  }
  // --- view ---
  atHome() {
    const v = this.v, h = this.home;
    return Math.abs(v.s / h.s - 1) < 1e-3 && Math.abs(wrap(v.r)) < 1e-3 && Math.abs(v.tx - h.tx) < 1 && Math.abs(v.ty - h.ty) < 1;
  }
  applyView(c = this.ctx) {
    const { s, r, tx, ty } = this.v, k = s * Math.cos(r), n = s * Math.sin(r);
    c.setTransform(k, n, -n, k, tx, ty);
  }
  paperPath(c) { roundRectPath(c, 0, 0, UNIT, HEIGHT, this.radius); }
  withPaper(fn) { const c = this.ctx; c.save(); this.applyView(); this.paperPath(c); c.clip(); fn(c); c.restore(); }
  notifyView() {
    let deg = Math.round(wrap(this.v.r) * 180 / Math.PI); if (deg === -180) deg = 180;
    this.onView({ z: this.v.s / this.home.s, deg, home: this.atHome() });
  }
  setView(v) {
    this.v = v;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.redraw(); });
    this.notifyView();
  }
  // Keeps part of the sheet under the middle of the screen.
  clamped(v) {
    const C = this.center(), u = unitAt(v, C);
    const cu = { x: clamp(u.x, 0, UNIT), y: clamp(u.y, 0, HEIGHT) };
    return cu.x === u.x && cu.y === u.y ? v : anchored(cu, C, v.s, v.r);
  }
  // At the end of a gesture: back to the whole sheet when nearly there, otherwise stay in view.
  settle() {
    const straight = Math.abs(wrap(this.v.r)) < 1e-3;
    if (straight && this.v.s / this.home.s < 1.08) this.animateTo(this.home);
    else { const t = this.clamped(this.v); if (t !== this.v) this.animateTo(t); else { this.live = false; this.snap = null; this.redraw(); } }
  }
  resetView(animate = false) {
    if (animate && !this.atHome()) { this.animateTo(this.home); return; }
    this.finishAnim(); this.v = { ...this.home }; this.redraw(); this.notifyView();
  }
  animateTo(to, ms = 300) {
    this.finishAnim();
    if (reduced()) { this.v = { ...to }; this.live = false; this.snap = null; this.redraw(); this.notifyView(); return; }
    // glide around the middle of the screen: zoom, turn and slide together
    const C = this.center(), from = { ...this.v }, dr = wrap(to.r - from.r);
    const uf = unitAt(from, C), ut = unitAt(to, C), t0 = performance.now();
    if (!this.live) { this.live = true; this.takeSnap(); }
    const anim = this.anim = { to, raf: 0 };
    const step = now => {
      if (this.anim !== anim) return;
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { this.anim = null; this.v = { ...to }; this.live = false; this.snap = null; this.redraw(); this.notifyView(); return; }
      const s = from.s * Math.pow(to.s / from.s, e);
      this.v = anchored({ x: uf.x + (ut.x - uf.x) * e, y: uf.y + (ut.y - uf.y) * e }, C, s, from.r + dr * e);
      this.redraw(); this.notifyView();
      anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
  }
  finishAnim() {
    const a = this.anim; if (!a) return;
    cancelAnimationFrame(a.raf); this.anim = null;
    this.v = { ...a.to }; this.live = false; this.snap = null; this.redraw(); this.notifyView();
  }
  // --- painting ---
  redraw() {
    const c = this.ctx, t0 = performance.now();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    if (!this.W) return;
    this.applyView();
    const sh = this.shadow;
    if (sh) c.drawImage(sh.cv, -sh.m, -sh.m, sh.w, sh.h);
    c.fillStyle = PAPER; this.paperPath(c); c.fill();
    c.save(); c.clip();
    if (this.live && this.snap) c.drawImage(this.snap, 0, 0, UNIT, HEIGHT);   // heavy drawing while moving
    else {
      ensureMasks(this.strokes);
      for (const s of this.strokes) drawStroke(c, s);
      if (this.cur) drawStroke(c, this.cur);
      if (this.draft && this.draft.op) drawStroke(c, this.draft.op);
    }
    c.restore();
    if (!(this.live && this.snap)) this.cost = performance.now() - t0;
  }
  takeSnap() {
    this.snap = null;
    if (this.cost < 7) return;                    // light drawing: redrawing every frame is smooth enough
    const s = this.home.s, cv = this.snapCv || (this.snapCv = document.createElement('canvas'));
    const w = Math.round(UNIT * s), h = Math.round(HEIGHT * s);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    paint(cv.getContext('2d'), s, this.strokes);
    this.snap = cv;
  }
  load(strokes) {
    this.cur = null; this.curId = null; this.draft = null; this.pts.clear(); this.pinch = null; this.gesture = false; this.tap = null;
    this.strokes = strokes.slice();
    this.resetView();
  }
  // The sheet's rectangle on screen while it is straight (for tests).
  paperRect() {
    const r = this.cv.getBoundingClientRect(), f = r.width / (this.W || 1), v = this.v;
    return { left: r.left + v.tx * f, top: r.top + v.ty * f, width: UNIT * v.s * f, height: HEIGHT * v.s * f };
  }
  // --- coordinates ---
  cpos(e) {
    const r = this.cv.getBoundingClientRect(), f = this.W / (r.width || 1);
    return { x: (e.clientX - r.left) * f, y: (e.clientY - r.top) * f };
  }
  unit(p) { const u = unitAt(this.v, p); return [Math.round(u.x), Math.round(u.y)]; }
  // --- input ---
  down(e) {
    if (e.cancelable) e.preventDefault();
    if (this.locked) return;
    if (e.pointerType === 'mouse' && e.button > 0) return;
    // the first finger of a new touch: anything still registered of the same kind is stale
    if (e.isPrimary) this.releaseAll('pointercancel', e.pointerType);
    this.finishAnim();
    this.pts.set(e.pointerId, Object.assign(this.cpos(e), { type: e.pointerType }));
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) {}
    if (this.pts.size >= 2) { this.startPinch(); return; }
    if (this.gesture) return;
    const [x, y] = this.unit(this.pts.get(e.pointerId));
    if (this.tool === 'fill') { this.tap = { id: e.pointerId, x, y, at: this.pts.get(e.pointerId) }; return; }
    this.curId = e.pointerId; this.startT = performance.now();
    if (this.tool === 'shape' && this.shape) { this.beginShape(x, y); return; }
    this.cur = this.tool === 'rub' ? { e: 1, w: RUB[this.size], p: [x, y] } : { c: this.color, w: PEN[this.size], p: [x, y] };
    this.withPaper(c => { prep(c, this.cur); dot(c, this.cur); });
  }
  startPinch() {
    if (this.draft) { this.draft = null; this.redraw(); }       // a shape being dragged gives way to the pinch
    if (this.cur) {
      // the first finger had just started a line: that was the start of the pinch, not a stroke
      if (performance.now() - this.startT < 400 || this.cur.p.length <= 12) { this.cur = null; this.redraw(); }
      else this.finish();
    }
    this.curId = null; this.tap = null;
    if (!this.gesture) { this.gesture = true; this.live = true; this.takeSnap(); }
    this.rebase();
  }
  // The two fingers in use and the view when they landed: the gesture is measured from here.
  rebase() {
    const [a, b] = [...this.pts.values()], m0 = mid(a, b);
    this.pinch = { d0: Math.max(1, dist(a, b)), a0: angle(a, b), u: unitAt(this.v, m0), s0: this.v.s, r0: this.v.r,
      snapped: Math.abs(wrap(this.v.r - Math.round(this.v.r / QUARTER) * QUARTER)) < 1e-3 };
  }
  move(e) {
    if (!this.pts.has(e.pointerId)) return;
    if (e.cancelable) e.preventDefault();
    this.pts.set(e.pointerId, Object.assign(this.cpos(e), { type: this.pts.get(e.pointerId).type }));
    if (this.pinch) {
      const [a, b] = [...this.pts.values()], P = this.pinch;
      const s = clamp(P.s0 * dist(a, b) / P.d0, this.home.s * ZMIN, this.home.s * ZMAX);
      let r = P.r0 + wrap(angle(a, b) - P.a0);
      const q = Math.round(r / QUARTER) * QUARTER, near = Math.abs(r - q) < SNAP_ROT;
      if (near) r = q;
      if (near && !P.snapped) this.onSnap();
      P.snapped = near;
      this.setView(anchored(P.u, mid(a, b), s, wrap(r)));
      return;
    }
    if (this.tap && this.tap.id === e.pointerId) {
      if (dist(this.tap.at, this.pts.get(e.pointerId)) > 14 * this.dpr) this.tap = null;
      return;
    }
    if (e.pointerId !== this.curId) return;
    if (this.draft) { this.moveShape(this.pts.get(e.pointerId)); return; }
    if (!this.cur) return;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const c = this.ctx;
    let full = false;
    c.save(); this.applyView(); this.paperPath(c); c.clip(); prep(c, this.cur);
    for (const ev of (list.length ? list : [e])) {
      const [x, y] = this.unit(this.cpos(ev)), p = this.cur.p, n = p.length;
      const dx = x - p[n - 2], dy = y - p[n - 1];
      if (dx * dx + dy * dy < 9) continue;
      if (p.length >= 3000) { full = true; break; }   // very long stroke: close it and keep it reasonable in size
      p.push(x, y);
      seg(c, this.cur, p.length / 2 - 1);
    }
    c.restore();
    if (full) this.finish();
  }
  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.gesture) {
      if (this.pts.size >= 2) this.rebase();
      else this.pinch = null;
      if (this.pts.size === 0) { this.gesture = false; this.settle(); }
      return;
    }
    if (this.tap && this.tap.id === e.pointerId) {
      const t = this.tap; this.tap = null;
      if (e.type === 'pointerup') this.fillAt(t.x, t.y);
      return;
    }
    if (e.pointerId === this.curId) {
      if (this.draft) this.endShape(e.type === 'pointerup');
      else this.finish();
    }
  }
  // Ends every finger still registered (of one kind, or all). A line being drawn is kept;
  // a pending bucket tap or shape is dropped unless the finger really lifted.
  releaseAll(type = 'pointercancel', kind) {
    for (const [id, p] of [...this.pts]) if (!kind || p.type === kind) this.up({ pointerId: id, type });
    if (!this.pts.size) { this.pinch = null; this.gesture = false; }
  }
  touchSync(e) {
    if (e.targetTouches && e.targetTouches.length) return;
    // no finger is left on the sheet: whatever is still registered as a touch was missed
    const ids = [...this.pts].filter(([, p]) => p.type === 'touch').map(([id]) => id);
    if (!ids.length) return;
    const type = e.type === 'touchcancel' ? 'pointercancel' : 'pointerup';
    setTimeout(() => { for (const id of ids) if (this.pts.has(id)) this.up({ pointerId: id, type }); }, 60);
  }
  wheel(e) {
    if (this.locked) return;
    e.preventDefault();
    this.finishAnim();
    const p = this.cpos(e), v = this.v;
    if (e.ctrlKey || e.metaKey) {      // trackpad pinch
      const s = clamp(v.s * Math.exp(-e.deltaY * 0.01), this.home.s * ZMIN, this.home.s * ZMAX);
      this.setView(this.clamped(anchored(unitAt(v, p), p, s, v.r)));
    } else if (!this.atHome()) this.setView(this.clamped({ ...v, tx: v.tx - e.deltaX * this.dpr, ty: v.ty - e.deltaY * this.dpr }));
  }
  // --- shapes ---
  beginShape(x, y) {
    this.draft = { a: [x, y], op: null, snapped: false };
    // what is on screen now; the shape is drawn on top of it while the finger moves
    const b = this.baseCv || (this.baseCv = document.createElement('canvas'));
    if (b.width !== this.W || b.height !== this.H) { b.width = this.W; b.height = this.H; }
    const bc = b.getContext('2d');
    bc.setTransform(1, 0, 0, 1, 0, 0); bc.clearRect(0, 0, this.W, this.H); bc.drawImage(this.cv, 0, 0);
  }
  moveShape(p) {
    const d = this.draft, [x, y] = this.unit(p), sh = shapeOf(this.shape, d.a[0], d.a[1], x, y);
    d.op = sh ? { c: this.color, w: PEN[this.size], p: sh.p } : null;
    const snapped = !!(sh && sh.snapped);
    if (snapped && !d.snapped) this.onSnap();
    d.snapped = snapped;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.W, this.H); c.drawImage(this.baseCv, 0, 0);
    if (d.op) this.withPaper(c2 => drawStroke(c2, d.op));
  }
  endShape(commit) {
    const d = this.draft; this.draft = null; this.curId = null;
    if (commit && d && d.op) { this.strokes.push(d.op); this.redraw(); this.onAdd(d.op, this.strokes.length - 1); }
    else this.redraw();
  }
  // --- the rest ---
  fillAt(x, y) {
    if (x < 0 || y < 0 || x >= UNIT || y >= HEIGHT) return;
    const op = { f: 1, c: this.color, p: [x, y] };
    if (!prepareFill(this.strokes, op)) return;
    this.strokes.push(op);
    this.withPaper(c => drawFill(c, op));
    this.onAdd(op, this.strokes.length - 1);
  }
  finish() {
    if (this.draft) { this.endShape(true); return; }
    const s = this.cur; if (!s) return;
    this.withPaper(c => { prep(c, s); tail(c, s); });
    this.cur = null; this.curId = null;
    if (s.p.length < 2) return;
    this.strokes.push(s);
    this.onAdd(s, this.strokes.length - 1);
  }
  undo() {
    if (this.locked || !this.strokes.length || this.draft) return false;
    this.strokes.pop(); this.redraw();
    this.onUndo(this.strokes.length);
    return true;
  }
  cancelStroke() {
    if (this.cur || this.draft) { this.cur = null; this.draft = null; this.curId = null; this.redraw(); }
  }
}
