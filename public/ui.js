// Small interface pieces shared by the whole app: screens, messages, confirmation sheet,
// haptic feedback and lists that update in place.
export const $ = id => document.getElementById(id);

// ---------- screens ----------
const SCREENS = ['loading', 'home', 'lobby', 'write', 'draw', 'wait', 'reveal', 'claim', 'spectate'];
let current = 'loading';
export const screen = () => current;
// Shows one screen with a short entrance. Returns false when it was already showing.
export function showScreen(name) {
  if (current === name) return false;
  for (const s of SCREENS) {
    const el = $('s-' + s);
    el.hidden = s !== name;
    el.classList.remove('enter');
  }
  if (closePop) closePop();         // a small menu never outlives its screen
  const el = $('s-' + name);
  void el.offsetWidth;              // restart the entrance animation
  el.classList.add('enter');
  current = name;
  return true;
}

// ---------- haptic feedback ----------
// Android: the vibration API. iPhone: toggling a hidden system switch gives the light system tap
// (Safari 17.4+); where neither exists nothing happens.
const PATTERNS = { light: 8, medium: 16, success: [10, 70, 18], warning: [24, 60, 24] };
let hapticLabel = null;
export function haptic(kind = 'light') {
  try {
    if (navigator.vibrate) { navigator.vibrate(PATTERNS[kind] || PATTERNS.light); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      hapticLabel.append(input);
      document.head.append(hapticLabel);
    }
    hapticLabel.click();
  } catch (e) {}
}

// ---------- messages ----------
let toastT = 0, toastOut = 0;
export function toast(msg, ms = 3500) {
  const t = $('toast');
  clearTimeout(toastT); clearTimeout(toastOut);
  t.textContent = msg; t.classList.remove('leaving'); t.hidden = false;
  toastT = setTimeout(() => {
    t.classList.add('leaving');
    toastOut = setTimeout(() => { t.hidden = true; t.classList.remove('leaving'); }, 220);
  }, ms);
}

// ---------- sheets (confirmation and menu) ----------
let closeTop = null;     // closes the sheet on screen, if any (the system back gesture uses it)
export function dismissTop() { if (!closeTop) return false; closeTop(); return true; }
function openBox(box) { clearTimeout(box._hideT); box.classList.remove('leaving'); box.hidden = false; }
function closeBox(box) {
  box.classList.add('leaving');
  box._hideT = setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, 200);
}
// Wires a sheet: tapping outside, Escape and the back gesture all answer `cancel`.
function sheet(box, cancel, resolve) {
  const back = document.activeElement;
  let settled = false;
  const done = v => {
    if (settled) return; settled = true;
    if (closeTop === close) closeTop = null;
    box.onclick = null; window.removeEventListener('keydown', onKey);
    closeBox(box);
    if (back && back.focus) try { back.focus({ preventScroll: true }); } catch (e) {}
    resolve(v);
  };
  const close = () => done(cancel);
  const onKey = e => { if (e.key === 'Escape') close(); };
  box.onclick = e => { if (e.target === box) close(); };
  window.addEventListener('keydown', onKey);
  if (closeTop) closeTop();
  closeTop = close;
  openBox(box);
  return done;
}
export function ask(title, text, yes = 'Conferma', { danger = false } = {}) {
  return new Promise(resolve => {
    const y = $('askYes'), n = $('askNo');
    $('askTitle').textContent = title; $('askText').textContent = text; y.textContent = yes;
    y.classList.toggle('danger', danger); y.classList.toggle('primary', !danger);
    const done = sheet($('ask'), false, resolve);
    y.onclick = () => done(true);
    n.onclick = () => done(false);
    y.focus({ preventScroll: true });
  });
}
// A full-screen view (like the enlarged drawing): a tap anywhere, Escape or back closes it.
export function lightbox(box) {
  return new Promise(resolve => {
    const done = sheet(box, null, resolve);
    box.onclick = () => done(null);
  });
}
// actions: [{ value, label, detail?, danger? }]  ->  the chosen value, or null
export function menu({ title, text = '', actions }) {
  return new Promise(resolve => {
    $('menuTitle').textContent = title;
    const t = $('menuText'); t.textContent = text; t.hidden = !text;
    const list = $('menuActions'); list.textContent = '';
    const done = sheet($('menu'), null, resolve);
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'menu-item' + (a.danger ? ' danger' : '');
      const l = document.createElement('span'); l.className = 'menu-label'; l.textContent = a.label; b.append(l);
      if (a.detail) { const d = document.createElement('span'); d.className = 'menu-detail'; d.textContent = a.detail; b.append(d); }
      b.onclick = () => done(a.value);
      list.append(b);
    }
    $('menuCancel').onclick = () => done(null);
    const first = list.querySelector('button'); if (first) first.focus({ preventScroll: true });
  });
}

// ---------- popover: a small row of choices just above a button ----------
// items: [{ value, label, icon (markup) }]  ->  the chosen value, or null
let closePop = null;
export function popover(anchor, items, current) {
  return new Promise(resolve => {
    const box = $('pop'), row = $('popRow'), catcher = $('popCatch');
    if (closePop) closePop();
    row.textContent = '';
    let settled = false;
    const done = v => {
      if (settled) return; settled = true;
      if (closeTop === close) closeTop = null;
      if (closePop === close) closePop = null;
      window.removeEventListener('keydown', onKey);
      catcher.hidden = true; catcher.onpointerdown = null;
      anchor.setAttribute('aria-expanded', 'false');
      box.classList.add('leaving');
      box._hideT = setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, 150);
      resolve(v);
    };
    const close = () => done(null);
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pop-item'; b.innerHTML = it.icon;
      b.setAttribute('aria-label', it.label); b.setAttribute('aria-pressed', it.value === current);
      b.onclick = () => done(it.value);
      row.append(b);
    }
    clearTimeout(box._hideT); box.classList.remove('leaving'); box.hidden = false; catcher.hidden = false;
    // above the button, centred on it, inside the screen
    const a = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth, w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(12, Math.min(vw - w - 12, a.left + a.width / 2 - w / 2));
    box.style.left = left + 'px'; box.style.top = Math.max(12, a.top - h - 10) + 'px';
    box.style.setProperty('--origin', (a.left + a.width / 2 - left) + 'px');
    // a tap anywhere else only closes it (nothing gets drawn by accident)
    catcher.onpointerdown = e => { e.preventDefault(); close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    if (closeTop) closeTop();
    closeTop = close; closePop = close;
    anchor.setAttribute('aria-expanded', 'true');
    const sel = row.querySelector('[aria-pressed="true"]') || row.firstElementChild;
    if (sel) sel.focus({ preventScroll: true });
  });
}

// ---------- lists that update in place ----------
// rows: [{ key, sig, build() }]. A row is rebuilt only when its signature changes, and only
// rows that are new to the list play the entrance animation.
export function syncRows(list, rows) {
  const old = new Map([...list.children].map(el => [el.dataset.key, el]));
  const first = !list.dataset.filled;
  rows.forEach((row, i) => {
    let el = old.get(row.key);
    if (!el || el.dataset.sig !== row.sig) {
      const fresh = row.build();
      fresh.dataset.key = row.key; fresh.dataset.sig = row.sig;
      if (el) el.replaceWith(fresh); else if (!first) fresh.classList.add('row-in');
      el = fresh;
    }
    old.delete(row.key);
    if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
  });
  for (const el of old.values()) el.remove();
  list.dataset.filled = '1';
}
