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

// ---------- confirmation sheet ----------
export function ask(title, text, yes = 'Conferma', { danger = false } = {}) {
  return new Promise(resolve => {
    const box = $('ask'), y = $('askYes'), n = $('askNo');
    $('askTitle').textContent = title; $('askText').textContent = text; y.textContent = yes;
    y.classList.toggle('danger', danger); y.classList.toggle('primary', !danger);
    box.classList.remove('leaving'); box.hidden = false;
    const back = document.activeElement;
    const done = v => {
      y.onclick = n.onclick = box.onclick = null; window.removeEventListener('keydown', onKey);
      box.classList.add('leaving');
      setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, 200);
      if (back && back.focus) try { back.focus({ preventScroll: true }); } catch (e) {}
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    y.onclick = () => done(true);
    n.onclick = () => done(false);
    box.onclick = e => { if (e.target === box) done(false); };
    window.addEventListener('keydown', onKey);
    y.focus({ preventScroll: true });
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
