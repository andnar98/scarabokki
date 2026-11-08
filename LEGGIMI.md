# Scarabokki

Il telefono senza fili disegnato, per giocare tra amici dal telefono.

## Pubblicare il gioco

Ogni modifica salvata sul branch `main` viene pubblicata da sola su
https://scarabokki-208a6.web.app (GitHub Actions, file `.github/workflows/firebase-hosting-merge.yml`).

Le regole del database (`database.rules.json`) non si pubblicano da sole. Quando cambiano,
dal Terminale del Mac dentro questa cartella:

```
npx firebase-tools deploy --only database
```

## Cosa c'è dentro

- `public/` il sito: `index.html` (schermate e stile), `app.js` (regole del gioco), `draw.js` (foglio da disegno), `net.js` (collegamento a Firebase)
- `database.rules.json` chi può leggere e scrivere cosa nel database
- `firebase.json`, `.firebaserc` configurazione per la pubblicazione
