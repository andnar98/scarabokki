// Small sounds, made on the phone itself (no audio files): a chime when a round starts, a tick
// in the last seconds, a pop for every step of the albums, a little fanfare at the end of each.
// They can be switched off; the choice is remembered on this phone.
import { store } from './store.js';

let ctx = null;
export const soundOn = () => store.get('sound', true) !== false;
export function setSound(on) { store.set('sound', !!on); if (on) wake(); }

// Browsers allow audio only after a tap: the first tap anywhere prepares it.
function wake() {
  try {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { ctx = null; }
}
document.addEventListener('pointerdown', () => { if (soundOn()) wake(); }, { passive: true });

// One soft note: frequency (Hz), start delay and length (s), loudness (0..1), wave shape.
function note(f, at, len, vol = 0.12, type = 'sine') {
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + len + 0.05);
}
const SOUNDS = {
  round() { note(660, 0, 0.18); note(990, 0.1, 0.28); },
  tick() { note(1200, 0, 0.06, 0.07, 'triangle'); },
  step() { note(520, 0, 0.09, 0.08, 'triangle'); note(780, 0.04, 0.1, 0.06, 'triangle'); },
  finale() { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.32, 0.1)); },
  done() { note(784, 0, 0.12, 0.08); note(1175, 0.07, 0.2, 0.08); }
};
export function sound(kind) {
  if (!soundOn() || !SOUNDS[kind]) return;
  wake();
  if (!ctx || ctx.state !== 'running') return;
  try { SOUNDS[kind](); } catch (e) {}
}
