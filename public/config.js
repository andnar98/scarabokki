// Settings and fixed lists of the game.

export const T = globalThis.__SCARA_TEST || {};
export const CFG = {
  maxPlayers: 20, minPlayers: 2, nameMax: 16, textMax: 80,
  grace: 3000,                     // after the deadline, wait this long for last saves before moving on
  intro: 1200,                     // every round starts with a short title card; the clock allows for it
  gone: T.gone ?? 30000,           // a player offline this long no longer holds up the round
  hostGone: T.hostGone ?? 30000,   // the host offline this long hands control to the next player
  drawTimes: [60, 90, 120, 180],
  writeTimes: [30, 45, 60, 90],
  defaults: { draw: 90, write: 45 }
};
export const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const AV = ['#FFB3BA', '#FFCFA3', '#FFE58F', '#C5F0A4', '#A8E6CF', '#9EDCF5', '#A9C5FF', '#C7B8FF', '#F2B5F0', '#FFC2D4', '#E3CDB0', '#B8E0D2'];
export const IDEAS = [
  'Un pinguino che vende gelati al Polo Nord', 'Un gatto astronauta che ha perso le chiavi', 'La nonna che fa skateboard',
  'Una pizza innamorata di un ananas', 'Un dinosauro dal parrucchiere', 'Una mucca che fa yoga al tramonto',
  'Il Wi-Fi che non prende', 'Un fantasma che ha paura del buio', 'Una giraffa in ascensore',
  'Un riccio che abbraccia un palloncino', 'Il lunedì mattina', 'Una banana in fuga dalla polizia',
  'Un polpo che suona la batteria', 'Babbo Natale in infradito', 'Un vampiro dal dentista',
  'Una lumaca alla Formula 1', 'Un cane che porta a spasso il padrone', 'La Torre di Pisa che si raddrizza',
  'Un robot che piange guardando un film', 'Una tartaruga con il jetpack', 'Un panino gigante che mangia una persona',
  'Un orso che fa la spesa', 'Il sole che va in vacanza', 'Una sirena in metropolitana',
  'Un gufo che fa il DJ', 'Un supereroe con il raffreddore', 'Una pecora che conta gli umani per dormire',
  'Il caffè che si sveglia da solo', 'Un elefante sulle punte', 'Un alieno che ordina un kebab',
  'Una scarpa che scappa dal piede', 'Il gatto che si siede sulla tastiera', 'Un cactus che vuole un abbraccio',
  'Una mummia che fa il bucato', 'Un pirata con il mal di mare', 'Un cervello che va in palestra',
  'La luna che si mangia una fetta di formaggio', 'Un fenicottero che gioca a calcio', 'Il frigorifero che russa',
  'Un mago a cui sparisce il coniglio'
];

export function idea(seed) { return IDEAS[(seed === undefined ? Math.floor(Math.random() * 1e9) : seed) % IDEAS.length]; }
