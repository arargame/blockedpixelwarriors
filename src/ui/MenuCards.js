import railArtUrl from '../../assets/textures/menu/rail.jpg?url';
import lockedAUrl from '../../assets/textures/menu/locked_a.jpg?url';
import lockedBUrl from '../../assets/textures/menu/locked_b.jpg?url';
import { CARD_W, CARD_H, SERIF, drawRichText } from './UpgradeCards.js';
import { menuText } from './MenuText.js';

/**
 * Main menu rows and their cards. Cards use the upgrade card model without the ribbon; the face
 * (painting, gold divider, title, kind label, description) is painted here per language.
 *
 *   art     painting for the window (scenario screenshots); option cards blur it as a backdrop
 *   emblem  gold icon painted over the backdrop (sound, graphics, globe, power, lock)
 *   tint    colour wash over the backdrop
 */
export const MENU_ROWS = Object.freeze([
  {
    id: 'play',
    label: 'play',
    sub: 'playSub',
    head: 'playHead',
    cards: [
      { id: 'rail', scenario: true, art: railArtUrl, focus: 0.55, jewel: 0xff4a3a, glow: 0xffb050, title: 'railTitle', kind: 'railKind', text: 'railText' },
      { id: 'locked2', locked: true, art: lockedAUrl, emblem: 'lock', tint: '#2f6bff', jewel: 0x7d8796, glow: 0x7fa8ff, title: 'lockedTitle', kind: 'locked2Kind', text: 'lockedText' },
      { id: 'locked3', locked: true, art: lockedBUrl, emblem: 'lock', tint: '#ff4a2a', jewel: 0x7d8796, glow: 0xff9a7a, title: 'lockedTitle', kind: 'locked3Kind', text: 'lockedText' },
    ],
  },
  {
    id: 'options',
    label: 'options',
    sub: 'optionsSub',
    head: 'optionsHead',
    cards: [
      { id: 'sound', panel: 'sound', art: railArtUrl, emblem: 'sound', tint: '#14b8c8', jewel: 0x47c8ff, glow: 0x7fd0ff, title: 'soundTitle', kind: 'optionsKind', text: 'soundText' },
      { id: 'graphics', panel: 'graphics', art: railArtUrl, emblem: 'graphics', tint: '#ff9a1a', jewel: 0xffb020, glow: 0xffd860, title: 'graphicsTitle', kind: 'optionsKind', text: 'graphicsText' },
      { id: 'language', panel: 'language', art: railArtUrl, emblem: 'globe', tint: '#46c84a', jewel: 0x7be86a, glow: 0x9cff8a, title: 'languageTitle', kind: 'optionsKind', text: 'languageText' },
    ],
  },
  {
    id: 'exit',
    label: 'exit',
    sub: 'exitSub',
    head: 'exitHead',
    cards: [
      { id: 'exit', panel: 'exit', art: railArtUrl, emblem: 'power', tint: '#e8322a', jewel: 0xff5040, glow: 0xff8a6a, title: 'exitTitle', kind: 'exitKind', text: 'exitText' },
    ],
  },
]);

export const MENU_FRONT_W = 1024;
export const MENU_FRONT_H = Math.round(MENU_FRONT_W * CARD_H / CARD_W);
/** Fraction of the face height covered by the painting (the gold divider sits here). */
export const MENU_ART_BOTTOM = 0.6;

/** Card face for a menu card in `lang`. */
export function menuFrontCanvas(def, img, lang) {
  const W = MENU_FRONT_W;
  const H = MENU_FRONT_H;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#16110d';
  g.fillRect(0, 0, W, H);
  const artBottom = H * MENU_ART_BOTTOM;

  if (img && def.scenario) {
    // Sharp painting, cover-fitted to the window around the point of interest.
    const s = Math.max(W / img.width, (artBottom + H * 0.08) / img.height);
    const iw = img.width * s;
    const ih = img.height * s;
    const y = Math.min(0, Math.max(artBottom + H * 0.08 - ih, artBottom / 2 - (def.focus ?? 0.5) * ih));
    g.drawImage(img, (W - iw) / 2, y, iw, ih);
  } else if (img) {
    // Backdrop: blurred, darkened painting washed with the card colour.
    const s = Math.max(W / img.width, H / img.height) * 1.15;
    g.save();
    g.filter = def.locked ? 'blur(10px) grayscale(0.7) brightness(0.42)' : 'blur(26px) brightness(0.42) saturate(0.6)';
    g.drawImage(img, (W - img.width * s) / 2, (artBottom - img.height * s) / 2 + H * 0.05, img.width * s, img.height * s);
    g.restore();
    g.save();
    g.globalCompositeOperation = 'overlay';
    const wash = g.createRadialGradient(W / 2, artBottom * 0.48, W * 0.05, W / 2, artBottom * 0.5, W * 0.75);
    wash.addColorStop(0, def.tint);
    wash.addColorStop(1, '#000000');
    g.fillStyle = wash;
    g.fillRect(0, 0, W, artBottom + H * 0.1);
    g.restore();
    // Light rays behind the emblem.
    g.save();
    g.translate(W / 2, artBottom * 0.47);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      g.rotate(Math.PI / 8);
      const ray = g.createLinearGradient(0, 0, W * 0.55, 0);
      ray.addColorStop(0, hexA(def.tint, 0.22));
      ray.addColorStop(1, hexA(def.tint, 0));
      g.fillStyle = ray;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(W * 0.6, -W * 0.05);
      g.lineTo(W * 0.6, W * 0.05);
      g.closePath();
      g.fill();
    }
    g.restore();
    drawEmblem(g, def.emblem, W / 2, artBottom * 0.47, W * 0.36, def.tint);
    if (def.locked) drawStamp(g, menuText(lang, 'comingSoon'), W / 2, artBottom * 0.82, W);
  }

  // Reading panel: the lower part fades into dark leather-brown.
  const grad = g.createLinearGradient(0, artBottom - H * 0.14, 0, H);
  grad.addColorStop(0, 'rgba(14,10,8,0)');
  grad.addColorStop(0.32, 'rgba(14,10,8,0.9)');
  grad.addColorStop(1, 'rgba(10,7,5,0.98)');
  g.fillStyle = grad;
  g.fillRect(0, artBottom - H * 0.14, W, H);
  const vg = g.createRadialGradient(W / 2, H * 0.36, W * 0.38, W / 2, H * 0.45, W * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // Gold divider where the ribbon used to be: double rule with a diamond in the middle.
  const gold = (y0, y1) => {
    const gg = g.createLinearGradient(0, y0, 0, y1);
    gg.addColorStop(0, '#fff0b3');
    gg.addColorStop(0.5, '#d9a33c');
    gg.addColorStop(1, '#8a5a12');
    return gg;
  };
  const dy = artBottom + H * 0.012;
  g.fillStyle = gold(dy - 5, dy + 5);
  g.fillRect(W * 0.06, dy - 4, W * 0.88, 5);
  g.fillRect(W * 0.12, dy + 7, W * 0.76, 2);
  g.save();
  g.translate(W / 2, dy);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#2a1a06';
  g.fillRect(-17, -17, 34, 34);
  g.fillStyle = gold(-14, 14);
  g.fillRect(-13, -13, 26, 26);
  g.fillStyle = `#${def.jewel.toString(16).padStart(6, '0')}`;
  g.fillRect(-6, -6, 12, 12);
  g.restore();

  // Title: gold serif, fitted to the card width.
  const title = menuText(lang, def.title);
  const spaced = title.split('').join(String.fromCharCode(8202));
  let size = Math.round(W * 0.105);
  g.font = `700 ${size}px ${SERIF}`;
  while (g.measureText(spaced).width > W * 0.84 && size > 24) {
    size -= 2;
    g.font = `700 ${size}px ${SERIF}`;
  }
  const ty = dy + H * 0.075;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.14;
  g.strokeStyle = '#1a0d04';
  g.strokeText(spaced, W / 2, ty);
  const tg = g.createLinearGradient(0, ty - size * 0.45, 0, ty + size * 0.4);
  tg.addColorStop(0, '#fff6cf');
  tg.addColorStop(0.5, '#f3cf6b');
  tg.addColorStop(1, '#c58a24');
  g.fillStyle = tg;
  g.fillText(spaced, W / 2, ty);

  // Kind label between thin gold rules.
  const ky = ty + size * 0.62 + H * 0.02;
  g.font = `600 ${Math.round(W * 0.031)}px ${SERIF}`;
  const label = menuText(lang, def.kind).split('').join(String.fromCharCode(8202));
  const lw = g.measureText(label).width;
  g.fillStyle = def.locked ? '#a9b3c2' : '#e9c46a';
  g.fillText(label, W / 2, ky);
  g.strokeStyle = def.locked ? 'rgba(169,179,194,0.6)' : 'rgba(233,196,106,0.7)';
  g.lineWidth = 2;
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.moveTo(W / 2 + sgn * (lw / 2 + 14), ky);
    g.lineTo(W / 2 + sgn * Math.min(W * 0.46, lw / 2 + 90), ky);
    g.stroke();
  }

  // Description.
  const top = ky + H * 0.018;
  const maxY = H * 0.94;
  const segs = [[menuText(lang, def.text)]];
  let ts = Math.round(W * 0.05);
  while (ts > W * 0.03 && !drawRichText(g, segs, W / 2, top, W * 0.8, ts, maxY, true)) ts -= 2;
  drawRichText(g, segs, W / 2, top, W * 0.8, ts, maxY);
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Diagonal rubber stamp ("COMING SOON") across the painting of a locked card. */
function drawStamp(g, text, x, y, W) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  g.font = `900 ${Math.round(W * 0.07)}px 'Arial Black', 'Segoe UI Black', Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tw = g.measureText(text).width;
  const h = W * 0.11;
  g.strokeStyle = 'rgba(255,90,70,0.9)';
  g.lineWidth = 8;
  g.strokeRect(-tw / 2 - 26, -h / 2, tw + 52, h);
  g.lineWidth = 3;
  g.strokeRect(-tw / 2 - 16, -h / 2 + 10, tw + 32, h - 20);
  g.fillStyle = 'rgba(255,96,74,0.95)';
  g.fillText(text, 0, 4);
  g.restore();
}

/**
 * Gold emblem (icon) centred at x, y, `size` across: dark outline, gold gradient, coloured glow.
 * Shapes are drawn in a 100 x 100 box around the centre.
 */
export function drawEmblem(g, kind, x, y, size, tint) {
  const s = size / 100;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const goldFill = g.createLinearGradient(0, -50, 0, 50);
  goldFill.addColorStop(0, '#fff3c0');
  goldFill.addColorStop(0.45, '#f0c55a');
  goldFill.addColorStop(1, '#9a6514');
  const paths = []; // [Path2D, 'fill'|'stroke', lineWidth]
  const P = () => new Path2D();
  if (kind === 'sound') {
    const body = P();
    body.moveTo(-40, -12);
    body.lineTo(-22, -12);
    body.lineTo(2, -32);
    body.lineTo(2, 32);
    body.lineTo(-22, 12);
    body.lineTo(-40, 12);
    body.closePath();
    paths.push([body, 'fill']);
    for (const r of [18, 32, 46]) {
      const w = P();
      w.arc(4, 0, r, -0.85, 0.85);
      paths.push([w, 'stroke', 7]);
    }
  } else if (kind === 'graphics') {
    const frame = P();
    roundRect(frame, -46, -36, 92, 62, 8);
    paths.push([frame, 'stroke', 8]);
    const stand = P();
    stand.moveTo(-8, 26);
    stand.lineTo(8, 26);
    stand.lineTo(12, 40);
    stand.lineTo(-12, 40);
    stand.closePath();
    roundRect(stand, -24, 40, 48, 7, 3);
    paths.push([stand, 'fill']);
    // Voxel cube in the screen.
    const cube = P();
    cube.moveTo(0, -24);
    cube.lineTo(18, -15);
    cube.lineTo(18, 5);
    cube.lineTo(0, 14);
    cube.lineTo(-18, 5);
    cube.lineTo(-18, -15);
    cube.closePath();
    paths.push([cube, 'fill']);
    const edges = P();
    edges.moveTo(-18, -15);
    edges.lineTo(0, -6);
    edges.lineTo(18, -15);
    edges.moveTo(0, -6);
    edges.lineTo(0, 14);
    paths.push([edges, 'edge', 3]);
  } else if (kind === 'globe') {
    const o = P();
    o.arc(0, 0, 42, 0, Math.PI * 2);
    paths.push([o, 'stroke', 7]);
    const m = P();
    m.ellipse(0, 0, 18, 42, 0, 0, Math.PI * 2);
    m.moveTo(0, -42);
    m.lineTo(0, 42);
    m.moveTo(-42, 0);
    m.lineTo(42, 0);
    m.moveTo(-36, -21);
    m.quadraticCurveTo(0, -12, 36, -21);
    m.moveTo(-36, 21);
    m.quadraticCurveTo(0, 12, 36, 21);
    paths.push([m, 'stroke', 5]);
  } else if (kind === 'power') {
    const a = P();
    a.arc(0, 4, 38, -Math.PI / 2 + 0.62, -Math.PI / 2 - 0.62 + Math.PI * 2);
    paths.push([a, 'stroke', 10]);
    const l = P();
    l.moveTo(0, -46);
    l.lineTo(0, 2);
    paths.push([l, 'stroke', 10]);
  } else if (kind === 'lock') {
    const sh = P();
    sh.moveTo(-22, -4);
    sh.lineTo(-22, -20);
    sh.arc(0, -20, 22, Math.PI, 0);
    sh.lineTo(22, -4);
    paths.push([sh, 'stroke', 9]);
    const body = P();
    roundRect(body, -34, -6, 68, 52, 8);
    paths.push([body, 'fill']);
    const hole = P();
    hole.arc(0, 14, 7, 0, Math.PI * 2);
    hole.moveTo(-4, 16);
    hole.lineTo(4, 16);
    hole.lineTo(6, 32);
    hole.lineTo(-6, 32);
    hole.closePath();
    paths.push([hole, 'hole']);
  }
  // Glow, then outline, then gold.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = tint ?? '#ffcf6a';
  g.shadowBlur = 12 * s;
  for (const [p, mode, w] of paths) {
    if (mode === 'hole' || mode === 'edge') continue;
    g.strokeStyle = 'rgba(0,0,0,0.0)';
    g.fillStyle = '#2a1a06';
    if (mode === 'fill') g.fill(p);
    else {
      g.strokeStyle = '#2a1a06';
      g.lineWidth = w + 7;
      g.stroke(p);
    }
  }
  g.shadowBlur = 0;
  for (const [p, mode, w] of paths) {
    if (mode === 'fill') {
      g.strokeStyle = '#2a1a06';
      g.lineWidth = 7;
      g.stroke(p);
      g.fillStyle = goldFill;
      g.fill(p);
    } else if (mode === 'stroke') {
      g.strokeStyle = '#2a1a06';
      g.lineWidth = w + 7;
      g.stroke(p);
      g.strokeStyle = goldFill;
      g.lineWidth = w;
      g.stroke(p);
    } else if (mode === 'hole') {
      g.fillStyle = '#2a1a06';
      g.fill(p);
    } else if (mode === 'edge') {
      g.strokeStyle = 'rgba(42,26,6,0.85)';
      g.lineWidth = w;
      g.stroke(p);
    }
  }
  g.restore();
}

function roundRect(p, x, y, w, h, r) {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  p.closePath();
}
