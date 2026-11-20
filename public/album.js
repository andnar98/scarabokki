// Renders one album as a single tall picture, ready to send in the group chat.
import { RATIO, UNIT, paintInto, roundRectPath as roundRect } from './draw.js';

const DISPLAY = 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';
const BODY = '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif';
const INK = '#2E2643', MUTED = '#6F6787';

function wrapLines(ctx, text, max) {
  const lines = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// album: { code, title, entries: [{ label, color, drawing, text, strokes }], finale?: { from, to } }  ->  PNG Blob
export async function albumBlob({ code, title, entries, finale }) {
  try { await Promise.all([document.fonts.load(`800 56px ${DISPLAY}`), document.fonts.load(`600 30px ${BODY}`)]); } catch (e) {}
  const W = 1080, P = 64, inner = W - P * 2, DW = 760, DH = Math.round(DW * RATIO);
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `800 50px ${DISPLAY}`;
  const blocks = entries.map(e => {
    if (e.drawing) return { e, h: 48 + (e.strokes.length ? DH : 120) + 44 };
    const lines = wrapLines(meas, e.text || '…', inner - 64);
    return { e, lines, h: 48 + lines.length * 62 + 44 + 44 };
  });
  // the closing card: where the album started, where it arrived
  let end = null;
  if (finale) {
    meas.font = `800 40px ${DISPLAY}`; const fromLines = wrapLines(meas, finale.from, inner - 80);
    meas.font = `800 52px ${DISPLAY}`; const toLines = wrapLines(meas, finale.to, inner - 80);
    end = { fromLines, toLines, h: 40 + 34 + fromLines.length * 50 + 64 + 34 + toLines.length * 62 + 36 };
  }
  const H = 230 + blocks.reduce((a, b) => a + b.h, 0) + (end ? end.h + 44 : 0) + 90;
  const f = Math.min(1, Math.sqrt(14e6 / (W * H)));      // stay inside the canvas size phones allow
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * f); cv.height = Math.round(H * f);
  const x = cv.getContext('2d'); x.scale(f, f);

  const bg = x.createLinearGradient(0, 0, W * .4, H);
  bg.addColorStop(0, '#F4EFFF'); bg.addColorStop(1, '#FFF0F4');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = MUTED; x.font = `700 26px ${BODY}`; x.fillText('SCARABOKKI · PARTITA ' + code, P, 92);
  x.fillStyle = INK; x.font = `800 72px ${DISPLAY}`; x.fillText(title, P, 178, inner);

  let y = 230;
  for (const b of blocks) {
    const e = b.e;
    x.fillStyle = e.color; x.beginPath(); x.arc(P + 16, y + 18, 16, 0, Math.PI * 2); x.fill();
    x.fillStyle = INK; x.font = `700 28px ${BODY}`;
    x.fillText(e.label, P + 44, y + 28, inner - 44);
    y += 48;
    if (e.drawing) {
      const dx = (W - DW) / 2, dh = e.strokes.length ? DH : 120;
      x.save(); x.shadowColor = 'rgba(80,60,140,.16)'; x.shadowBlur = 24; x.shadowOffsetY = 6;
      x.fillStyle = '#FFFFFF'; roundRect(x, dx, y, DW, dh, 20); x.fill(); x.restore();
      if (e.strokes.length) {
        x.save(); roundRect(x, dx, y, DW, dh, 20); x.clip();
        paintInto(x, dx, y, DW / UNIT, e.strokes);
        x.restore();
      } else { x.fillStyle = MUTED; x.font = `italic 30px ${BODY}`; x.fillText('Foglio bianco', dx + 32, y + 70); }
      y += dh + 44;
    } else {
      const bh = b.lines.length * 62 + 44;
      x.save(); x.shadowColor = 'rgba(80,60,140,.14)'; x.shadowBlur = 20; x.shadowOffsetY = 4;
      x.fillStyle = '#FFFFFF'; roundRect(x, P, y, inner, bh, 26); x.fill(); x.restore();
      x.fillStyle = INK; x.font = `800 50px ${DISPLAY}`;
      b.lines.forEach((ln, j) => x.fillText(ln, P + 32, y + 22 + 50 + j * 62, inner - 64));
      y += bh + 44;
    }
  }
  if (end) {
    const g = x.createLinearGradient(P, y, W - P, y + end.h);
    g.addColorStop(0, '#FFD966'); g.addColorStop(1, '#FFC2D4');
    x.save(); x.shadowColor = 'rgba(80,60,140,.18)'; x.shadowBlur = 24; x.shadowOffsetY = 6;
    x.fillStyle = g; roundRect(x, P, y, inner, end.h, 30); x.fill(); x.restore();
    let ty = y + 40;
    const label = t => { x.fillStyle = 'rgba(46,38,67,.62)'; x.font = `700 24px ${BODY}`; x.fillText(t.toUpperCase(), P + 40, ty + 20); ty += 34; };
    label('È partito da');
    x.fillStyle = 'rgba(46,38,67,.78)'; x.font = `800 40px ${DISPLAY}`;
    for (const ln of end.fromLines) { ty += 50; x.fillText(ln, P + 40, ty - 10, inner - 80); }
    x.fillStyle = 'rgba(46,38,67,.5)'; x.font = `900 40px ${DISPLAY}`; x.fillText('↓', P + 40, ty + 46); ty += 64;
    label('Ed è arrivato a');
    x.fillStyle = INK; x.font = `800 52px ${DISPLAY}`;
    for (const ln of end.toLines) { ty += 62; x.fillText(ln, P + 40, ty - 12, inner - 80); }
  }
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  cv.width = cv.height = 0;
  return blob;
}
