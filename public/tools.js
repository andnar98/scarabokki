// The drawing toolbar (colours, pen, shapes, eraser, bucket, size, undo) and the page gestures
// that must never zoom or scroll the game.
import { COLORS } from './draw.js';
import { $, screen, popover, toast } from './ui.js';
import { store } from './store.js';

export const SHAPE_ICONS = {
  any: '<path d="M3.5 10.5h9v9h-9z"/><circle cx="15.5" cy="8.5" r="5"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>',
  ellipse: '<circle cx="12" cy="12" r="7.5"/>',
  tri: '<path d="M12 4.5l8 14H4z"/>'
};
export const SHAPE_ITEMS = [
  { value: 'line', label: 'Linea' }, { value: 'rect', label: 'Rettangolo' },
  { value: 'ellipse', label: 'Cerchio' }, { value: 'tri', label: 'Triangolo' }
].map(it => Object.assign(it, { icon: `<svg viewBox="0 0 24 24" aria-hidden="true">${SHAPE_ICONS[it.value]}</svg>` }));
export const SIZE_NAMES = ['Sottile', 'Medio', 'Grosso'];
export function setupDrawTools(pad) {
  const sw = $('swatches'), tray = $('tray');
  const renderTools = () => {
    for (const t of ['pen', 'shape', 'rub', 'fill']) $(t).setAttribute('aria-pressed', pad.tool === t);
    $('shapeIcon').innerHTML = SHAPE_ICONS[pad.shape || 'any'];
    $('shape').setAttribute('aria-label', 'Forme' + (pad.shape ? ': ' + SHAPE_ITEMS.find(i => i.value === pad.shape).label.toLowerCase() : ''));
    tray.classList.toggle('rubbing', pad.tool === 'rub');
    tray.classList.toggle('filling', pad.tool === 'fill');
    tray.style.setProperty('--cur', pad.color);
    [...sw.children].forEach((b, i) => b.setAttribute('aria-checked', COLORS[i][0] === pad.color));
    $('sizeDot').className = 'dot ' + 'sml'[pad.size];
    $('sizeBtn').setAttribute('aria-label', 'Spessore: ' + SIZE_NAMES[pad.size].toLowerCase());
  };
  COLORS.forEach(([hex, name]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.style.background = hex;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', name);
    b.onclick = () => { pad.color = hex; if (pad.tool === 'rub') pad.tool = 'pen'; renderTools(); };
    sw.append(b);
  });
  $('pen').onclick = () => { pad.tool = 'pen'; renderTools(); };
  $('rub').onclick = () => { pad.tool = 'rub'; renderTools(); };
  $('fill').onclick = () => { pad.tool = 'fill'; renderTools(); };
  $('zoomReset').onclick = () => { pad.releaseAll(); pad.resetView(true); };
  // Shapes: the first tap picks the shape tool again; when it is already on, it opens the choices.
  $('shape').onclick = async () => {
    if (pad.tool !== 'shape' && pad.shape) { pad.tool = 'shape'; renderTools(); return; }
    const v = await popover($('shape'), SHAPE_ITEMS, pad.shape);
    if (!v) return;
    pad.shape = v; pad.tool = 'shape'; renderTools();
    if (!store.get('shapeHint')) {
      store.set('shapeHint', 1);
      toast('Trascina sul foglio. Quadrati, cerchi e linee dritte si agganciano da soli.', 5000);
    }
  };
  $('sizeBtn').onclick = async () => {
    const dot = c => `<span class="dot ${c}" style="background:${pad.tool === 'rub' ? 'transparent' : pad.color}"></span>`;
    const v = await popover($('sizeBtn'), SIZE_NAMES.map((label, i) => ({ value: i, label, icon: dot('sml'[i]) })), pad.size);
    if (v === null) return;
    pad.size = v; if (pad.tool === 'fill') pad.tool = 'pen';
    renderTools();
  };
  renderTools();
  let holdT = 0, repT = 0;
  const stop = () => { clearTimeout(holdT); clearInterval(repT); };
  const u = $('undo');
  u.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.undo();
    holdT = setTimeout(() => { repT = setInterval(() => { if (!pad.undo()) stop(); }, 90); }, 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => u.addEventListener(t, stop));
  u.addEventListener('click', e => { if (e.detail === 0) pad.undo(); });
  window.addEventListener('keydown', e => {
    if (screen() === 'draw' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); pad.undo(); }
  });
}
export function blockGestures() {
  const stop = e => { if (e.cancelable) e.preventDefault(); };
  // iOS Safari pinch-zoom (it ignores user-scalable=no)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  // two fingers anywhere never zoom the page
  document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) stop(e); }, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  // on the drawing screen nothing scrolls, selects or opens a menu
  const draw = $('s-draw');
  draw.addEventListener('touchmove', stop, { passive: false });
  for (const t of ['contextmenu', 'selectstart', 'dragstart']) draw.addEventListener(t, stop);
}
