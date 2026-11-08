// Network layer: Firebase Realtime Database + anonymous sign-in.
// The rest of the game only talks to the functions exported here.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getDatabase, ref, onValue, get as fbGet, set, update, remove,
  runTransaction, onDisconnect, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCv9wl4_In5ZeKQLLuPtT_Ftm32lFFsKOw',
  authDomain: 'scarabokki-208a6.firebaseapp.com',
  databaseURL: 'https://scarabokki-208a6-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'scarabokki-208a6',
  storageBucket: 'scarabokki-208a6.firebasestorage.app',
  messagingSenderId: '457752868407',
  appId: '1:457752868407:web:d862848374081510d7b1b2'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let offset = 0;
onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });

export const TS = serverTimestamp();
export const now = () => Date.now() + offset;

export async function init() {
  if (auth.authStateReady) await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}
export function on(path, cb) {
  return onValue(ref(db, path), s => cb(s.val()), err => console.warn('[net] listen', path, err && err.code));
}
export async function get(path) { return (await fbGet(ref(db, path))).val(); }
export function put(path, value) { return set(ref(db, path), value); }
export function patch(path, values) { return update(ref(db, path), values); }
export function del(path) { return remove(ref(db, path)); }
export async function txn(path, fn) {
  const r = await runTransaction(ref(db, path), fn, { applyLocally: false });
  return r.committed;
}
export function onConn(cb) { return onValue(ref(db, '.info/connected'), s => cb(s.val() === true)); }
export function onDrop(path, value) { return onDisconnect(ref(db, path)).set(value); }
export function cancelDrop(path) { return onDisconnect(ref(db, path)).cancel(); }
