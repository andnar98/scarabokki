// Drawing format: what travels through the database, and the shapes tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, strokesFrom, strokeKey, shapeOf, UNIT, HEIGHT } from '../public/draw.js';

test('un disegno salvato e riletto resta identico', () => {
  const strokes = [
    { c: '#E53935', w: 22, p: [10, 20, 30, 40, 50, 60] },
    { e: 1, w: 64, p: [100, 100, 120, 130] },
    { f: 1, c: '#1E5BD8', p: [500, 600] }
  ];
  const saved = {};
  strokes.forEach((s, i) => { saved[strokeKey(i)] = encode(s); });
  assert.deepEqual(strokesFrom(saved), strokes);
});

test('i tratti restano in ordine anche oltre il decimo', () => {
  const saved = {};
  for (let i = 0; i < 12; i++) saved[strokeKey(i)] = encode({ c: '#1B1C20', w: 8, p: [i, i, i + 5, i + 5] });
  assert.deepEqual(strokesFrom(saved).map(s => s.p[0]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('dati rovinati o malevoli vengono scartati o corretti, senza errori', () => {
  assert.deepEqual(strokesFrom(null), []);
  assert.deepEqual(strokesFrom({ a: null, b: 'ciao', c: { p: '' }, d: { p: '5' } }), []);
  const [s] = strokesFrom({ a: { c: 'javascript:alert(1)', w: 99999, p: '1,2,3,4,x' } });
  assert.equal(s.c, '#1B1C20', 'un colore non valido diventa nero');
  assert.equal(s.w, 200, 'lo spessore ha un massimo');
  assert.deepEqual(s.p, [1, 2, 3, 4], 'i punti non numerici spariscono');
  assert.deepEqual(strokesFrom({ a: { f: 1, c: '#FFFFFF', p: `${UNIT},5` } }), [], 'secchiello fuori dal foglio');
  assert.deepEqual(strokesFrom({ a: { f: 1, c: 'rosso', p: '5,5' } }), [], 'secchiello con colore non valido');
});

test('un tocco senza trascinare non crea una forma', () => {
  for (const k of ['line', 'rect', 'ellipse', 'tri']) assert.equal(shapeOf(k, 100, 100, 103, 104), null);
});

test('una linea quasi orizzontale si raddrizza', () => {
  const sh = shapeOf('line', 0, 0, 1000, 40);
  assert.equal(sh.snapped, true);
  assert.equal(sh.p[1], sh.p[3], 'le due estremità hanno la stessa altezza');
});

test('un rettangolo quasi quadrato diventa un quadrato', () => {
  const sh = shapeOf('rect', 100, 100, 600, 580);
  assert.equal(sh.snapped, true);
  const xs = sh.p.filter((_, i) => i % 2 === 0), ys = sh.p.filter((_, i) => i % 2 === 1);
  assert.equal(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
});

test('un rettangolo molto allungato resta rettangolo', () => {
  assert.equal(shapeOf('rect', 100, 100, 900, 300).snapped, false);
});

test('le forme restano dentro i numeri attesi del foglio', () => {
  const sh = shapeOf('ellipse', 200, 200, 1800, 2400);
  assert.ok(sh.p.every(Number.isInteger));
  assert.ok(sh.p.every((v, i) => v >= 0 && v <= (i % 2 ? HEIGHT : UNIT)));
});
