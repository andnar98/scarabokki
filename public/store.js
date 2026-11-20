// What this phone remembers between visits (name, last room, drawing backups).
// Every access is wrapped: private windows and full storage must never break the game.
export const store = {
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
