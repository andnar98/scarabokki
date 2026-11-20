// The room this phone is in, shared by every part of the game, and small helpers that read it.
import { CFG, AV } from './config.js';

export const S = {
  uid: null, code: null, seat: null, attachedAt: 0,
  meta: null, players: {}, presence: {}, presenceLoaded: false, done: {},
  subs: [], doneSub: null, doneKey: null, tick: 0,
  roundKey: null, roundToken: 0, task: null, submitted: false, autoSent: null,
  advancing: null, hosting: false, connected: true,
  rv: { key: null, chain: -1, shown: 0, browse: null, cache: {}, stops: [] },
  claimSubs: []
};
export const room = p => 'rooms/' + S.code + (p ? '/' + p : '');
export const noop = () => {};
export const quiet = p => (p && p.catch ? p.catch(err => console.warn('[scarabokki]', err && (err.code || err.message))) : p);
export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const nameOf = seat => (S.players[seat] && S.players[seat].name) || 'Qualcuno';
export const colorOf = seat => AV[hash(String(seat)) % AV.length];
export const isOnline = seat => !!(S.presence[seat] && S.presence[seat].on);
export function isGone(seat, now) {
  const p = S.presence[seat];
  return !p || (!p.on && now - (p.at || 0) > CFG.gone);
}
export const isHost = () => !!S.meta && S.meta.host === S.seat;
export const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const lobbyIds = () => Object.keys(S.players).sort((a, b) => (S.players[a].joined || 0) - (S.players[b].joined || 0) || (a < b ? -1 : 1));
export const settingsOf = m => Object.assign({}, CFG.defaults, (m && m.settings) || {});
export const settings = () => settingsOf(S.meta);
// A name as typed: no spaces at the ends, single spaces inside, not too long.
export const cleanName = s => s.trim().replace(/\s+/g, ' ').slice(0, CFG.nameMax);
export const gameKey = () => (S.meta && S.meta.game) || 0;

export function avatar(seat, small) {
  const el = document.createElement('span');
  el.className = 'av' + (small ? ' sm' : '');
  el.style.setProperty('--av', colorOf(seat));
  el.textContent = (nameOf(seat).trim()[0] || '?').toUpperCase();
  el.setAttribute('aria-hidden', 'true');
  if (!isOnline(seat)) el.dataset.off = '';
  return el;
}
export function tag(text, cls) { const t = document.createElement('span'); t.className = 'tagp' + (cls ? ' ' + cls : ''); t.textContent = text; return t; }
export const textOf = e => (e.v && typeof e.v.t === 'string' ? e.v.t.trim() : '');
