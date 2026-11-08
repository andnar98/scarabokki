import * as net from './net.js';
import { Pad, COLORS, RATIO, UNIT, HEIGHT, render, replay, sizeCanvas, strokesFrom, encode, strokeKey, paintInto } from './draw.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const T = globalThis.__SCARA_TEST || {};
const CFG = {
  maxPlayers: 20, minPlayers: 2, nameMax: 16, textMax: 80,
  grace: 3000,                     // after the deadline, wait this long for last saves before moving on
  gone: T.gone ?? 30000,           // a player offline this long no longer holds up the round
  hostGone: T.hostGone ?? 30000,   // the host offline this long hands control to the next player
  drawTimes: [60, 90, 120, 180],
  writeTimes: [30, 45, 60, 90],
  defaults: { draw: 90, write: 45 }
};
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const AV = ['#FFB3BA', '#FFCFA3', '#FFE58F', '#C5F0A4', '#A8E6CF', '#9EDCF5', '#A9C5FF', '#C7B8FF', '#F2B5F0', '#FFC2D4', '#E3CDB0', '#B8E0D2'];
const IDEAS = [
  'Un pinguino che vende gelati al Polo Nord', 'Un gatto astronauta che ha perso le chiavi', 'La nonna che fa skateboard',
  'Una pizza innamorata di un ananas', 'Un dinosauro dal parrucchiere', 'Una mucca che fa yoga al tramonto',
  'Il Wi-Fi che non prende', 'Un fantasma che ha paura del buio', 'Una giraffa in ascensore',
  'Un riccio che abbraccia un palloncino', 'Il lunedì mattina', 'Una banana in fuga dalla polizia',
  'Un polpo che suona la batteria', 'Babbo Natale in infradito', 'Un vampiro dal dentista',
  'Una lumaca alla Formula 1', 'Un cane che porta a spasso il padrone', 'La Torre di Pisa che si raddrizza',
  'Un robot che piange guardando un film', 'Una tartaruga con il jetpack', 'Un panino gigante che mangia una persona',
  'Un orso che fa la spesa', 'Il sole che va in vacanza', 'Una sirena in metropolitana',
  'Un gufo che fa il DJ', 'Un supereroe con il raffreddore', 'Una pecora che conta gli umani per dormire',
  'Il caffè che si sveglia da solo', 'Un elefante sulle punte', 'Un alieno che ordina un kebab',
  'Una scarpa che scappa dal piede', 'Il gatto che si siede sulla tastiera', 'Un cactus che vuole un abbraccio',
  'Una mummia che fa il bucato', 'Un pirata con il mal di mare', 'Un cervello che va in palestra',
  'La luna che si mangia una fetta di formaggio', 'Un fenicottero che gioca a calcio', 'Il frigorifero che russa',
  'Un mago a cui sparisce il coniglio'
];

// ---------------------------------------------------------------------------
// State and small helpers
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const S = {
  uid: null, code: null, seat: null, attachedAt: 0,
  meta: null, players: {}, presence: {}, presenceLoaded: false, done: {},
  subs: [], doneSub: null, doneKey: null, tick: 0,
  roundKey: null, roundToken: 0, task: null, submitted: false, autoSent: null,
  advancing: null, hosting: false, connected: true, screen: 'loading',
  rv: { key: null, chain: -1, shown: 0, browse: null, cache: {}, stops: [] },
  claimSubs: []
};
const room = p => 'rooms/' + S.code + (p ? '/' + p : '');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('scarabokki.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('scarabokki.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('scarabokki.' + k); } catch (e) {} }
};
const noop = () => {};
const quiet = p => (p && p.catch ? p.catch(err => console.warn('[scarabokki]', err && (err.code || err.message))) : p);
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const nameOf = seat => (S.players[seat] && S.players[seat].name) || 'Qualcuno';
const colorOf = seat => AV[hash(String(seat)) % AV.length];
const isOnline = seat => !!(S.presence[seat] && S.presence[seat].on);
function isGone(seat, now) {
  const p = S.presence[seat];
  return !p || (!p.on && now - (p.at || 0) > CFG.gone);
}
const isHost = () => !!S.meta && S.meta.host === S.seat;
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const lobbyIds = () => Object.keys(S.players).sort((a, b) => (S.players[a].joined || 0) - (S.players[b].joined || 0) || (a < b ? -1 : 1));
const kindOf = r => (r === 0 ? 'first' : r % 2 ? 'draw' : 'describe');
const settings = () => Object.assign({}, CFG.defaults, (S.meta && S.meta.settings) || {});
const gameKey = () => (S.meta && S.meta.game) || 0;

function avatar(seat, small) {
  const el = document.createElement('span');
  el.className = 'av' + (small ? ' sm' : '');
  el.style.setProperty('--av', colorOf(seat));
  el.textContent = (nameOf(seat).trim()[0] || '?').toUpperCase();
  el.setAttribute('aria-hidden', 'true');
  if (!isOnline(seat)) el.dataset.off = '';
  return el;
}
function tag(text, cls) { const t = document.createElement('span'); t.className = 'tagp' + (cls ? ' ' + cls : ''); t.textContent = text; return t; }

let toastT = 0;
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
function ask(title, text, yes = 'Conferma') {
  return new Promise(resolve => {
    $('askTitle').textContent = title; $('askText').textContent = text; $('askYes').textContent = yes;
    const box = $('ask'); box.hidden = false;
    const done = v => { box.hidden = true; $('askYes').onclick = $('askNo').onclick = box.onclick = null; resolve(v); };
    $('askYes').onclick = () => done(true);
    $('askNo').onclick = () => done(false);
    box.onclick = e => { if (e.target === box) done(false); };
    $('askYes').focus({ preventScroll: true });
  });
}

const SCREENS = ['loading', 'home', 'lobby', 'write', 'draw', 'wait', 'reveal', 'claim', 'spectate'];
function show(name) {
  if (S.screen === name) return;
  for (const s of SCREENS) $('s-' + s).hidden = s !== name;
  S.screen = name;
  if (name === 'draw') pad.fit();
}
function loading(text) { $('loadingText').textContent = text; show('loading'); }

// ---------------------------------------------------------------------------
// Device: viewport, wake lock, connection banner
// ---------------------------------------------------------------------------
function setupViewport() {
  const vv = window.visualViewport;
  const set = () => document.documentElement.style.setProperty('--app-h', Math.round(vv ? vv.height : window.innerHeight) + 'px');
  set();
  if (vv) { vv.addEventListener('resize', set); vv.addEventListener('scroll', () => window.scrollTo(0, 0)); }
  window.addEventListener('resize', set);
}
let wake = null;
async function keepAwake() {
  try {
    if (!S.code || wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch (e) { wake = null; }
}
let offT = 0;
function onConnection(ok) {
  S.connected = ok;
  clearTimeout(offT);
  if (ok) { $('offline').hidden = true; if (S.seat) markPresent(); }
  else offT = setTimeout(() => { if (!S.connected && S.screen !== 'home') $('offline').hidden = false; }, 1500);
}
function markPresent() {
  if (!S.seat || !S.code) return;
  const p = room('presence/' + S.seat);
  quiet(net.onDrop(p, { on: false, at: net.TS }));
  quiet(net.put(p, { on: true, at: net.TS }));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function codeFromHash() { const m = /^#([A-Za-z]{4})$/.exec(location.hash); return m ? m[1].toUpperCase() : null; }
function setHash(code) { if (location.hash !== '#' + code) history.replaceState(null, '', '#' + code); }
function clearHash() { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
function getName() { return $('name').value.trim().replace(/\s+/g, ' ').slice(0, CFG.nameMax); }

async function showHome(prefill) {
  detach();
  $('name').value = store.get('name', '') || '';
  $('code').value = prefill || '';
  $('s-home').classList.toggle('invited', !!prefill);
  $('join').classList.toggle('primary', !!prefill);
  $('create').classList.toggle('primary', !prefill);
  $('joinText').textContent = prefill
    ? `Ti hanno invitato nella partita ${prefill}: scrivi il tuo nome qui sopra e tocca Entra.`
    : 'Scrivi il codice di 4 lettere che ti hanno mandato.';
  $('resume').hidden = true;
  show('home');
  const last = store.get('last');
  if (!prefill && last) {
    try {
      const [meta, seat] = await Promise.all([net.get(`rooms/${last}/meta`), findMySeat(last)]);
      if (meta && seat && S.screen === 'home') {
        $('resume').hidden = false; $('resume').textContent = 'Torna alla partita ' + last; $('resume').dataset.code = last;
        $('create').classList.remove('primary');
      } else if (!meta) store.del('last');
    } catch (e) {}
  }
}
function needName() {
  const n = getName();
  if (!n) { toast('Scrivi il tuo nome per giocare.'); $('name').focus(); return null; }
  store.set('name', n);
  return n;
}
async function findMySeat(code) {
  const seat = await net.get(`rooms/${code}/members/${S.uid}`);
  if (!seat) return null;
  const p = await net.get(`rooms/${code}/players/${seat}`);
  return p && p.uid === S.uid ? seat : null;
}

async function tryEnter(code, auto) {
  loading('Entro nella partita ' + code + '…');
  let meta;
  try { meta = await net.get(`rooms/${code}/meta`); }
  catch (e) { await showHome(code); toast('Nessuna connessione. Riprova tra poco.'); return; }
  if (!meta) {
    clearHash(); if (store.get('last') === code) store.del('last');
    await showHome(); toast(`Non trovo nessuna partita con il codice ${code}.`); return;
  }
  const seat = await findMySeat(code).catch(() => null);
  if (seat) return attach(code, seat);
  if (meta.status === 'lobby') {
    const name = auto ? (store.get('name', '') || '').trim() : needName();
    if (!name) { await showHome(code); setHash(code); $('name').focus(); return; }
    return joinLobby(code, name);
  }
  setHash(code);
  return showClaim(code);
}

async function joinLobby(code, name) {
  loading('Entro nella partita ' + code + '…');
  try {
    const players = (await net.get(`rooms/${code}/players`)) || {};
    if (Object.keys(players).length >= CFG.maxPlayers) { await showHome(); toast('La stanza è piena: al massimo 20 giocatori.'); return; }
    await net.patch(`rooms/${code}`, {
      [`players/${S.uid}`]: { name, uid: S.uid, joined: net.TS },
      [`members/${S.uid}`]: S.uid
    });
    attach(code, S.uid);
  } catch (e) {
    console.warn(e); await showHome(); toast('Non sono riuscito a entrare. Forse la partita è appena cominciata: riprova.');
  }
}

async function createRoom() {
  const name = needName(); if (!name) return;
  loading('Creo la partita…');
  const saved = store.get('settings', {}) || {};
  for (let i = 0; i < 8; i++) {
    let code = '';
    for (let j = 0; j < 4; j++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const now = net.now();
    let ok = false;
    try {
      ok = await net.txn(`rooms/${code}/meta`, m => (m === null ? {
        host: S.uid, status: 'lobby', createdAt: now, at: now, round: -1, game: 1,
        settings: { draw: CFG.drawTimes.includes(saved.draw) ? saved.draw : CFG.defaults.draw, write: CFG.writeTimes.includes(saved.write) ? saved.write : CFG.defaults.write }
      } : undefined));
    } catch (e) { console.warn(e); }
    if (ok) {
      quiet(net.put(`index/${code}`, now));
      await joinLobby(code, name);
      setTimeout(cleanup, 4000);
      return;
    }
  }
  await showHome(); toast('Non riesco a creare la partita. Controlla la connessione e riprova.');
}

// Rooms nobody has used for a day are deleted, so the free database never fills up.
async function cleanup() {
  try {
    const idx = (await net.get('index')) || {};
    const old = Object.keys(idx).filter(c => idx[c] < net.now() - 86400000).slice(0, 12);
    for (const c of old) {
      const at = await net.get(`rooms/${c}/meta/at`);
      if (at && at > net.now() - 86400000) continue;
      try { await net.del(`rooms/${c}`); await net.del(`index/${c}`); } catch (e) {}
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Claim a seat (game in progress, this browser is not in it)
// ---------------------------------------------------------------------------
function stopClaim() { S.claimSubs.forEach(u => u()); S.claimSubs = []; }
function showClaim(code) {
  detach(); stopClaim();
  S.code = code;
  $('claimCode').textContent = 'Partita ' + code;
  show('claim');
  let meta = null;
  const draw = () => {
    const ul = $('claimList'); ul.textContent = '';
    const order = (meta && meta.order) || [];
    const free = order.filter(s => S.players[s] && !isOnline(s));
    for (const s of free) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'kick'; b.textContent = 'Sono io';
      b.onclick = () => claim(code, s);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(s);
      li.append(avatar(s), nm, b);
      ul.append(li);
    }
    if (!free.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="nm"><small>Tutti i giocatori sono collegati.</small></span>';
      ul.append(li);
    }
  };
  S.claimSubs.push(net.on(`rooms/${code}/players`, v => { S.players = v || {}; draw(); }));
  S.claimSubs.push(net.on(`rooms/${code}/presence`, v => { S.presence = v || {}; draw(); }));
  S.claimSubs.push(net.on(`rooms/${code}/meta`, v => {
    meta = v;
    if (!v) { stopClaim(); showHome(); toast('La partita è finita.'); return; }
    if (v.status === 'lobby') {
      const name = (store.get('name', '') || '').trim();
      stopClaim();
      if (name) joinLobby(code, name); else showHome(code);
      return;
    }
    draw();
  }));
}
async function claim(code, seat) {
  const ok = await ask('Riprendere il posto di ' + nameOf(seat) + '?', 'Continuerai la partita da questo telefono. Fallo solo se quel posto è davvero tuo.', 'Sono io');
  if (!ok) return;
  stopClaim();
  loading('Riprendo il tuo posto…');
  try {
    await net.patch(`rooms/${code}`, { [`players/${seat}/uid`]: S.uid, [`members/${S.uid}`]: seat });
    attach(code, seat);
  } catch (e) {
    console.warn(e); showClaim(code); toast('Non è stato possibile: quel giocatore risulta collegato.');
  }
}

// ---------------------------------------------------------------------------
// Attach to a room
// ---------------------------------------------------------------------------
function detach() {
  stopClaim();
  S.subs.forEach(u => u()); S.subs = [];
  if (S.doneSub) S.doneSub(); S.doneSub = null; S.doneKey = null;
  clearInterval(S.tick);
  S.roundToken++;
  stopReveal();
  Object.assign(S, { code: null, seat: null, meta: null, players: {}, presence: {}, presenceLoaded: false, done: {}, roundKey: null, task: null, submitted: false });
  S.rv = { key: null, chain: -1, shown: 0, browse: null, cache: {}, stops: [] };
  if (wake) { quiet(wake.release()); wake = null; }
}
function attach(code, seat) {
  detach();
  S.code = code; S.seat = seat; S.attachedAt = Date.now();
  setHash(code); store.set('last', code);
  S.subs.push(net.on(room('meta'), onMeta));
  S.subs.push(net.on(room('players'), onPlayers));
  S.subs.push(net.on(room('presence'), v => { S.presence = v || {}; S.presenceLoaded = true; refreshLists(); }));
  if (S.connected) markPresent();
  S.tick = setInterval(tick, 500);
  keepAwake();
}
async function leaveRoom() {
  const m = S.meta, seat = S.seat;
  const ok = await ask('Uscire dalla stanza?', m && m.status !== 'lobby' ? 'La partita continuerà senza di te.' : 'Potrai rientrare con lo stesso codice.', 'Esci');
  if (!ok) return;
  const up = {};
  if (!m || m.status === 'lobby') {
    up[`players/${seat}`] = null; up[`members/${S.uid}`] = null; up[`presence/${seat}`] = null;
    if (isHost()) {
      const next = lobbyIds().filter(id => id !== seat && isOnline(id))[0] || lobbyIds().filter(id => id !== seat)[0];
      if (next) up['meta/host'] = next;
    }
  }
  const code = S.code;
  quiet(net.cancelDrop(room('presence/' + seat)));
  try { if (Object.keys(up).length) await net.patch(`rooms/${code}`, up); else await net.put(`rooms/${code}/presence/${seat}`, { on: false, at: net.TS }); } catch (e) {}
  store.del('last'); clearHash();
  showHome();
}
function leaveToHome(msg) { store.del('last'); clearHash(); showHome(); if (msg) toast(msg, 5000); }

function onPlayers(v) {
  S.players = v || {};
  const me = S.players[S.seat];
  if (S.seat && (!me || me.uid !== S.uid)) {
    leaveToHome(me ? 'Il tuo posto è stato ripreso da un altro dispositivo.' : 'Non sei più in questa stanza.');
    return;
  }
  refreshLists();
}
function refreshLists() {
  if (S.screen === 'lobby') renderLobby();
  if (S.screen === 'wait') renderWait();
  if (S.screen === 'reveal') renderRevealChrome();
}

function onMeta(m) {
  if (!m) { leaveToHome('Questa partita non esiste più.'); return; }
  const prev = S.meta; S.meta = m;
  if (m.status === 'lobby') {
    if (S.doneSub) { S.doneSub(); S.doneSub = null; S.doneKey = null; }
    S.roundKey = null; S.task = null; stopReveal();
    renderLobby(); show('lobby');
    if (prev && prev.status !== 'lobby' && prev.host !== S.seat) toast('Nuova partita! Aspettate che ' + nameOf(m.host) + ' la faccia iniziare.');
    return;
  }
  if (m.status === 'playing') {
    if (!(m.order || []).includes(S.seat)) { show('spectate'); return; }
    if (S.doneKey !== m.rkey) {
      if (S.doneSub) S.doneSub();
      S.done = {}; S.doneKey = m.rkey;
      S.doneSub = net.on(room('done/' + m.rkey), v => { S.done = v || {}; onDone(); });
    }
    if (S.roundKey !== m.rkey) startRound(m.round);
    return;
  }
  if (m.status === 'reveal') {
    if (S.doneSub) { S.doneSub(); S.doneSub = null; S.doneKey = null; }
    S.roundKey = null; S.task = null;
    onReveal();
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function renderLobby() {
  const m = S.meta; if (!m) return;
  $('lobbyCode').textContent = S.code;
  const ids = lobbyIds();
  $('count').textContent = `${ids.length}/${CFG.maxPlayers}`;
  const ul = $('lobbyPlayers'); ul.textContent = '';
  for (const id of ids) {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(id);
    if (id === S.seat) { const sm = document.createElement('small'); sm.textContent = ' (tu)'; nm.append(sm); }
    li.append(avatar(id), nm);
    if (id === m.host) li.append(tag('Capo', 'host'));
    if (!isOnline(id)) li.append(tag('non collegato', 'off'));
    if (isHost() && id !== S.seat) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kick'; b.textContent = 'Togli';
      b.setAttribute('aria-label', 'Togli ' + nameOf(id));
      b.onclick = () => kick(id); li.append(b);
    }
    ul.append(li);
  }
  const host = isHost(), set = settings();
  const chips = (el, list, cur, key) => {
    el.textContent = '';
    for (const v of list) {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = v < 60 ? v + 's' : (v % 60 ? (v / 60).toFixed(1).replace('.', ',') : v / 60) + ' min';
      b.setAttribute('aria-pressed', v === cur); b.disabled = !host;
      b.onclick = () => { quiet(net.put(room('meta/settings/' + key), v)); store.set('settings', Object.assign({}, set, { [key]: v })); };
      el.append(b);
    }
  };
  chips($('drawTimes'), CFG.drawTimes, set.draw, 'draw');
  chips($('writeTimes'), CFG.writeTimes, set.write, 'write');
  $('settingsWho').textContent = host ? '' : 'li sceglie ' + nameOf(m.host);
  const online = ids.filter(id => id === S.seat || isOnline(id)).length;
  $('start').hidden = !host;
  $('start').disabled = online < CFG.minPlayers;
  const rounds = online;
  $('lobbyHint').textContent = host
    ? (online < CFG.minPlayers ? 'Invita almeno un amico: mandagli il link con “Invita”.' : `Si giocano ${rounds} turni, uno per giocatore.`)
    : `Aspetta che ${nameOf(m.host)} inizi la partita.`;
}
async function kick(id) {
  const ok = await ask('Togliere ' + nameOf(id) + '?', 'Potrà rientrare con il codice della stanza.', 'Togli');
  if (!ok) return;
  const p = S.players[id];
  quiet(net.patch(room(), { [`players/${id}`]: null, [`members/${p && p.uid}`]: null, [`presence/${id}`]: null }));
}
async function invite() {
  const url = location.origin + location.pathname + '#' + S.code;
  const text = `Gioca a Scarabokki con me! Codice ${S.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Scarabokki', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copiato: incollalo nel gruppo.'); }
  catch (e) { toast('Il codice è ' + S.code); }
}
async function startGame() {
  const ids = lobbyIds().filter(id => id === S.seat || isOnline(id));
  if (ids.length < CFG.minPlayers) { toast('Servono almeno 2 giocatori collegati.'); return; }
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const now = net.now(), set = settings();
  $('start').disabled = true;
  try {
    await net.patch(room(), {
      'meta/status': 'playing', 'meta/round': 0, 'meta/rkey': '0', 'meta/n': ids.length, 'meta/order': ids,
      'meta/endsAt': now + set.write * 1000 + 1500, 'meta/at': now, 'meta/reveal': null,
      done: null, work: null
    });
  } catch (e) { console.warn(e); toast('Non sono riuscito a far partire il gioco. Riprova.'); $('start').disabled = false; }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function idea(seed) { return IDEAS[(seed === undefined ? Math.floor(Math.random() * 1e9) : seed) % IDEAS.length]; }
const isEmpty = (v, kind) => !v || (kind === 'text' ? !(typeof v.t === 'string' && v.t.trim()) : !strokesFrom(v.s).length);
const localKey = r => `work.${S.code}.${gameKey()}.${r}`;

// The entry this player works from: the previous one in the chain, or, if that one
// was left empty, the last non-empty entry of the same type.
async function findSource(c, r) {
  const m = S.meta, order = m.order, N = order.length;
  const want = r % 2 ? 'text' : 'drawing';
  for (let k = r - 1; k >= 0; k -= 2) {
    const by = order[((c - k) % N + N) % N];
    const v = await net.get(room(`work/${k}/${by}`));
    if (!isEmpty(v, want)) return { by, v, k };
  }
  return null;
}

async function startRound(r) {
  const token = ++S.roundToken;
  const m = S.meta, order = m.order, N = order.length, i = order.indexOf(S.seat);
  const c = (i + r) % N;
  let kind = kindOf(r);
  S.roundKey = m.rkey; S.submitted = false; S.autoSent = null;
  S.task = { r, c, kind, token, ready: false, text: '', note: '' };
  pad.locked = true;
  loading(r === 0 ? 'Si comincia!' : 'Arriva il turno ' + (r + 1) + '…');
  let mine = null, src = null;
  for (let attempt = 0; ; attempt++) {
    try {
      [mine, src] = await Promise.all([net.get(room(`work/${r}/${S.seat}`)), kind === 'first' ? null : findSource(c, r)]);
      break;
    } catch (e) {
      if (token !== S.roundToken) return;
      await new Promise(res => setTimeout(res, Math.min(4000, 800 * (attempt + 1))));
      if (token !== S.roundToken) return;
    }
  }
  if (token !== S.roundToken || !S.task) return;
  const t = S.task;
  const local = store.get(localKey(r));
  // drop backups from other rounds of this room
  if (r > 0) store.del(localKey(r - 1));

  if (kind === 'draw') {
    t.prompt = src ? src.v.t.trim() : idea(hash(S.code + ':' + c + ':' + r));
    t.note = src ? (src.k === r - 1 ? '' : 'Il turno prima era vuoto: ecco una frase più vecchia.') : 'Il turno prima era vuoto: ecco una frase a sorpresa.';
    let strokes = strokesFrom(mine && mine.s);
    const ls = local && local.s ? strokesFrom(local.s) : [];
    if (ls.length > strokes.length) {
      strokes = ls;
      const obj = {}; strokes.forEach((s, j) => { obj[strokeKey(j)] = encode(s); });
      quiet(net.put(room(`work/${r}/${S.seat}/s`), obj));
    }
    pad.load(strokes); updUndo();
    $('drawEyebrow').textContent = `Turno ${r + 1} di ${N} · Disegna`;
    $('drawPrompt').textContent = t.prompt;
  } else {
    if (kind === 'describe') {
      if (src) t.seen = strokesFrom(src.v.s);
      else { kind = t.kind = 'free'; }
    }
    t.text = (mine && typeof mine.t === 'string' && mine.t) || (local && local.t) || '';
    $('phrase').value = t.text; countChars();
    $('writeEyebrow').textContent = `Turno ${r + 1} di ${N}`;
    $('writeTitle').textContent = kind === 'first' ? 'Scrivi una frase' : kind === 'describe' ? 'Cosa vedi nel disegno?' : 'Scrivi una frase nuova';
    $('phrase').placeholder = kind === 'describe' ? 'Descrivilo in poche parole…' : 'Scrivi qui…';
    $('idea').hidden = kind === 'describe';
    $('writeNoteText').textContent = kind === 'first'
      ? 'Qualcosa di divertente da far disegnare a chi viene dopo di te.'
      : 'Il disegno che dovevi descrivere è rimasto vuoto. Scrivi una frase da far disegnare.';
  }
  t.ready = true;
  if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) {}
  if (S.done[S.seat] === true) { S.submitted = true; showWait(); }
  else showTask();
  if (t.note) toast(t.note);
}

function showTask() {
  const t = S.task; if (!t || !t.ready) return;
  if (t.kind === 'draw') { pad.locked = false; show('draw'); }
  else {
    show('write');
    const seen = $('seen');
    seen.hidden = t.kind !== 'describe'; $('writeNote').hidden = t.kind === 'describe';
    if (t.kind === 'describe') fitSeen();
  }
  tick();
}
function fitSeen() {
  const t = S.task; if (!t || t.kind !== 'describe' || S.screen !== 'write') return;
  const r = $('writeStage').getBoundingClientRect();
  const w = Math.floor(Math.min(r.width, r.height / RATIO));
  if (w < 40) return;
  sizeCanvas($('seen'), w); render($('seen'), t.seen || []);
}

// --- drawing autosave: each finished stroke is saved on its own, undo removes it ---
const pad = new Pad($('pad'), $('stage'), {
  onAdd(s, i) {
    const t = S.task; if (!t || t.kind !== 'draw') return;
    quiet(net.put(room(`work/${t.r}/${S.seat}/s/${strokeKey(i)}`), encode(s)));
    saveLocalDraw(); updUndo();
  },
  onUndo(i) {
    const t = S.task; if (!t || t.kind !== 'draw') return;
    quiet(net.del(room(`work/${t.r}/${S.seat}/s/${strokeKey(i)}`)));
    saveLocalDraw(); updUndo();
  }
});
function saveLocalDraw() {
  const t = S.task; if (!t) return;
  const obj = {}; pad.strokes.forEach((s, j) => { obj[strokeKey(j)] = encode(s); });
  store.set(localKey(t.r), { s: obj });
}
function updUndo() { $('undo').disabled = !pad.strokes.length; }

// --- text autosave ---
let textT = 0;
function countChars() { $('phraseCount').textContent = `${$('phrase').value.length}/${CFG.textMax}`; }
function onText() {
  const t = S.task; if (!t) return;
  const v = $('phrase').value.replace(/\n/g, ' ').slice(0, CFG.textMax);
  if (v !== $('phrase').value) $('phrase').value = v;
  t.text = v; countChars();
  store.set(localKey(t.r), { t: v });
  clearTimeout(textT); textT = setTimeout(flushText, 450);
}
function flushText() {
  clearTimeout(textT);
  const t = S.task; if (!t || t.kind === 'draw') return;
  quiet(net.put(room(`work/${t.r}/${S.seat}/t`), t.text.trim()));
}

async function submit(auto) {
  const t = S.task; if (!t || !t.ready) return;
  if (t.kind === 'draw') {
    pad.finish();
    if (!auto && !pad.strokes.length) { toast('Disegna qualcosa prima di consegnare.'); return; }
    pad.locked = true;
  } else {
    if (!auto && !t.text.trim()) { toast('Scrivi qualcosa prima di consegnare.'); $('phrase').focus(); return; }
    flushText();
    $('phrase').blur();
  }
  S.submitted = true;
  showWait();
  quiet(net.put(room(`done/${t.r}/${S.seat}`), true));
}
function unsubmit() {
  const t = S.task, m = S.meta; if (!t || !m || m.endsAt - net.now() < 1500) return;
  S.submitted = false;
  quiet(net.put(room(`done/${t.r}/${S.seat}`), false));
  showTask();
}

function showWait() { show('wait'); renderWait(); }
function renderWait() {
  const m = S.meta; if (!m || m.status !== 'playing') return;
  const order = m.order || [], r = m.round;
  const done = order.filter(s => S.done[s] === true).length;
  $('waitEyebrow').textContent = `Turno ${r + 1} di ${order.length}`;
  $('waitCount').textContent = `${done} di ${order.length} ${done === 1 ? 'ha' : 'hanno'} finito`;
  $('waitMeter').style.width = Math.round(done / Math.max(1, order.length) * 100) + '%';
  const ul = $('waitPlayers'); ul.textContent = '';
  const doing = r % 2 ? 'sta disegnando' : 'sta scrivendo';
  for (const s of order) {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(s);
    if (s === S.seat) { const sm = document.createElement('small'); sm.textContent = ' (tu)'; nm.append(sm); }
    li.append(avatar(s), nm);
    if (S.done[s] === true) li.append(tag('ha finito', 'ok'));
    else if (!isOnline(s)) li.append(tag('non collegato', 'off'));
    else li.append(tag(doing));
    ul.append(li);
  }
}

function onDone() {
  const t = S.task;
  if (t && t.ready) {
    const mine = S.done[S.seat] === true;
    if (mine && (S.screen === 'draw' || S.screen === 'write')) { pad.cancelStroke(); flushText(); S.submitted = true; showWait(); }
    else if (!mine && S.screen === 'wait' && !S.submitted) showTask();
  }
  if (S.screen === 'wait') renderWait();
  maybeAdvance(net.now());
}

// --- timers, advancing and host hand-over (every client runs these; transactions keep one winner) ---
function tick() {
  const m = S.meta; if (!m) return;
  const now = net.now();
  if (m.status === 'playing' && S.task && S.task.ready && S.roundKey === m.rkey) {
    const left = m.endsAt - now;
    for (const el of document.querySelectorAll('.timer')) {
      el.textContent = fmt(left);
      el.classList.toggle('urgent', left > 0 && left <= 10000);
    }
    $('edit').disabled = left < 1500;
    if (left <= 0 && S.autoSent !== m.rkey && S.done[S.seat] !== true) { S.autoSent = m.rkey; submit(true); }
    maybeAdvance(now);
  }
  maybeTakeHost(now);
}
function maybeAdvance(now) {
  const m = S.meta;
  if (!m || m.status !== 'playing' || !S.task || !(m.order || []).includes(S.seat)) return;
  const order = m.order, done = S.done;
  const all = order.every(s => done[s] === true);
  const timeUp = now > m.endsAt + CFG.grace;
  const someone = order.some(s => done[s] === true);
  const restGone = S.presenceLoaded && order.every(s => done[s] === true || isGone(s, now));
  if (all || timeUp || (someone && restGone)) advance(m.round);
}
async function advance(r) {
  if (S.advancing === r) return;
  S.advancing = r;
  try {
    await net.txn(room('meta'), m => {
      if (m === null) return m;
      if (m.status !== 'playing' || m.round !== r) return;
      const now = net.now(), next = r + 1, set = Object.assign({}, CFG.defaults, m.settings || {});
      m.at = now;
      if (next >= m.n) { m.status = 'reveal'; m.round = next; m.rkey = null; m.endsAt = null; m.reveal = { c: 0, s: 1 }; }
      else { m.round = next; m.rkey = String(next); m.endsAt = now + (next % 2 ? set.draw : set.write) * 1000; }
      return m;
    });
  } catch (e) { console.warn('[scarabokki] advance', e && e.message); }
  setTimeout(() => { if (S.advancing === r) S.advancing = null; }, 3000);
}
function maybeTakeHost(now) {
  const m = S.meta;
  if (!m || !S.seat || m.host === S.seat || !S.presenceLoaded || S.hosting) return;
  if (Date.now() - S.attachedAt < 6000) return;
  const hp = S.presence[m.host];
  if (S.players[m.host] && hp && (hp.on || now - (hp.at || 0) < CFG.hostGone)) return;
  const pool = m.status === 'lobby' ? lobbyIds() : (m.order || []).concat(lobbyIds());
  const first = pool.find(id => S.players[id] && isOnline(id));
  if (first !== S.seat) return;
  S.hosting = true;
  const old = m.host;
  net.txn(room('meta'), x => { if (x === null) return x; if (x.host !== old) return; x.host = S.seat; return x; })
    .then(ok => { if (ok) toast('Ora sei tu il capo della stanza.'); })
    .catch(noop)
    .finally(() => setTimeout(() => { S.hosting = false; }, 3000));
}

// ---------------------------------------------------------------------------
// Reveal: the host steps through every album, everyone sees the same thing
// ---------------------------------------------------------------------------
function stopReveal() { (S.rv.stops || []).forEach(f => f()); S.rv.stops = []; }
function chainEntries(c) {
  const m = S.meta, key = gameKey() + ':' + c;
  if (S.rv.cache[key]) return S.rv.cache[key];
  const order = m.order, N = m.n;
  const p = Promise.all(Array.from({ length: N }, (_, k) => {
    const by = order[((c - k) % N + N) % N];
    return net.get(room(`work/${k}/${by}`)).then(v => ({ k, by, v }), () => ({ k, by, v: null, failed: true }));
  })).then(list => { if (list.some(e => e.failed)) delete S.rv.cache[key]; return list; });
  S.rv.cache[key] = p;
  return p;
}
function revealPos() {
  const m = S.meta, N = m.n, rv = m.reveal || { c: 0, s: 1 };
  if (rv.fin) return { c: S.rv.browse !== null ? S.rv.browse : Math.min(rv.c, N - 1), s: N, fin: true };
  return { c: Math.min(rv.c, N - 1), s: Math.max(1, Math.min(rv.s, N)), fin: false };
}
async function onReveal() {
  show('reveal');
  const m = S.meta, pos = revealPos(), N = m.n;
  renderRevealChrome();
  const viewKey = gameKey() + ':' + pos.c;
  const fresh = S.rv.key !== viewKey;
  const entries = await chainEntries(pos.c);
  if (S.meta !== m && revealPos().c !== pos.c) return;   // moved on while loading
  if (pos.c + 1 < N) chainEntries(pos.c + 1);            // prefetch the next album
  const feed = $('feed');
  if (fresh) { stopReveal(); feed.textContent = ''; S.rv.key = viewKey; S.rv.shown = 0; }
  const from = S.rv.shown, to = pos.s;
  if (to < from) { stopReveal(); feed.textContent = ''; S.rv.shown = 0; return onReveal(); }
  for (let k = from; k < to; k++) feed.append(entryEl(entries[k], k === to - 1 && !pos.fin && !fresh));
  S.rv.shown = to;
  requestAnimationFrame(() => {
    const last = feed.lastElementChild;
    if (last && !fresh) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
    else if (fresh) feed.scrollTop = pos.fin ? 0 : feed.scrollHeight;
  });
}
function entryEl(e, animate) {
  const el = document.createElement('article');
  el.className = 'entry';
  const who = document.createElement('div'); who.className = 'who';
  const b = document.createElement('b'); b.textContent = nameOf(e.by);
  const drawing = e.k % 2 === 1;
  who.append(avatar(e.by, true), b, document.createTextNode(drawing ? ' ha disegnato' : e.k === 0 ? ' ha scritto' : ' ha visto'));
  el.append(who);
  if (drawing) {
    const strokes = strokesFrom(e.v && e.v.s);
    if (!strokes.length) { const p = document.createElement('div'); p.className = 'blank'; p.textContent = 'Foglio bianco'; el.append(p); return el; }
    const cv = document.createElement('canvas'); cv.className = 'sheet';
    el.append(cv);
    requestAnimationFrame(() => {
      const w = Math.min($('feed').clientWidth - 4, 440);
      sizeCanvas(cv, w);
      if (animate) S.rv.stops.push(replay(cv, strokes)); else render(cv, strokes);
    });
  } else {
    const p = document.createElement('p'); p.className = 'said';
    const t = e.v && typeof e.v.t === 'string' ? e.v.t.trim() : '';
    if (t) p.textContent = t; else { p.textContent = 'Non ha scritto niente'; p.classList.add('empty'); }
    el.append(p);
  }
  return el;
}
function renderRevealChrome() {
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
  }
  $('next').hidden = !host || pos.fin;
  $('again').hidden = !host || !pos.fin;
  $('exitReveal').hidden = !pos.fin;
  if (!pos.fin) $('next').textContent = pos.s < N ? 'Avanti' : pos.c < N - 1 ? 'Album successivo' : 'Fine';
  $('revealHint').textContent = pos.fin
    ? (host ? 'Sfogliate gli album. Quando volete, rigiocate con gli stessi amici.' : `Sfogliate gli album. Quando volete, ${nameOf(m.host)} avvia la prossima partita.`)
    : (host ? 'Tocca Avanti per mostrare a tutti il prossimo passaggio.' : `${nameOf(m.host)} sta sfogliando gli album per tutti.`);
  $('revealHint').hidden = host && !pos.fin;
}
function revealNext() {
  const m = S.meta; if (!m || !isHost()) return;
  const rv = m.reveal || { c: 0, s: 1 }, N = m.n;
  let nv;
  if (rv.s < N) nv = { c: rv.c, s: rv.s + 1 };
  else if (rv.c < N - 1) nv = { c: rv.c + 1, s: 1 };
  else nv = { c: rv.c, s: N, fin: true };
  quiet(net.patch(room('meta'), { reveal: nv, at: net.now() }));
}
async function newGame() {
  const ok = await ask('Nuova partita?', 'Gli album di questa partita verranno cancellati. Salvate prima quelli che volete tenere.', 'Nuova partita');
  if (!ok) return;
  const m = S.meta;
  quiet(net.patch(room(), {
    'meta/status': 'lobby', 'meta/round': -1, 'meta/rkey': null, 'meta/order': null, 'meta/n': null,
    'meta/endsAt': null, 'meta/reveal': null, 'meta/at': net.now(), 'meta/game': (m.game || 0) + 1,
    done: null, work: null
  }));
}

// Album as one tall picture, ready to send in the group chat.
function wrapLines(ctx, text, max) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
async function albumBlob(c) {
  const m = S.meta, entries = await chainEntries(c), owner = m.order[c];
  try { await Promise.all([document.fonts.load('56px "Lilita One"'), document.fonts.load('600 30px Figtree')]); } catch (e) {}
  const W = 1080, P = 64, inner = W - P * 2, DW = 760, DH = Math.round(DW * RATIO);
  const disp = '"Lilita One", "Arial Rounded MT Bold", sans-serif', body = 'Figtree, system-ui, sans-serif';
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `52px ${disp}`;
  const blocks = entries.map(e => {
    const drawing = e.k % 2 === 1;
    if (drawing) { const strokes = strokesFrom(e.v && e.v.s); return { e, drawing, strokes, h: 48 + (strokes.length ? DH : 120) + 44 }; }
    const t = (e.v && typeof e.v.t === 'string' && e.v.t.trim()) || '…';
    const lines = wrapLines(meas, t, inner - 64);
    return { e, drawing, lines, h: 48 + lines.length * 62 + 44 + 44 };
  });
  const H = 230 + blocks.reduce((a, b) => a + b.h, 0) + 90;
  const f = Math.min(1, Math.sqrt(14e6 / (W * H)));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * f); cv.height = Math.round(H * f);
  const x = cv.getContext('2d'); x.scale(f, f);
  const bg = x.createLinearGradient(0, 0, W * .4, H); bg.addColorStop(0, '#F4EFFF'); bg.addColorStop(1, '#FFF0F4'); x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = '#6F6787'; x.font = `700 26px ${body}`; x.fillText('SCARABOKKI · PARTITA ' + S.code, P, 92);
  x.fillStyle = '#2E2643'; x.font = `76px ${disp}`; x.fillText('L’album di ' + nameOf(owner), P, 178, inner);
  let y = 230;
  for (const b of blocks) {
    x.fillStyle = colorOf(b.e.by); x.beginPath(); x.arc(P + 16, y + 18, 16, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2E2643'; x.font = `700 28px ${body}`;
    const label = nameOf(b.e.by) + (b.drawing ? ' ha disegnato' : b.e.k === 0 ? ' ha scritto' : ' ha visto');
    x.fillText(label, P + 44, y + 28, inner - 44);
    y += 48;
    if (b.drawing) {
      const dx = (W - DW) / 2;
      x.save(); x.shadowColor = 'rgba(80,60,140,.16)'; x.shadowBlur = 24; x.shadowOffsetY = 6;
      x.fillStyle = '#FFFFFF'; x.fillRect(dx, y, DW, b.strokes.length ? DH : 120); x.restore();
      if (b.strokes.length) paintInto(x, dx, y, DW / UNIT, b.strokes);
      else { x.fillStyle = '#6F6787'; x.font = `italic 30px ${body}`; x.fillText('Foglio bianco', dx + 32, y + 70); }
      y += (b.strokes.length ? DH : 120) + 44;
    } else {
      const bh = b.lines.length * 62 + 44;
      x.save(); x.shadowColor = 'rgba(80,60,140,.14)'; x.shadowBlur = 20; x.shadowOffsetY = 4;
      x.fillStyle = '#FFFFFF'; rr(x, P, y, inner, bh, 26); x.fill(); x.restore();
      x.fillStyle = '#2E2643'; x.font = `52px ${disp}`;
      b.lines.forEach((ln, j) => x.fillText(ln, P + 32, y + 22 + 50 + j * 62, inner - 64));
      y += bh + 44;
    }
  }
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
async function shareAlbum() {
  const c = revealPos().c, who = nameOf(S.meta.order[c]);
  const btn = $('share'); btn.disabled = true; const label = btn.textContent; btn.textContent = '…';
  try {
    const blob = await albumBlob(c);
    if (!blob) throw new Error('blob');
    const name = `scarabokki-${S.code}-${who.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'L’album di ' + who }); }
      catch (e) { if (!e || e.name !== 'AbortError') throw e; }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast('Immagine dell’album scaricata.');
    }
  } catch (e) { console.warn(e); toast('Non sono riuscito a creare l’immagine.'); }
  btn.disabled = false; btn.textContent = label;
}

// ---------------------------------------------------------------------------
// Static wiring
// ---------------------------------------------------------------------------
function setupDrawTools() {
  const sw = $('swatches'), tray = $('tray');
  const renderTools = () => {
    $('pen').setAttribute('aria-pressed', pad.tool === 'pen');
    $('rub').setAttribute('aria-pressed', pad.tool === 'rub');
    $('fill').setAttribute('aria-pressed', pad.tool === 'fill');
    tray.classList.toggle('rubbing', pad.tool === 'rub');
    tray.classList.toggle('filling', pad.tool === 'fill');
    tray.style.setProperty('--cur', pad.color);
    [...sw.children].forEach((b, i) => b.setAttribute('aria-checked', COLORS[i][0] === pad.color));
    [...$('sizes').children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.size === pad.size));
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
  $('sizes').onclick = e => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    pad.size = +b.dataset.size; if (pad.tool === 'fill') pad.tool = 'pen';
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
    if (S.screen === 'draw' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); pad.undo(); }
  });
}
function blockGestures() {
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
function setupStatic() {
  setupDrawTools();
  blockGestures();
  $('homeForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { toast('Il codice è di 4 lettere.'); $('code').focus(); return; }
    if (!needName()) return;
    tryEnter(code, false);
  });
  $('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  $('name').addEventListener('change', () => { const n = getName(); if (n) store.set('name', n); });
  $('create').onclick = createRoom;
  $('resume').onclick = () => tryEnter($('resume').dataset.code, false);
  $('invite').onclick = invite;
  $('start').onclick = startGame;
  $('leave').onclick = leaveRoom;
  $('specLeave').onclick = leaveRoom;
  $('exitReveal').onclick = leaveRoom;
  $('claimBack').onclick = () => { clearHash(); showHome(); };
  $('sendDraw').onclick = () => submit(false);
  $('sendText').onclick = () => submit(false);
  $('edit').onclick = unsubmit;
  $('phrase').addEventListener('input', onText);
  $('phrase').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(false); } });
  $('idea').onclick = () => { $('phrase').value = idea(); onText(); };
  $('next').onclick = revealNext;
  $('again').onclick = newGame;
  $('share').onclick = shareAlbum;
  new ResizeObserver(fitSeen).observe($('writeStage'));
  window.addEventListener('hashchange', () => {
    const c = codeFromHash();
    if (c && c !== S.code) tryEnter(c, true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { keepAwake(); tick(); }
  });
  document.addEventListener('pointerdown', () => { if (S.code && !wake) keepAwake(); }, { passive: true });
}

async function boot() {
  setupViewport();
  setupStatic();
  loading('Mi collego…');
  try { S.uid = await net.init(); }
  catch (e) {
    console.warn(e);
    loading('Non riesco a collegarmi. Controlla la connessione e ricarica la pagina.');
    $('s-loading').querySelector('.spinner').hidden = true;
    return;
  }
  net.onConn(onConnection);
  const code = codeFromHash();
  if (code) await tryEnter(code, true);
  else await showHome();
}
boot();
