// Men's lacrosse field, drawn in yards. Field is 60 wide x 110 long.
// Our offense always attacks the top goal (y = 15).
export const NS = 'http://www.w3.org/2000/svg';
export const GOALS = { top: 15, bottom: 95 };

export function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

export function viewBoxFor(field) {
  // Half field shows a few yards past midfield so the wing lines read.
  return field === 'full' ? [-3, -3, 66, 116] : [-3, -3, 66, 62];
}

export function fieldBounds(field) {
  return field === 'full' ? { x0: -2, x1: 62, y0: -2, y1: 112 } : { x0: -2, x1: 62, y0: -2, y1: 58 };
}

export function nearestGoalY(field, y) {
  if (field !== 'full') return GOALS.top;
  return Math.abs(y - GOALS.top) <= Math.abs(y - GOALS.bottom) ? GOALS.top : GOALS.bottom;
}

export function drawField(g, field, opts = {}) {
  const full = field === 'full';
  const [vx, vy, vw, vh] = viewBoxFor(field);
  el('rect', { x: vx, y: vy, width: vw, height: vh, class: 'turf' }, g);
  const len = full ? 110 : 59;
  for (let y = 0; y < len; y += 10) el('rect', { x: 0, y, width: 60, height: Math.min(5, len - y), class: 'turf-stripe' }, g);

  // Club logo painted on the turf: dead center on the full field; on the half field,
  // centered in the open space between the restraining line and midfield.
  const lw = full ? 26 : 21, lh = lw * (236 / 432), cy = full ? 55 : 45.5;
  el('image', { href: 'assets/logo.png', x: 30 - lw / 2, y: cy - lh / 2, width: lw, height: lh, class: 'field-logo', preserveAspectRatio: 'xMidYMid meet' }, g);

  const line = (d, cls = 'chalk') => el('path', { d, class: cls }, g);
  line(full ? 'M0,0H60V110H0Z' : 'M0,62V0H60V62');

  // Restraining lines (20 yd from midfield) and the dashed box sides.
  const ends = full ? [[35, 0], [75, 110]] : [[35, 0]];
  for (const [ry, endY] of ends) {
    line(`M0,${ry}H60`);
    line(`M10,${endY}V${ry}M50,${endY}V${ry}`, 'chalk dashed');
  }

  // Midfield, wing lines, faceoff X.
  line('M0,55H60');
  line('M10,45V65M50,45V65');
  line('M29.1,54.1L30.9,55.9M30.9,54.1L29.1,55.9', 'chalk thick');

  // Goals: 15 yd from the end line, 9 ft crease, 6 ft mouth.
  for (const gy of full ? [GOALS.top, GOALS.bottom] : [GOALS.top]) {
    const dir = gy < 55 ? -1 : 1;
    line(`M10,${gy}H50`, 'chalk gle');
    el('circle', { cx: 30, cy: gy, r: 3, class: 'chalk' }, g);
    el('path', { d: `M29,${gy}L30,${gy + dir * 2.3}L31,${gy}Z`, class: 'net' }, g);
    line(`M29,${gy}H31`, 'goal-line');
  }

  if (opts.watermark) {
    const t = el('text', { x: 59.2, y: full ? 109 : 57.8, 'text-anchor': 'end', class: 'wm' }, g);
    t.textContent = 'ANNAPOLIS HAWKS';
  }
}
