// Renders one album as a single tall picture, ready to send in the group chat.
import { RATIO, UNIT, paintInto } from './draw.js';

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
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// album: { code, title, entries: [{ label, color, drawing, text, strokes }] }  ->  PNG Blob
export async function albumBlob({ code, title, entries }) {
  try { await Promise.all([document.fonts.load(`800 56px ${DISPLAY}`), document.fonts.load(`600 30px ${BODY}`)]); } catch (e) {}
  const W = 1080, P = 64, inner = W - P * 2, DW = 760, DH = Math.round(DW * RATIO);
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `800 50px ${DISPLAY}`;
  const blocks = entries.map(e => {
    if (e.drawing) return { e, h: 48 + (e.strokes.length ? DH : 120) + 44 };
    const lines = wrapLines(meas, e.text || '…', inner - 64);
    return { e, lines, h: 48 + lines.length * 62 + 44 + 44 };
  });
  const H = 230 + blocks.reduce((a, b) => a + b.h, 0) + 90;
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
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  cv.width = cv.height = 0;
  return blob;
}
