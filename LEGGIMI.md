# Scarabokki

Il telefono senza fili disegnato, per giocare tra amici dal telefono.

## Pubblicare il gioco

Ogni modifica salvata sul branch `main` viene pubblicata da sola su
https://scarabokki-208a6.web.app (GitHub Actions, file `.github/workflows/firebase-hosting-merge.yml`),
ma solo se i test automatici passano: se uno fallisce, il sito resta alla versione precedente.

Le regole del database (`database.rules.json`) non si pubblicano da sole. Quando cambiano,
dal Terminale del Mac dentro questa cartella:

```
npx firebase-tools deploy --only database
```

## Cosa c'è dentro

- `public/index.html` schermate e stile
- `public/app.js` il gioco: stanze, turni, rivelazione
- `public/game.js` regole pure del gioco (chi lavora su quale album, fine del turno, album finali)
- `public/draw.js` foglio da disegno: tratti, secchiello, zoom
- `public/ui.js` pezzi d'interfaccia condivisi: schermate, messaggi, conferme, vibrazione
- `public/album.js` immagine dell'album da salvare
- `public/net.js` collegamento a Firebase
- `tests/` test automatici (dal Terminale, dentro questa cartella: `npm test`)
- `database.rules.json` chi può leggere e scrivere cosa nel database
- `firebase.json`, `.firebaserc`, `.github/workflows/` configurazione per la pubblicazione
