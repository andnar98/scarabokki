// Database rules, checked against the Firebase emulator (runs on GitHub, see
// .github/workflows/rules-tests.yml). Every test plays one real move of the game
// and checks that the database allows it, or refuses it, as it should.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const CODE = 'ABCD';
const R = p => `rooms/${CODE}` + (p ? '/' + p : '');
const DAY = 86400000;
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scarabokki',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') }
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const as = uid => env.authenticatedContext(uid).database();
const anon = () => env.unauthenticatedContext().database();
const admin = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.database()));
const meta = (over = {}) => ({ host: 'h', status: 'lobby', at: Date.now(), createdAt: Date.now(), round: -1, game: 1, settings: { draw: 90, write: 45 }, ...over });

// A room with the host "h" and the player "p", both online.
async function lobby(over) {
  await admin(db => db.ref(R()).set({
    meta: meta(over),
    players: { h: { name: 'Capo', uid: 'h', joined: 1 }, p: { name: 'Pia', uid: 'p', joined: 2 } },
    members: { h: 'h', p: 'p' },
    presence: { h: { on: true, at: 1 }, p: { on: true, at: 1 } }
  }));
}
const playing = (over = {}) => meta({ status: 'playing', round: 0, rkey: '0', n: 2, order: ['h', 'p'], endsAt: Date.now() + 45000, ...over });

// ---------- the list of rooms ----------
test('elenco stanze: nessuno può leggerlo tutto', async () => {
  await assertFails(as('x').ref('index').once('value'));
  await assertFails(anon().ref('index').once('value'));
});
test('elenco stanze: si possono leggere solo quelle di più di un giorno', async () => {
  const old = String(Date.now() - DAY - 60000), recent = String(Date.now());
  await assertSucceeds(as('x').ref('index').orderByValue().endAt(old).limitToFirst(12).once('value'));
  await assertFails(as('x').ref('index').orderByValue().endAt(recent).limitToFirst(12).once('value'));
  await assertFails(as('x').ref('index').orderByValue().endAt(old).once('value'));   // senza limite
});
test('elenco stanze: la data si salva solo come testo di 13 cifre', async () => {
  await assertSucceeds(as('h').ref('index/ABCD').set(String(Date.now())));
  await assertFails(as('h').ref('index/EFGH').set(Date.now()));
  await assertFails(as('h').ref('index/JKLM').set('domani'));
});

// ---------- creating and joining ----------
test('creare una stanza: solo come capo di sé stessi', async () => {
  await assertSucceeds(as('h').ref(R('meta')).set(meta()));
  await env.clearDatabase();
  await assertFails(as('h').ref(R('meta')).set(meta({ host: 'altro' })));
});
test('entrare nella stanza: solo con il proprio posto', async () => {
  await lobby();
  await assertSucceeds(as('n').ref(R()).update({ 'players/n': { name: 'Nina', uid: 'n', joined: 3 }, 'members/n': 'n' }));
  await assertFails(as('z').ref(R()).update({ 'players/w': { name: 'Finto', uid: 'z', joined: 3 }, 'members/z': 'w' }));
});
test('nessuno entra a partita iniziata', async () => {
  await lobby(playing());
  await assertFails(as('n').ref(R()).update({ 'players/n': { name: 'Nina', uid: 'n', joined: 3 }, 'members/n': 'n' }));
});

// ---------- only the host runs the room ----------
test('i tempi li cambia solo il capo', async () => {
  await lobby();
  await assertSucceeds(as('h').ref(R('meta/settings/draw')).set(120));
  await assertFails(as('p').ref(R('meta/settings/draw')).set(60));
});
test('la partita la fa partire solo il capo', async () => {
  await lobby();
  const start = { 'meta/status': 'playing', 'meta/round': 0, 'meta/rkey': '0', 'meta/n': 2, 'meta/order': ['h', 'p'], 'meta/endsAt': Date.now() + 45000, 'meta/at': Date.now() };
  await assertFails(as('p').ref(R()).update(start));
  await assertSucceeds(as('h').ref(R()).update(start));
});
test('chiunque gioca può passare al turno dopo, ma di un turno solo', async () => {
  await lobby(playing());
  await assertFails(as('p').ref(R('meta')).set(playing({ round: 2, rkey: '2' })));
  await assertSucceeds(as('p').ref(R('meta')).set(playing({ round: 1, rkey: '1', endsAt: Date.now() + 90000 })));
});
test('un giocatore non può cambiare la scadenza senza passare il turno', async () => {
  await lobby(playing());
  await assertFails(as('p').ref(R('meta/endsAt')).set(Date.now() + 999999));
  await assertSucceeds(as('h').ref(R('meta/endsAt')).set(Date.now()));       // il capo chiude il turno
});
test('alla fine dell’ultimo turno chiunque può aprire gli album', async () => {
  await lobby(playing({ round: 1, rkey: '1' }));
  const m = playing({ status: 'reveal', round: 2, reveal: { c: 0, s: 1 } });
  delete m.rkey; delete m.endsAt;
  await assertSucceeds(as('p').ref(R('meta')).set(m));
});
test('gli album li sfoglia solo il capo', async () => {
  const m = playing({ status: 'reveal', round: 2, reveal: { c: 0, s: 1 } });
  delete m.rkey; delete m.endsAt;
  await lobby(m);
  await assertFails(as('p').ref(R('meta')).update({ reveal: { c: 0, s: 2 } }));
  await assertSucceeds(as('h').ref(R('meta')).update({ reveal: { c: 0, s: 2 } }));
});
test('tornare nella stanza lo decide solo il capo', async () => {
  await lobby(playing());
  const back = { 'meta/status': 'lobby', 'meta/round': -1, 'meta/rkey': null, 'meta/order': null, 'meta/n': null, 'meta/endsAt': null, 'meta/game': 2 };
  await assertFails(as('p').ref(R()).update(back));
  await assertSucceeds(as('h').ref(R()).update(back));
});

// ---------- host hand-over ----------
test('si diventa capo solo se il capo è scollegato', async () => {
  await lobby();
  await assertFails(as('p').ref(R('meta/host')).set('p'));
  await admin(db => db.ref(R('presence/h')).set({ on: false, at: 1 }));
  await assertSucceeds(as('p').ref(R('meta/host')).set('p'));
});
test('non si può nominare capo un altro', async () => {
  await lobby();
  await admin(db => db.ref(R('presence/h')).set({ on: false, at: 1 }));
  await assertFails(as('p').ref(R('meta/host')).set('n'));
});

// ---------- drawings and sentences ----------
test('ognuno scrive solo nel proprio foglio, nel turno in corso', async () => {
  await lobby(playing({ round: 1, rkey: '1' }));
  const stroke = { c: '#E53935', w: 22, p: '1,2,3,4' };
  await assertSucceeds(as('p').ref(R('work/1/p/s/s0000')).set(stroke));
  await assertFails(as('p').ref(R('work/1/h/s/s0000')).set(stroke));      // il foglio di un altro
  await assertFails(as('p').ref(R('work/0/p/t')).set('troppo tardi'));     // un turno passato
  await assertSucceeds(as('p').ref(R('done/1/p')).set(true));
  await assertFails(as('p').ref(R('done/1/h')).set(true));
});
test('chi non è nella stanza non può modificarla', async () => {
  await lobby();
  await assertFails(as('x').ref(R('meta/status')).set('playing'));
  await assertFails(as('x').ref(R('meta/host')).set('x'));
  await assertFails(anon().ref(R('players/x')).set({ name: 'X', uid: 'x' }));
});
