// Draws a play onto an <svg>: field, arrows, players, ball.
import { el, drawField, viewBoxFor, nearestGoalY } from './field.js';
import { allStates, frame, staticFrame, ballSegments, routeSamples, phaseCount, hasPhases } from './engine.js';

export const R = 1.7; // player radius in yards
// Pieces are drawn larger on the full field so labels stay readable.
export const pieceScale = (field) => (field === 'full' ? 1.5 : 1);

let defsReady = false;
function ensureDefs() {
  if (defsReady) return;
  defsReady = true;
  const svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' });
  const defs = el('defs', {}, svg);
  const marker = (id, cls) => {
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 3.6, markerHeight: 3.6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0L10,5L0,10Z', class: cls }, m);
  };
  marker('ah-home', 'mk-home');
  marker('ah-opp', 'mk-opp');
  marker('ah-ball', 'mk-ball');
  marker('ah-look', 'mk-look');
  const f = el('filter', { id: 'ball-glow', x: '-100%', y: '-100%', width: '300%', height: '300%' }, defs);
  el('feGaussianBlur', { stdDeviation: 0.5 }, f);
  document.body.prepend(svg);
}

// ---- path helpers ----
function lengths(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

function pointAtLen(pts, cum, d) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, i };
}

function trim(pts, s, e) {
  const cum = lengths(pts);
  const L = cum[cum.length - 1];
  if (L < s + e + 0.4) return null;
  const out = [pointAtLen(pts, cum, s)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s && cum[i] < L - e) out.push(pts[i]);
  out.push(pointAtLen(pts, cum, L - e));
  return out;
}

function zigzag(pts, amp = 0.6, wave = 1.5) {
  const cum = lengths(pts);
  const L = cum[cum.length - 1];
  const out = [pts[0]];
  let k = 0;
  for (let d = 1.2; d < L - 1.6; d += wave / 2) {
    const p = pointAtLen(pts, cum, d);
    const q = pointAtLen(pts, cum, Math.min(L, d + 0.05));
    const dx = q.x - p.x, dy = q.y - p.y, n = Math.hypot(dx, dy) || 1;
    const s = k++ % 2 ? amp : -amp;
    out.push({ x: p.x + (-dy / n) * s, y: p.y + (dx / n) * s });
  }
  out.push(pointAtLen(pts, cum, Math.max(0, L - 1.2)));
  out.push(pts[pts.length - 1]);
  return out;
}

const toD = (pts) => 'M' + pts.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join('L');

// ---- pieces ----
export function drawPiece(g, p) {
  const n = el('g', { class: 'piece piece-' + p.type, 'data-id': p.id }, g);
  if (p.type === 'O' || p.type === 'X') {
    el('circle', { r: R, class: 'pc-body' }, n);
    const t = el('text', { class: 'pc-label', 'text-anchor': 'middle', dy: '0.36em', 'font-size': p.label.length > 2 ? 1.05 : 1.35 }, n);
    t.textContent = p.label;
  } else if (p.type === 'box') {
    // Substitution box: marks the subbing side of the field. Never moves.
    el('rect', { x: -1.4, y: -5, width: 2.8, height: 10, rx: 0.35, class: 'pc-box' }, n);
    const t = el('text', { class: 'pc-box-label', 'text-anchor': 'middle', dy: '0.36em', 'font-size': 1.7, transform: 'rotate(-90)' }, n);
    t.textContent = 'BOX';
  } else if (p.type === 'cone') {
    el('path', { d: 'M0,-1.3L1.15,1L-1.15,1Z', class: 'pc-cone' }, n);
  } else {
    el('rect', { x: -1.5, y: -1.5, width: 3, height: 3, rx: 0.5, class: 'pc-coach' }, n);
    const t = el('text', { class: 'pc-coach-label', 'text-anchor': 'middle', dy: '0.36em', 'font-size': 1.5 }, n);
    t.textContent = p.label || 'C';
  }
  return n;
}

// ---- arrows ----
export function drawStepArrows(g, play, step, s0, opts = {}) {
  const PR = R * pieceScale(play.field);
  const types = Object.fromEntries(play.pieces.map((p) => [p.id, p.type]));
  const wrap = el('g', { class: opts.faded ? 'arrows faded' : 'arrows' }, g);
  // When a step runs in phases, number each arrow so players can see the order.
  const badges = !opts.faded && hasPhases(step) && phaseCount(step) > 1;
  for (const m of step.moves) {
    const a = s0.pos[m.id];
    if (!a) continue;
    const team = types[m.id] === 'X' ? 'opp' : 'home';
    if (opts.ghosts) el('circle', { cx: a.x, cy: a.y, r: PR, class: 'ghost ghost-' + team, 'data-ids': m.id }, wrap);
    let pts = trim(routeSamples(a, m), PR + 0.15, m.kind === 'pick' ? PR + 0.5 : PR + 0.1);
    if (!pts) continue;
    if (m.kind === 'dodge') pts = zigzag(pts);
    const attrs = { d: toD(pts), class: `arw arw-${team} arw-${m.kind || 'run'}`, 'data-ids': m.id };
    if (m.kind !== 'pick') attrs['marker-end'] = `url(#ah-${team})`;
    el('path', attrs, wrap);
    if (badges) badge(wrap, pts, m.seq, m.id);
    if (m.kind === 'pick') {
      const e = pts[pts.length - 1], f = pts[pts.length - 2];
      const dx = e.x - f.x, dy = e.y - f.y, n = Math.hypot(dx, dy) || 1;
      const ux = (-dy / n) * 1.4, uy = (dx / n) * 1.4;
      el('path', { d: `M${e.x - ux},${e.y - uy}L${e.x + ux},${e.y + uy}`, class: `arw arw-${team} pick-bar`, 'data-ids': m.id }, wrap);
    }
  }
  for (const { e, A, B } of ballSegments(step, s0)) {
    const ids = [e.from, e.to].filter(Boolean).join(' ');
    const endTrim = e.type === 'pass' ? 1.1 * pieceScale(play.field) : 0.3;
    const pts = trim([A, B], 0.4, endTrim);
    if (!pts) continue;
    el('path', { d: toD(pts), class: 'arw arw-ball arw-' + e.type, 'marker-end': 'url(#ah-ball)', 'data-ids': ids }, wrap);
    if (badges) badge(wrap, pts, e.seq, ids);
  }
  return wrap;
}

function badge(g, pts, seq, ids) {
  const f = pts[0], l = pts[pts.length - 1];
  const p = pts.length > 4 ? pts[Math.round((pts.length - 1) * 0.3)] : { x: f.x + (l.x - f.x) * 0.3, y: f.y + (l.y - f.y) * 0.3 };
  const b = el('g', { class: 'phase-badge', transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`, 'data-ids': ids }, g);
  el('circle', { r: 0.85 }, b);
  el('text', { 'text-anchor': 'middle', dy: '0.36em', 'font-size': 1.1 }, b).textContent = String((seq ?? 0) + 1);
}

// ---- looks ----
// Passing options at the end of a step: bright blue dotted arrows from the looking player
// (where he finishes the step) to a teammate's finishing spot or to the goal. Display only.
export function drawLooks(g, play, step, end) {
  const PR = R * pieceScale(play.field);
  for (const lk of step.looks || []) {
    const a = end.pos[lk.from];
    const b = lk.to === 'goal' ? { x: 30, y: nearestGoalY(play.field, a?.y ?? 15) } : end.pos[lk.to];
    if (!a || !b) continue;
    const pts = trim([a, b], PR + 0.3, lk.to === 'goal' ? 1.2 : PR + 0.5);
    if (!pts) continue;
    el('path', { d: toD(pts), class: 'arw arw-look' + (lk.to === 'goal' ? ' arw-look-shot' : ''), 'marker-end': 'url(#ah-look)', 'data-ids': [lk.from, lk.to].join(' ') }, g);
  }
}

// ---- board ----
export function createBoard(svg, play, opts = {}) {
  ensureDefs();
  svg.innerHTML = '';
  svg.setAttribute('viewBox', viewBoxFor(play.field).join(' '));
  svg.classList.add('board');
  const L = {};
  for (const k of ['field', 'trails', 'arrows', 'looks', 'pieces', 'ball', 'overlay']) L[k] = el('g', { class: 'layer-' + k }, svg);
  drawField(L.field, play.field, opts);

  const nodes = {};
  for (const p of play.pieces) nodes[p.id] = drawPiece(L.pieces, p);
  const ballG = el('g', { class: 'ball' }, L.ball);
  el('circle', { r: 1.15, class: 'ball-glow', filter: 'url(#ball-glow)' }, ballG);
  el('circle', { r: 0.62, class: 'ball-core' }, ballG);

  const states = allStates(play);
  const ps = pieceScale(play.field);
  let curK = null;
  let focus = null;
  let trails = !!opts.trails;

  function place(fr) {
    for (const id in nodes) {
      const p = fr.pos[id];
      if (p) nodes[id].setAttribute('transform', `translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) scale(${ps})`);
    }
    if (fr.ball) {
      ballG.style.display = '';
      const s = ps * (1 + 0.5 * (fr.lift || 0));
      ballG.setAttribute('transform', `translate(${fr.ball.x.toFixed(3)} ${fr.ball.y.toFixed(3)}) scale(${s.toFixed(3)})`);
    } else {
      ballG.style.display = 'none';
    }
  }

  function applyFocus() {
    svg.classList.toggle('has-focus', !!focus);
    for (const n of svg.querySelectorAll('[data-id],[data-ids]')) {
      const ids = (n.getAttribute('data-ids') || n.getAttribute('data-id')).split(' ');
      n.classList.toggle('is-focus', !!focus && ids.includes(focus));
    }
  }

  function drawArrowsFor(k) {
    L.trails.innerHTML = '';
    L.arrows.innerHTML = '';
    L.looks.innerHTML = '';
    if (k == null || k < 0) return;
    if (play.steps[k]) drawLooks(L.looks, play, play.steps[k], states[k + 1]);
    if (trails) for (let j = 0; j < k; j++) drawStepArrows(L.trails, play, play.steps[j], states[j], { faded: true });
    if (play.steps[k]) drawStepArrows(L.arrows, play, play.steps[k], states[k], { ghosts: true });
  }

  const api = {
    svg, layers: L, nodes, states,
    // Show step k at fraction u. k = -1 shows the setup with no arrows.
    show(k, u = 0) {
      if (k !== curK) { drawArrowsFor(k); curK = k; applyFocus(); }
      if (k < 0 || !play.steps.length) place(staticFrame(states[0]));
      else place(frame(play.steps[k], states[k], u));
      // Looks appear once the step's movement is done (always, in the designer and print sheets).
      L.looks.classList.toggle('on', !!opts.looksAlways || (k >= 0 && u >= 0.97));
    },
    showFinal() {
      if (curK !== 'final') { L.trails.innerHTML = ''; L.arrows.innerHTML = ''; L.looks.innerHTML = ''; curK = 'final'; }
      place(staticFrame(states[states.length - 1]));
    },
    setFocus(id) { focus = id || null; applyFocus(); },
    setTrails(on) { trails = on; curK = null; }, // caller redraws
  };
  return api;
}
