// Every file the site needs is there and well formed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

test('tutti i file JavaScript del sito sono scritti correttamente', () => {
  for (const f of readdirSync(new URL('public/', root)).filter(f => f.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL('public/' + f, root))]);
  }
});

test('ogni file importato esiste davvero', () => {
  for (const f of readdirSync(new URL('public/', root)).filter(f => f.endsWith('.js'))) {
    for (const [, dep] of read('public/' + f).matchAll(/from '\.\/([\w.-]+)'/g)) {
      assert.ok(existsSync(new URL('public/' + dep, root)), `${f} importa ${dep}, che manca`);
    }
  }
});

test('ogni nome importato da un file del sito è davvero esportato da quel file', () => {
  const exported = f => {
    const src = read('public/' + f), names = new Set();
    for (const [, n] of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/g)) names.add(n);
    for (const [, list] of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of list.split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
    }
    return names;
  };
  for (const f of readdirSync(new URL('public/', root)).filter(f => f.endsWith('.js'))) {
    for (const [, list, dep] of read('public/' + f).matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+)'/g)) {
      const have = exported(dep);
      for (const part of list.split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0];
        if (n) assert.ok(have.has(n), `${f} importa ${n} da ${dep}, ma ${dep} non lo esporta`);
      }
    }
  }
});

test('le pagine e le icone indicate esistono', () => {
  const html = read('public/index.html');
  for (const [, href] of html.matchAll(/(?:href|src)="([\w.-]+\.(?:js|png|svg|webmanifest))"/g)) {
    assert.ok(existsSync(new URL('public/' + href, root)), `index.html usa ${href}, che manca`);
  }
  for (const icon of JSON.parse(read('public/manifest.webmanifest')).icons) {
    assert.ok(existsSync(new URL('public/' + icon.src, root)), `manca l’icona ${icon.src}`);
  }
});

test('le regole del database e la configurazione sono JSON validi', () => {
  for (const f of ['database.rules.json', 'firebase.json', '.firebaserc']) assert.doesNotThrow(() => JSON.parse(read(f)), f);
});
