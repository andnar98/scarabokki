// Game rules: albums, rounds and the reveal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, albumOf, authorOf, roundMs, roundOver, nextReveal, prevReveal } from '../public/game.js';

const players = n => Array.from({ length: n }, (_, i) => 'p' + i);

test('i turni alternano frase, disegno e descrizione', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(kindOf), ['first', 'draw', 'describe', 'draw', 'describe', 'draw']);
});

test('in ogni turno ogni giocatore lavora su un album diverso', () => {
  for (const n of [2, 3, 5, 8, 20]) {
    const order = players(n);
    for (let r = 0; r < n; r++) {
      const albums = order.map(s => albumOf(order, s, r));
      assert.equal(new Set(albums).size, n, `${n} giocatori, turno ${r}`);
    }
  }
});

test('ogni album passa da tutti i giocatori, una volta sola', () => {
  for (const n of [2, 3, 5, 8, 20]) {
    const order = players(n);
    for (let c = 0; c < n; c++) {
      const authors = Array.from({ length: n }, (_, k) => authorOf(order, c, k));
      assert.equal(new Set(authors).size, n, `${n} giocatori, album ${c}`);
      assert.equal(authors[0], order[c], 'il primo passaggio è di chi dà il nome all’album');
    }
  }
});

test('chi lavora su un album nel turno r ne è l’autore del passaggio r', () => {
  const order = players(6);
  for (let r = 0; r < 6; r++) {
    for (const s of order) assert.equal(authorOf(order, albumOf(order, s, r), r), s);
  }
});

test('nessuno riceve due volte di fila dallo stesso giocatore', () => {
  const order = players(5);
  for (let c = 0; c < 5; c++) {
    for (let k = 1; k < 5; k++) assert.notEqual(authorOf(order, c, k), authorOf(order, c, k - 1));
  }
});

test('ogni turno dura il tempo giusto: disegno o scrittura', () => {
  const set = { draw: 90, write: 45 };
  assert.deepEqual([0, 1, 2, 3].map(r => roundMs(set, r)), [45000, 90000, 45000, 90000]);
});

const base = { order: ['a', 'b', 'c'], now: 1000, endsAt: 5000, grace: 3000, presenceLoaded: true, gone: () => false };

test('il turno finisce quando tutti hanno consegnato', () => {
  assert.equal(roundOver({ ...base, done: { a: true, b: true, c: true } }), true);
  assert.equal(roundOver({ ...base, done: { a: true, b: true, c: false } }), false);
  assert.equal(roundOver({ ...base, done: {} }), false);
});

test('il turno finisce quando il tempo è scaduto, dopo la tolleranza', () => {
  assert.equal(roundOver({ ...base, done: {}, now: 5000 + 3000 }), false);
  assert.equal(roundOver({ ...base, done: {}, now: 5000 + 3001 }), true);
});

test('chi se n’è andato non blocca il turno, ma serve almeno una consegna', () => {
  const gone = s => s === 'c';
  assert.equal(roundOver({ ...base, gone, done: { a: true, b: true } }), true);
  assert.equal(roundOver({ ...base, gone: () => true, done: {} }), false);
  assert.equal(roundOver({ ...base, gone, done: { a: true } }), false);
  // finché non si sa chi è collegato, non si dà nessuno per perso
  assert.equal(roundOver({ ...base, gone, presenceLoaded: false, done: { a: true, b: true } }), false);
});

test('“Avanti” mostra ogni passaggio di ogni album e poi finisce', () => {
  const N = 3, seen = [];
  let rv = { c: 0, s: 1 };
  seen.push(rv);
  while (!rv.fin) { rv = nextReveal(rv, N); seen.push(rv); }
  assert.equal(seen.length, N * N + 1);
  assert.deepEqual(seen.at(-1), { c: N - 1, s: N, fin: true });
});

test('“Indietro” annulla “Avanti” e si ferma all’inizio', () => {
  const N = 4;
  let rv = { c: 0, s: 1 };
  for (let i = 0; i < N * N - 1; i++) {
    const next = nextReveal(rv, N);
    assert.deepEqual(prevReveal(next, N), rv);
    rv = next;
  }
  assert.equal(prevReveal({ c: 0, s: 1 }, N), null);
});
