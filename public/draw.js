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
// A fill is computed on a reference raster at half resolution (1000 × 1334 px), the same
// on every device, and kept as a cropped colour mask that is scaled onto any canvas.
const RS = 0.5, RW = Math.round(UNIT * RS), RH = Math.round(HEIGHT * RS);
const TOL = 40;                 // how different a pixel may be from the tapped one and still fill
const MASKS = new WeakMap();    // fill op -> { cv, x, y, w, h } in reference pixels
const NONE = { cv: null };
let refCv = null;
function refCtx() {
  if (!refCv) { refCv = document.createElement('canvas'); refCv.width = RW; refCv.height = RH; }
  const c = refCv.getContext('2d', { willReadFrequently: true });
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = PAPER; c.fillRect(0, 0, RW, RH);
  c.setTransform(RS, 0, 0, RS, 0, 0);
  return c;
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function computeMask(c, op) {
  const sx = Math.min(RW - 1, Math.max(0, Math.round(op.p[0] * RS)));
  const sy = Math.min(RH - 1, Math.max(0, Math.round(op.p[1] * RS)));
  const img = c.getImageData(0, 0, RW, RH);
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, RW * RH);
  const seed = px[sy * RW + sx];
  const sr = seed & 255, sg = (seed >>> 8) & 255, sb = (seed >>> 16) & 255;
  const [fr, fg, fb] = rgb(op.c);
  if (Math.abs(sr - fr) <= 6 && Math.abs(sg - fg) <= 6 && Math.abs(sb - fb) <= 6) return null;   // already that colour
  const mask = new Uint8Array(RW * RH);
  const ok = i => {
    if (mask[i]) return false;
    const v = px[i];
    return Math.abs((v & 255) - sr) <= TOL && Math.abs(((v >>> 8) & 255) - sg) <= TOL && Math.abs(((v >>> 16) & 255) - sb) <= TOL;
  };
  let minx = sx, maxx = sx, miny = sy, maxy = sy;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(); let x = stack.pop(); let i = y * RW + x;
    if (!ok(i)) continue;
    while (x > 0 && ok(i - 1)) { x--; i--; }
    let up = false, down = false;
    if (x < minx) minx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    while (x < RW && ok(i)) {
      mask[i] = 1;
      if (y > 0) { if (ok(i - RW)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
      if (y < RH - 1) { if (ok(i + RW)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false; }
      x++; i++;
    }
    if (x - 1 > maxx) maxx = x - 1;
  }
  // grow the area by one pixel so it tucks under the soft edge of the lines around it
  const x0 = Math.max(0, minx - 1), y0 = Math.max(0, miny - 1), x1 = Math.min(RW - 1, maxx + 1), y1 = Math.min(RH - 1, maxy + 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh;
  const mc = cv.getContext('2d');
  const out = mc.createImageData(bw, bh);
  const o = new Uint32Array(out.data.buffer);
  const col = ((255 << 24) | (fb << 16) | (fg << 8) | fr) >>> 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * RW + x;
      if (mask[i] || (x > 0 && mask[i - 1]) || (x < RW - 1 && mask[i + 1]) || (y > 0 && mask[i - RW]) || (y < RH - 1 && mask[i + RW])) {
        o[(y - y0) * bw + (x - x0)] = col;
      }
    }
  }
  mc.putImageData(out, 0, 0);
  return { cv, x: x0, y: y0, w: bw, h: bh };
}
// Makes sure every fill in the list has its mask (masks of earlier fills are reused).
export function ensureMasks(ops) {
  let last = -1;
  for (let i = 0; i < ops.length; i++) if (ops[i].f && !MASKS.has(ops[i])) last = i;
  if (last < 0) return;
  const c = refCtx();
  for (let i = 0; i <= last; i++) {
    const s = ops[i];
    if (s.f && !MASKS.has(s)) MASKS.set(s, computeMask(c, s) || NONE);
    drawStroke(c, s);
  }
}
// Computes the fill for a new tap on top of the given drawing. Returns false if nothing would change.
function prepareFill(ops, op) {
  ensureMasks(ops);
  const c = refCtx();
  for (const s of ops) drawStroke(c, s);
  const m = computeMask(c, op);
  if (!m) return false;
  MASKS.set(op, m);
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
  const m = MASKS.get(s);
  if (!m || !m.cv) return;
  c.imageSmoothingEnabled = true;
  c.drawImage(m.cv, m.x / RS, m.y / RS, m.w / RS, m.h / RS);
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
export function sizeCanvas(canvas, cssWidth) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(40, Math.floor(cssWidth));
  const h = Math.floor(w * RATIO);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  return canvas.width / UNIT;
}
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
    const c = this.ctx;
    ensureMasks(this.strokes);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAPER; c.fillRect(0, 0, this.cv.width, this.cv.height);
    this.view();
    for (const s of this.strokes) drawStroke(c, s);
    if (this.cur) drawStroke(c, this.cur);
  }
  load(strokes) {
    this.cur = null; this.curId = null; this.pts.clear(); this.pinch = null; this.gesture = false; this.tap = null;
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
    this.curId = null; this.tap = null; this.gesture = true;
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
      if (this.pts.size === 0) { this.gesture = false; if (this.z < 1.06) this.resetView(); }
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
