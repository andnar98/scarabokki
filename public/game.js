// Pure game rules: who works on which album, when a round is over, how the reveal moves.
// No screen and no network here, so the tests can check them directly.

// What happens in round r: a first sentence, then drawing and describing in turn.
export const kindOf = r => (r === 0 ? 'first' : r % 2 ? 'draw' : 'describe');

// The album a player works on in round r (albums are numbered like the seats in `order`).
export const albumOf = (order, seat, r) => (order.indexOf(seat) + r) % order.length;

// Who made step k of album c.
export function authorOf(order, c, k) {
  const N = order.length;
  return order[((c - k) % N + N) % N];
}

// The round is over when everyone handed in, when time (plus a grace period) ran out,
// or when at least one player handed in and everyone else has gone away.
export function roundOver({ order, done, now, endsAt, grace, presenceLoaded, gone }) {
  const finished = s => done[s] === true;
  if (order.every(finished)) return true;
  if (now > endsAt + grace) return true;
  return order.some(finished) && presenceLoaded && order.every(s => finished(s) || gone(s));
}

// Reveal position: album c, showing its first s steps; fin once every album has been shown.
export function nextReveal(rv, N) {
  if (rv.s < N) return { c: rv.c, s: rv.s + 1 };
  if (rv.c < N - 1) return { c: rv.c + 1, s: 1 };
  return { c: rv.c, s: N, fin: true };
}
export function prevReveal(rv, N) {
  if (rv.s > 1) return { c: rv.c, s: rv.s - 1 };
  if (rv.c > 0) return { c: rv.c - 1, s: N };
  return null;
}
