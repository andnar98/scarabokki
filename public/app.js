import * as net from './net.js';
import { Pad, COLORS, RATIO, render, replay, sizeCanvas, release, strokesFrom, encode, strokeKey } from './draw.js';
import { $, screen, showScreen, toast, ask, menu, popover, dismissTop, haptic, syncRows } from './ui.js';
import { albumBlob } from './album.js';
import { kindOf, albumOf, authorOf, roundMs, roundOver, nextReveal, prevReveal } from './game.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const T = globalThis.__SCARA_TEST || {};
const CFG = {
  maxPlayers: 20, minPlayers: 2, nameMax: 16, textMax: 80,
  grace: 3000,                     // after the deadline, wait this long for last saves before moving on
  intro: 1200,                     // every round starts with a short title card; the clock allows for it
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
const S = {
  uid: null, code: null, seat: null, attachedAt: 0,
  meta: null, players: {}, presence: {}, presenceLoaded: false, done: {},
  subs: [], doneSub: null, doneKey: null, tick: 0,
  roundKey: null, roundToken: 0, task: null, submitted: false, autoSent: null,
  advancing: null, hosting: false, connected: true,
  rv: { key: null, chain: -1, shown: 0, browse: null, cache: {}, stops: [] },
  claimSubs: []
};
const room = p => 'rooms/' + S.code + (p ? '/' + p : '');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('scarabokki.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('scarabokki.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('scarabokki.' + k); } catch (e) {} },
  // Removes every drawing/text backup except `keep`, so old games never pile up in the browser.
  prune(keep) {
    try {
      const old = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('scarabokki.work.') && k !== 'scarabokki.' + keep) old.push(k);
      }
      old.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
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
const settingsOf = m => Object.assign({}, CFG.defaults, (m && m.settings) || {});
const settings = () => settingsOf(S.meta);
// A name as typed: no spaces at the ends, single spaces inside, not too long.
const cleanName = s => s.trim().replace(/\s+/g, ' ').slice(0, CFG.nameMax);
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

function show(name) {
  if (!showScreen(name)) return;
  if (name === 'draw') pad.fit();
}
function loading(text) {
  $('intro').hidden = true; $('spinner').hidden = false; $('loadingText').hidden = false;
  $('loadingText').textContent = text; show('loading');
}
const ICONS = {
  write: '<svg viewBox="0 0 48 48"><path d="M8 40l3-11L31 9a4 4 0 0 1 6 0l2 2a4 4 0 0 1 0 6L19 37z"/><path d="M27 13l8 8"/></svg>',
  draw: '<svg viewBox="0 0 48 48"><path d="M40 6c-9 4-17 12-22 22l6 6c10-5 18-13 22-22z"/><path d="M18 28c-6 0-9 4-9 8 0 3-2 5-4 6 6 2 16 1 19-8"/></svg>',
  describe: '<svg viewBox="0 0 48 48"><path d="M4 24s7-13 20-13 20 13 20 13-7 13-20 13S4 24 4 24z"/><circle cx="24" cy="24" r="6"/></svg>'
};
// Title card between rounds: says what is coming while the round loads.
function intro(r, n) {
  const kind = r === 0 ? 'write' : kindOf(r);
  $('spinner').hidden = true; $('loadingText').hidden = true;
  $('introIcon').innerHTML = ICONS[kind];
  $('introEyebrow').textContent = `Turno ${r + 1} di ${n}`;
  $('introTitle').textContent = kind === 'write' ? 'Scrivi una frase' : kind === 'draw' ? 'Disegna' : 'Indovina il disegno';
  $('intro').hidden = false; show('loading');
}
const wait = ms => new Promise(res => setTimeout(res, ms));
const verbOf = k => (k % 2 ? ' ha disegnato' : k === 0 ? ' ha scritto' : ' ha visto');
const textOf = e => (e.v && typeof e.v.t === 'string' ? e.v.t.trim() : '');

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
  else offT = setTimeout(() => { if (!S.connected && screen() !== 'home') $('offline').hidden = false; }, 1500);
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
function setHash(code) { if (location.hash !== '#' + code) history.replaceState(history.state, '', '#' + code); }
function clearHash() { history.replaceState(null, '', location.pathname + location.search); }
// While in a room an extra history entry catches the system back gesture (Android back,
// iPhone swipe in Safari): it opens the game menu instead of closing the game.
function guardHistory() {
  try { if (!(history.state && history.state.scara === S.code)) history.pushState({ scara: S.code }, '', '#' + S.code); } catch (e) {}
}
function onBack() {
  if (dismissTop()) return;
  if (screen() === 'claim') { detach(); clearHash(); showHome(); return; }
  const m = S.meta;
  if (!S.seat || !m) return;
  if (m.status === 'lobby') leaveRoom(); else openGameMenu();
}
function getName() { return cleanName($('name').value); }

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
      if (meta && seat && screen() === 'home') {
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
      quiet(net.put(`index/${code}`, String(now)));   // as text: the database rules can only compare it that way
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
    // Only rooms older than a day can be listed (database rules): active rooms stay hidden.
    const idx = (await net.oldest('index', String(net.now() - 86400000 - 60000), 12)) || {};
    const old = Object.keys(idx);
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
  const known = (store.get('name', '') || '').trim();
  $('claimName').hidden = !!known; $('claimName').value = '';
  $('claimWait').textContent = known
    ? 'Altrimenti resta qui: entrerai da solo nella prossima partita.'
    : 'Altrimenti scrivi il tuo nome e resta qui: entrerai da solo nella prossima partita.';
  show('claim');
  let meta = null;
  const draw = () => {
    const order = (meta && meta.order) || [];
    const free = order.filter(s => S.players[s] && !isOnline(s));
    const rows = free.map(s => ({
      key: s, sig: nameOf(s),
      build() {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'row-action'; b.textContent = 'Sono io';
        b.onclick = () => claim(code, s);
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(s);
        li.append(avatar(s), nm, b);
        return li;
      }
    }));
    if (!rows.length) rows.push({
      key: '_none', sig: '',
      build() { const li = document.createElement('li'); const nm = document.createElement('span'); nm.className = 'nm quiet'; nm.textContent = 'Tutti i giocatori sono collegati.'; li.append(nm); return li; }
    });
    syncRows($('claimList'), rows);
  };
  S.claimSubs.push(net.on(`rooms/${code}/players`, v => { S.players = v || {}; draw(); }));
  S.claimSubs.push(net.on(`rooms/${code}/presence`, v => { S.presence = v || {}; draw(); }));
  S.claimSubs.push(net.on(`rooms/${code}/meta`, v => {
    meta = v;
    if (!v) { stopClaim(); showHome(); toast('La partita è finita.'); return; }
    if (v.status === 'lobby') {
      const typed = cleanName($('claimName').value);
      if (typed) store.set('name', typed);
      const name = typed || (store.get('name', '') || '').trim();
      stopClaim();
      if (name) joinLobby(code, name);
      else { showHome(code); toast('La stanza è di nuovo aperta: scrivi il tuo nome e tocca Entra.', 4500); }
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
  setHash(code); guardHistory(); store.set('last', code);
  S.subs.push(net.on(room('meta'), onMeta));
  S.subs.push(net.on(room('players'), onPlayers));
  S.subs.push(net.on(room('presence'), v => { S.presence = v || {}; S.presenceLoaded = true; refreshLists(); }));
  if (S.connected) markPresent();
  S.tick = setInterval(tick, 250);
  keepAwake();
}
async function leaveRoom() {
  const m = S.meta, seat = S.seat;
  const ok = await ask(m && m.status !== 'lobby' ? 'Uscire dalla partita?' : 'Uscire dalla stanza?',
    m && m.status !== 'lobby' ? 'La partita continuerà senza di te. Con lo stesso link puoi rientrare quando vuoi.' : 'Potrai rientrare con lo stesso codice.',
    'Esci', { danger: true });
  if (!ok) return;
  const up = {}, inGame = m && m.status !== 'lobby';
  if (inGame) up[`presence/${seat}`] = { on: false, at: 0 };     // counts as gone right away: nobody waits
  else { up[`players/${seat}`] = null; up[`members/${S.uid}`] = null; up[`presence/${seat}`] = null; }
  if (isHost()) {
    const pool = (inGame ? m.order || [] : []).concat(lobbyIds()).filter(id => id !== seat && S.players[id]);
    const next = pool.find(isOnline) || pool[0];
    if (next) up['meta/host'] = next;
  }
  const code = S.code;
  quiet(net.cancelDrop(room('presence/' + seat)));
  try { await net.patch(`rooms/${code}`, up); } catch (e) {}
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
  if (screen() === 'lobby') renderLobby();
  if (screen() === 'wait') renderWait();
  if (screen() === 'reveal') renderRevealChrome();
}

function onMeta(m) {
  if (!m) { leaveToHome('Questa partita non esiste più.'); return; }
  const prev = S.meta; S.meta = m;
  if (m.status === 'lobby') {
    if (S.doneSub) { S.doneSub(); S.doneSub = null; S.doneKey = null; }
    S.roundKey = null; S.task = null; clearFeed(); S.rv.key = null; S.rv.browse = null;
    store.prune(null);
    pad.releaseAll(); pad.locked = true;
    renderLobby(); show('lobby');
    if (prev && prev.status !== 'lobby' && m.host !== S.seat) {
      toast(prev.status === 'playing'
        ? nameOf(m.host) + ' ha interrotto la partita: siete tornati nella stanza.'
        : 'Nuova partita! Aspettate che ' + nameOf(m.host) + ' la faccia iniziare.', 4500);
    }
    return;
  }
  if (m.status === 'playing') {
    if (!(m.order || []).includes(S.seat)) { show('spectate'); return; }
    if (S.doneKey !== m.rkey) {
      if (S.doneSub) S.doneSub();
      S.done = {}; S.doneKey = m.rkey;
      S.doneSub = net.on(room('done/' + m.rkey), v => { S.done = v || {}; onDone(); });
    }
    if (S.roundKey !== m.rkey) startRound(m.round, !!prev);
    return;
  }
  if (m.status === 'reveal') {
    if (S.doneSub) { S.doneSub(); S.doneSub = null; S.doneKey = null; }
    S.roundKey = null; S.task = null;
    store.prune(null);      // the game is over: its backups are no longer needed
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
  const host = isHost(), set = settings();
  syncRows($('lobbyPlayers'), ids.map(id => ({
    key: id, sig: [nameOf(id), id === S.seat, id === m.host, isOnline(id), host].join('|'),
    build() {
      const li = document.createElement('li');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(id);
      if (id === S.seat) { const sm = document.createElement('small'); sm.textContent = ' (tu)'; nm.append(sm); }
      li.append(avatar(id), nm);
      if (id === m.host) li.append(tag('Capo', 'host'));
      if (!isOnline(id)) li.append(tag('non collegato', 'off'));
      if (host && id !== S.seat) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'row-action'; b.textContent = 'Togli';
        b.setAttribute('aria-label', 'Togli ' + nameOf(id));
        b.onclick = () => kick(id); li.append(b);
      }
      return li;
    }
  })));
  for (const [el, cur] of [[$('drawTimes'), set.draw], [$('writeTimes'), set.write]]) {
    for (const b of el.children) { b.setAttribute('aria-pressed', +b.dataset.v === cur); b.disabled = !host; }
  }
  $('settingsWho').textContent = host ? '' : 'li sceglie ' + nameOf(m.host);
  const online = ids.filter(id => id === S.seat || isOnline(id)).length;
  $('start').hidden = !host;
  $('start').disabled = online < CFG.minPlayers;
  const away = ids.filter(id => id !== S.seat && !isOnline(id)).map(nameOf);
  const awayNote = !away.length ? '' : away.length === 1 ? ` ${away[0]} è offline e resterà fuori.` : ` ${away.slice(0, -1).join(', ')} e ${away[away.length - 1]} sono offline e resteranno fuori.`;
  $('lobbyHint').textContent = host
    ? (online < CFG.minPlayers ? 'Invita almeno un amico: mandagli il link con “Invita”.' : `Si giocano ${online} turni, uno per giocatore.` + awayNote)
    : `Aspetta che ${nameOf(m.host)} inizi la partita.`;
}
async function kick(id) {
  const ok = await ask('Togliere ' + nameOf(id) + '?', 'Potrà rientrare con il codice della stanza.', 'Togli', { danger: true });
  if (!ok) return;
  const p = S.players[id];
  quiet(net.patch(room(), { [`players/${id}`]: null, [`presence/${id}`]: null, ...(p ? { [`members/${p.uid}`]: null } : {}) }));
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
      'meta/endsAt': now + roundMs(set, 0) + CFG.intro, 'meta/at': now, 'meta/reveal': null,
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
  const order = S.meta.order;
  const want = r % 2 ? 'text' : 'drawing';
  for (let k = r - 1; k >= 0; k -= 2) {
    const by = authorOf(order, c, k);
    const v = await net.get(room(`work/${k}/${by}`));
    if (!isEmpty(v, want)) return { by, v, k };
  }
  return null;
}

async function startRound(r, live) {
  const token = ++S.roundToken;
  const m = S.meta, order = m.order, N = order.length;
  const c = albumOf(order, S.seat, r);
  let kind = kindOf(r);
  S.roundKey = m.rkey; S.submitted = false; S.autoSent = null;
  const set = settings(), span = roundMs(set, r);
  S.task = { r, c, kind, token, ready: false, text: '', note: '', span, warned: false };
  pad.locked = true;
  intro(r, N);
  const shown = live ? wait(900) : null;      // seen live, the card stays long enough to be read
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
  await shown;
  if (token !== S.roundToken || !S.task) return;
  const t = S.task;
  const local = store.get(localKey(r));
  // drop every other backup: earlier rounds, earlier games, other rooms
  store.prune(localKey(r));

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
    $('drawEyebrow').textContent = `Turno ${r + 1} di ${N}`;
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
  haptic('medium');
  if (S.done[S.seat] === true) { S.submitted = true; showWait(); }
  else showTask();
  if (t.note) toast(t.note);
}

function showTask() {
  const t = S.task; if (!t || !t.ready) return;
  if (t.kind === 'draw') {
    pad.locked = false; show('draw');
    if (!t.note && !store.get('viewHint')) { store.set('viewHint', 1); toast('Con due dita puoi ingrandire, ruotare e spostare il foglio.', 4500); }
  }
  else {
    show('write');
    const seen = $('seen');
    seen.hidden = t.kind !== 'describe'; $('writeNote').hidden = t.kind === 'describe';
    if (t.kind === 'describe') fitSeen();
  }
  tick();
}
function fitSeen() {
  const t = S.task; if (!t || t.kind !== 'describe' || screen() !== 'write') return;
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
  },
  onView({ z, deg, home }) {
    $('zoomReset').hidden = home;
    $('zoomLevel').textContent = Math.round(z * 100) + '%' + (deg ? ` · ${deg}°` : '');
  },
  onSnap() { haptic('light'); }
});
if (T.expose) globalThis.__pad = pad;
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
    pad.releaseAll(); pad.finish();
    if (!auto && !pad.strokes.length) { toast('Disegna qualcosa prima di consegnare.'); return; }
    pad.locked = true;
  } else {
    if (!auto && !t.text.trim()) { toast('Scrivi qualcosa prima di consegnare.'); $('phrase').focus(); return; }
    flushText();
    $('phrase').blur();
  }
  S.submitted = true;
  if (!auto) haptic('success');
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
  $('endRound').hidden = !isHost() || done >= order.length;
  const doing = r % 2 ? 'sta disegnando' : 'sta scrivendo';
  syncRows($('waitPlayers'), order.map(s => {
    const state = S.done[s] === true ? 'ok' : !isOnline(s) ? 'off' : 'busy';
    return {
      key: s, sig: [nameOf(s), state, doing, isOnline(s)].join('|'),
      build() {
        const li = document.createElement('li');
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(s);
        if (s === S.seat) { const sm = document.createElement('small'); sm.textContent = ' (tu)'; nm.append(sm); }
        li.append(avatar(s), nm, state === 'ok' ? tag('ha finito', 'ok') : state === 'off' ? tag('non collegato', 'off') : tag(doing));
        return li;
      }
    };
  }));
}

function onDone() {
  const t = S.task;
  if (t && t.ready) {
    const mine = S.done[S.seat] === true;
    if (mine && (screen() === 'draw' || screen() === 'write')) { pad.cancelStroke(); flushText(); S.submitted = true; showWait(); }
    else if (!mine && screen() === 'wait' && !S.submitted) showTask();
  }
  if (screen() === 'wait') renderWait();
  maybeAdvance(net.now());
}

// --- timers, advancing and host hand-over (every client runs these; transactions keep one winner) ---
function tick() {
  const m = S.meta; if (!m) return;
  const now = net.now();
  if (m.status === 'playing' && S.task && S.task.ready && S.roundKey === m.rkey) {
    const left = m.endsAt - now, t = S.task;
    const label = fmt(Math.min(left, t.span)), urgent = left > 0 && left <= 10000;
    const share = Math.max(0, Math.min(1, left / t.span)).toFixed(3);
    for (const el of document.querySelectorAll('.timer')) {
      if (el.textContent !== label) el.textContent = label;
      el.style.setProperty('--left', share);
      el.classList.toggle('urgent', urgent);
    }
    if (urgent && !t.warned && S.done[S.seat] !== true) { t.warned = true; haptic('warning'); }
    $('edit').disabled = left < 1500;
    if (left <= 0 && S.autoSent !== m.rkey && S.done[S.seat] !== true) { S.autoSent = m.rkey; submit(true); }
    maybeAdvance(now);
  }
  maybeTakeHost(now);
}
function maybeAdvance(now) {
  const m = S.meta;
  if (!m || m.status !== 'playing' || !S.task || !(m.order || []).includes(S.seat)) return;
  if (roundOver({ order: m.order, done: S.done, now, endsAt: m.endsAt, grace: CFG.grace,
    presenceLoaded: S.presenceLoaded, gone: s => isGone(s, now) })) advance(m.round);
}
async function advance(r) {
  if (S.advancing === r) return;
  S.advancing = r;
  try {
    await net.txn(room('meta'), m => {
      if (m === null) return m;
      if (m.status !== 'playing' || m.round !== r) return;
      const now = net.now(), next = r + 1, set = settingsOf(m);
      m.at = now;
      if (next >= m.n) { m.status = 'reveal'; m.round = next; m.rkey = null; m.endsAt = null; m.reveal = { c: 0, s: 1 }; }
      else { m.round = next; m.rkey = String(next); m.endsAt = now + roundMs(set, next) + CFG.intro; }
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
function clearFeed() {
  stopReveal();
  const feed = $('feed');
  for (const cv of feed.querySelectorAll('canvas')) release(cv);
  feed.textContent = '';
}
function chainEntries(c) {
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
function revealPos() {
  const m = S.meta, N = m.n, rv = m.reveal || { c: 0, s: 1 };
  if (rv.fin) return { c: S.rv.browse !== null && S.rv.browse < N ? S.rv.browse : Math.min(rv.c, N - 1), s: N, fin: true };
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
  if (fresh) { clearFeed(); S.rv.key = viewKey; S.rv.shown = 0; }
  const from = S.rv.shown, to = pos.s;
  if (to < from) { clearFeed(); S.rv.shown = 0; return onReveal(); }
  for (let k = from; k < to; k++) feed.append(entryEl(entries[k], k === to - 1 && !pos.fin && !fresh));
  if (to > from && !fresh && !isHost()) haptic('light');
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
  who.append(avatar(e.by, true), b, document.createTextNode(verbOf(e.k)));
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
    const on = albums.querySelector('[aria-pressed="true"]');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('stepRow').hidden = !host || pos.fin;
  $('prev').disabled = pos.c === 0 && pos.s <= 1;
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
  const nv = nextReveal(m.reveal || { c: 0, s: 1 }, m.n);
  quiet(net.patch(room('meta'), { reveal: nv, at: net.now() }));
}
function revealPrev() {
  const m = S.meta; if (!m || !isHost()) return;
  const nv = prevReveal(m.reveal || { c: 0, s: 1 }, m.n);
  if (!nv) return;
  quiet(net.patch(room('meta'), { reveal: nv, at: net.now() }));
}
async function newGame() {
  const ok = await ask('Nuova partita?', 'Gli album di questa partita verranno cancellati. Salvate prima quelli che volete tenere.', 'Nuova partita');
  if (ok) resetToLobby();
}
// Everyone goes back to the player list; the drawings of this game are deleted.
function resetToLobby() {
  const m = S.meta; if (!m || !isHost()) return;
  quiet(net.patch(room(), {
    'meta/status': 'lobby', 'meta/round': -1, 'meta/rkey': null, 'meta/order': null, 'meta/n': null,
    'meta/endsAt': null, 'meta/reveal': null, 'meta/at': net.now(), 'meta/game': (m.game || 0) + 1,
    done: null, work: null
  }));
}

// Ends the round now for everyone: whoever has not finished hands in what they have.
function endRoundNow() {
  const m = S.meta; if (!m || !isHost() || m.status !== 'playing') return;
  const r = m.round;
  net.txn(room('meta'), x => {
    if (x === null) return x;
    if (x.status !== 'playing' || x.round !== r) return;
    x.endsAt = Math.min(x.endsAt || 0, net.now()); x.at = net.now();
    return x;
  }).then(ok => { if (ok) toast('Turno chiuso: si passa al prossimo.'); }).catch(noop);
}
async function openGameMenu() {
  const m = S.meta; if (!m || !S.seat || m.status === 'lobby') return;
  const host = isHost(), playing = m.status === 'playing' && (m.order || []).includes(S.seat);
  const actions = [];
  if (host && playing) actions.push({ value: 'end', label: 'Chiudi il turno adesso', detail: 'Chi non ha finito consegna quello che ha fatto finora.' });
  if (host) actions.push({ value: 'lobby', label: 'Torna alla stanza', detail: 'La partita si interrompe: potete aggiungere qualcuno e ricominciare.' });
  actions.push({ value: 'leave', label: 'Esci dalla partita', danger: true });
  const pick = await menu({
    title: 'Partita ' + S.code,
    text: host ? 'Sei il capo della stanza.' : `Solo ${nameOf(m.host)}, capo della stanza, può chiudere il turno o interrompere la partita.`,
    actions
  });
  if (pick === 'end') endRoundNow();
  else if (pick === 'lobby') {
    const ok = await ask('Tornare alla stanza?', 'La partita si interrompe per tutti e i disegni fatti finora vanno persi.', 'Torna alla stanza', { danger: true });
    if (ok) resetToLobby();
  } else if (pick === 'leave') leaveRoom();
}

async function shareAlbum() {
  const c = revealPos().c, who = nameOf(S.meta.order[c]);
  const btn = $('share'); if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('busy');
  try {
    const blob = await albumBlob({
      code: S.code, title: 'L’album di ' + who,
      entries: (await chainEntries(c)).map(e => ({
        label: nameOf(e.by) + verbOf(e.k), color: colorOf(e.by), drawing: e.k % 2 === 1,
        text: textOf(e), strokes: e.k % 2 === 1 ? strokesFrom(e.v && e.v.s) : []
      }))
    });
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
  btn.disabled = false; btn.classList.remove('busy');
}

// ---------------------------------------------------------------------------
// Static wiring
// ---------------------------------------------------------------------------
const SHAPE_ICONS = {
  any: '<path d="M3.5 10.5h9v9h-9z"/><circle cx="15.5" cy="8.5" r="5"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>',
  ellipse: '<circle cx="12" cy="12" r="7.5"/>',
  tri: '<path d="M12 4.5l8 14H4z"/>'
};
const SHAPE_ITEMS = [
  { value: 'line', label: 'Linea' }, { value: 'rect', label: 'Rettangolo' },
  { value: 'ellipse', label: 'Cerchio' }, { value: 'tri', label: 'Triangolo' }
].map(it => Object.assign(it, { icon: `<svg viewBox="0 0 24 24" aria-hidden="true">${SHAPE_ICONS[it.value]}</svg>` }));
const SIZE_NAMES = ['Sottile', 'Medio', 'Grosso'];
function setupDrawTools() {
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
function setupTimes(el, list, key) {
  for (const v of list) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v;
    b.textContent = v < 60 ? v + ' s' : (v % 60 ? (v / 60).toFixed(1).replace('.', ',') : v / 60) + ' min';
    b.onclick = () => {
      if (!isHost()) return;
      quiet(net.put(room('meta/settings/' + key), v));
      store.set('settings', Object.assign({}, settings(), { [key]: v }));
    };
    el.append(b);
  }
}
async function copyCode() {
  try { await navigator.clipboard.writeText(S.code); toast('Codice copiato.'); } catch (e) {}
}
function setupStatic() {
  setupDrawTools();
  blockGestures();
  setupTimes($('drawTimes'), CFG.drawTimes, 'draw');
  setupTimes($('writeTimes'), CFG.writeTimes, 'write');
  $('lobbyCode').onclick = copyCode;
  // every button answers the finger with a light tap
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled) haptic('light');
  }, { passive: true });
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
  $('prev').onclick = revealPrev;
  $('endRound').onclick = endRoundNow;
  for (const b of document.querySelectorAll('.crumb')) b.onclick = openGameMenu;
  window.addEventListener('popstate', () => {
    S.popAt = performance.now();
    if (S.code) { guardHistory(); onBack(); return; }
    dismissTop();
    if (codeFromHash()) clearHash();      // an old room link in the history must not re-enter it
  });
  $('again').onclick = newGame;
  $('share').onclick = shareAlbum;
  new ResizeObserver(fitSeen).observe($('writeStage'));
  window.addEventListener('hashchange', () => {
    if (performance.now() - (S.popAt || 0) < 800) return;
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
