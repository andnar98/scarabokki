import * as net from './net.js';
import { render, replay, sizeCanvas, release, strokesFrom } from './draw.js';
import { $, showScreen, toast, haptic } from './ui.js';
import { albumBlob } from './album.js';
import { authorOf, nextReveal, prevReveal, verbs, finale } from './game.js';
import { sound } from './sound.js';
import { S, room, quiet, nameOf, colorOf, isHost, gameKey, avatar, textOf } from './state.js';

// ---------------------------------------------------------------------------
// Reveal: the host steps through every album, everyone sees the same thing
// ---------------------------------------------------------------------------
export function stopReveal() { (S.rv.stops || []).forEach(f => f()); S.rv.stops = []; }
export function clearFeed() {
  stopReveal();
  const feed = $('feed');
  for (const cv of feed.querySelectorAll('canvas')) release(cv);
  feed.textContent = '';
}
export function chainEntries(c) {
  const m = S.meta, key = gameKey() + ':' + c;
  if (S.rv.cache[key]) return S.rv.cache[key];
  const order = m.order, N = m.n;
  const p = Promise.all(Array.from({ length: N }, (_, k) => {
    const by = authorOf(order, c, k);
    return net.get(room(`work/${k}/${by}`)).then(v => ({ k, by, v }), () => ({ k, by, v: null, failed: true }));
  })).then(list => { if (list.some(e => e.failed)) delete S.rv.cache[key]; return list; });
  S.rv.cache[key] = p;
  return p;
}
export function revealPos() {
  const m = S.meta, N = m.n, rv = m.reveal || { c: 0, s: 1 };
  if (rv.fin) return { c: S.rv.browse !== null && S.rv.browse < N ? S.rv.browse : Math.min(rv.c, N - 1), s: N, fin: true };
  return { c: Math.min(rv.c, N - 1), s: Math.max(1, Math.min(rv.s, N)), fin: false };
}
export async function onReveal() {
  showScreen('reveal');
  const m = S.meta, pos = revealPos(), N = m.n;
  renderRevealChrome();
  const viewKey = gameKey() + ':' + pos.c;
  const fresh = S.rv.key !== viewKey;
  const entries = await chainEntries(pos.c);
  if (S.meta !== m && revealPos().c !== pos.c) return;   // moved on while loading
  if (pos.c + 1 < N) chainEntries(pos.c + 1);            // prefetch the next album
  const feed = $('feed');
  if (fresh) { clearFeed(); S.rv.key = viewKey; S.rv.shown = 0; }
  const from = S.rv.shown, to = pos.s;
  if (to < from) { clearFeed(); S.rv.shown = 0; return onReveal(); }
  const said = verbsOf(entries);
  for (let k = from; k < to; k++) feed.append(entryEl(entries[k], said[k], k === to - 1 && !pos.fin && !fresh));
  const live = to > from && !fresh;
  // the whole album is on screen: close it with its "before and after"
  const end = to === N && !feed.querySelector('.finale') ? finaleOf(entries) : null;
  if (end) feed.append(finaleEl(end, live && !pos.fin));
  if (live && !isHost()) haptic('light');
  if (live) sound(end && !pos.fin ? 'finale' : 'step');
  S.rv.shown = to;
  requestAnimationFrame(() => {
    const last = feed.lastElementChild;
    if (last && !fresh) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
    else if (fresh) feed.scrollTop = pos.fin ? 0 : feed.scrollHeight;
  });
}
// What each step says next to the name ("ha disegnato", "ha visto", "ha scritto").
const verbsOf = entries => verbs(entries.map(e => e.k % 2 === 1 && strokesFrom(e.v && e.v.s).length > 0));
const finaleOf = entries => finale(entries.map(e => (e.k % 2 ? '' : textOf(e))));
function finaleEl({ from, to }, party) {
  const el = document.createElement('section');
  el.className = 'finale';
  const eb = document.createElement('div'); eb.className = 'eyebrow'; eb.textContent = 'È partito da';
  const a = document.createElement('p'); a.className = 'from'; a.textContent = from;
  const arrow = document.createElement('div'); arrow.className = 'arrow'; arrow.textContent = '↓'; arrow.setAttribute('aria-hidden', 'true');
  const eb2 = document.createElement('div'); eb2.className = 'eyebrow'; eb2.textContent = 'Ed è arrivato a';
  const b = document.createElement('p'); b.className = 'to'; b.textContent = to;
  el.append(eb, a, arrow, eb2, b);
  if (party) { confetti(); haptic('success'); }
  return el;
}
// A short burst of paper bits falling from the top of the screen.
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  const colors = ['#FFD966', '#FFC2D4', '#BDEFD8', '#BFE3FF', '#D9CCFF', '#FF9A9A'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--x', (Math.random() * 120 - 60) + 'px');
    p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    p.style.setProperty('--d', (1.1 + Math.random() * 0.9) + 's');
    p.style.setProperty('--w', (Math.random() * 0.25) + 's');
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2600);
}
export function entryEl(e, verb, animate) {
  const el = document.createElement('article');
  el.className = 'entry';
  const who = document.createElement('div'); who.className = 'who';
  const b = document.createElement('b'); b.textContent = nameOf(e.by);
  const drawing = e.k % 2 === 1;
  who.append(avatar(e.by, true), b, document.createTextNode(verb));
  el.append(who);
  if (drawing) {
    const strokes = strokesFrom(e.v && e.v.s);
    if (!strokes.length) { const p = document.createElement('div'); p.className = 'blank'; p.textContent = 'Foglio bianco'; el.append(p); return el; }
    const cv = document.createElement('canvas'); cv.className = 'sheet';
    el.append(cv);
    requestAnimationFrame(() => {
      const w = Math.min($('feed').clientWidth - 4, 440);
      sizeCanvas(cv, w, 2);
      if (animate) S.rv.stops.push(replay(cv, strokes)); else render(cv, strokes);
    });
  } else {
    const p = document.createElement('p'); p.className = 'said';
    const t = textOf(e);
    if (t) p.textContent = t; else { p.textContent = 'Non ha scritto niente'; p.classList.add('empty'); }
    el.append(p);
  }
  return el;
}
export function renderRevealChrome() {
  const m = S.meta; if (!m || m.status !== 'reveal') return;
  const pos = revealPos(), N = m.n, owner = m.order[pos.c], host = isHost();
  $('albumEyebrow').textContent = `Album ${pos.c + 1} di ${N}`;
  $('albumTitle').textContent = 'L’album di ' + nameOf(owner);
  $('share').hidden = !(pos.fin || pos.s >= N);
  const albums = $('albums'); albums.hidden = !pos.fin;
  if (pos.fin) {
    albums.textContent = '';
    m.order.forEach((s, c) => {
      const b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-pressed', c === pos.c);
      b.append(avatar(s, true), document.createTextNode(nameOf(s)));
      b.onclick = () => { S.rv.browse = c; onReveal(); };
      albums.append(b);
    });
    const on = albums.querySelector('[aria-pressed="true"]');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('stepRow').hidden = !host || pos.fin;
  $('prev').disabled = pos.c === 0 && pos.s <= 1;
  $('again').hidden = !host || !pos.fin;
  $('saveAll').hidden = !pos.fin || N < 2;
  $('exitReveal').hidden = !pos.fin;
  if (!pos.fin) $('next').textContent = pos.s < N ? 'Avanti' : pos.c < N - 1 ? 'Album successivo' : 'Fine';
  $('revealHint').textContent = pos.fin
    ? (host ? 'Sfogliate gli album. Quando volete, rigiocate con gli stessi amici.' : `Sfogliate gli album. Quando volete, ${nameOf(m.host)} avvia la prossima partita.`)
    : (host ? 'Tocca Avanti per mostrare a tutti il prossimo passaggio.' : `${nameOf(m.host)} sta sfogliando gli album per tutti.`);
  $('revealHint').hidden = host && !pos.fin;
}
export function revealNext() {
  const m = S.meta; if (!m || !isHost()) return;
  const nv = nextReveal(m.reveal || { c: 0, s: 1 }, m.n);
  quiet(net.patch(room('meta'), { reveal: nv, at: net.now() }));
}
export function revealPrev() {
  const m = S.meta; if (!m || !isHost()) return;
  const nv = prevReveal(m.reveal || { c: 0, s: 1 }, m.n);
  if (!nv) return;
  quiet(net.patch(room('meta'), { reveal: nv, at: net.now() }));
}

// One album as a picture file, ready to send.
async function albumFile(c) {
  const who = nameOf(S.meta.order[c]);
  const entries = await chainEntries(c), said = verbsOf(entries);
  const blob = await albumBlob({
    code: S.code, title: 'L’album di ' + who, finale: finaleOf(entries),
    entries: entries.map(e => ({
      label: nameOf(e.by) + said[e.k], color: colorOf(e.by), drawing: e.k % 2 === 1,
      text: textOf(e), strokes: e.k % 2 === 1 ? strokesFrom(e.v && e.v.s) : []
    }))
  });
  if (!blob) throw new Error('blob');
  const name = `scarabokki-${S.code}-${c + 1}-${who.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.png`;
  return new File([blob], name, { type: 'image/png' });
}
// Shares the files with the phone's share sheet; where that is missing, downloads them.
// Returns false if the person closed the share sheet.
async function deliver(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
  }
  for (const file of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    if (files.length > 1) await new Promise(res => setTimeout(res, 400));   // browsers drop downloads fired all at once
  }
  toast(files.length > 1 ? 'Immagini degli album scaricate.' : 'Immagine dell’album scaricata.');
  return true;
}
async function busy(btn, job) {
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('busy');
  try { return await job(); }
  catch (e) { console.warn(e); toast('Non sono riuscito a creare le immagini.'); return false; }
  finally { btn.disabled = false; btn.classList.remove('busy'); }
}
export function shareAlbum() {
  const c = revealPos().c;
  return busy($('share'), async () => deliver([await albumFile(c)], 'L’album di ' + nameOf(S.meta.order[c])));
}
// Every album of this game, in one go.
export function saveAll() {
  return busy($('saveAll'), async () => {
    const files = [];
    for (let c = 0; c < S.meta.n; c++) files.push(await albumFile(c));
    return deliver(files, 'Gli album di Scarabokki');
  });
}
