// Play model and animation math. A play is a starting setup plus ordered steps.
//
// play = {
//   id, title, category, field: 'half'|'full', description,
//   pieces: [{ id, type: 'O'|'X'|'cone'|'coach', label, x, y }],
//   ball:   { holder: id } | { at: [x, y] },
//   steps:  [{ note, dur,
//              moves: [{ id, to:[x,y], path?:[[x,y]...], sharp?, kind:'run'|'dodge'|'pick', seq? }],
//              ball: [{ type:'pass', from, to, seq? } | { type:'shot', from, at, seq? } |
//                     { type:'roll', from?, at, seq? } | { type:'pickup', by, seq? }] }]
// }
//
// Timing inside a step. When any action has a `seq` (its phase number, 0-based), the step runs
// phase by phase: everything in a phase happens together. step.lead[w] says how much of phase w-1
// must finish before phase w starts: 1 = after it ends (default), 0.5 = halfway, 0.2 = just after
// it begins. Steps without phases (older plays) use the step's `order` preset instead.

// Where the ball sits relative to the player (stick side).
export const STICK = { x: 1.0, y: -1.0 };

export const ORDERS = {
  'pass-first': { ball: [0, 0.4], move: [0.3, 1] },
  together: { ball: [0.25, 0.75], move: [0, 1] },
  'move-first': { ball: [0.65, 1], move: [0, 0.7] },
};

export const DEFAULT_DUR = 2.2;
export const LEADS = [
  [1, 'after Phase {n} ends'],
  [0.5, 'when Phase {n} is halfway'],
  [0.2, 'just after Phase {n} begins'],
];
const BALL_SHARE = 0.45; // a pass or shot takes this share of a phase's time
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const pt = (x, y) => ({ x, y });
const withStick = (p) => pt(p.x + STICK.x, p.y + STICK.y);

// ---------- routes ----------
// A route runs from the player's start through any bend points to `to`, either as a smooth
// curve through the points or as straight legs with sharp corners.
export function routeControls(a, m) {
  return [a, ...(m.path || []).map(([x, y]) => pt(x, y)), pt(m.to[0], m.to[1])];
}

function segPoint(Q, i, t, sharp) {
  const p1 = Q[i], p2 = Q[i + 1];
  if (sharp) return pt(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
  const p0 = Q[i - 1] || p1, p3 = Q[i + 2] || p2; // Catmull-Rom through the points
  const t2 = t * t, t3 = t2 * t;
  const f = (a0, a1, a2, a3) => 0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
  return pt(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y));
}

const sampleCache = new WeakMap();
function sampler(a, m) {
  const key = `${a.x},${a.y}|${m.to}|${JSON.stringify(m.path || [])}|${m.sharp ? 1 : 0}`;
  const hit = sampleCache.get(m);
  if (hit && hit.key === key) return hit;
  const Q = routeControls(a, m);
  const per = Q.length > 2 && !m.sharp ? 24 : 1;
  const pts = [Q[0]];
  for (let i = 0; i < Q.length - 1; i++) for (let j = 1; j <= per; j++) pts.push(segPoint(Q, i, j / per, m.sharp));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const s = { key, pts, cum, L: cum[cum.length - 1] };
  sampleCache.set(m, s);
  return s;
}

// Point at fraction p of the route's length, so players move at an even speed.
export function routeAt(a, m, p) {
  const { pts, cum, L } = sampler(a, m);
  if (L === 0) return { ...pts[0] };
  const d = clamp01(p) * L;
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
  const t = (d - cum[lo - 1]) / (cum[lo] - cum[lo - 1] || 1);
  return pt(pts[lo - 1].x + (pts[lo].x - pts[lo - 1].x) * t, pts[lo - 1].y + (pts[lo].y - pts[lo - 1].y) * t);
}

export function routeSamples(a, m) {
  const { pts, L } = sampler(a, m);
  if (m.path?.length && !m.sharp) return pts;
  // Straight legs: add points along each leg so arrows can be trimmed and zigzagged.
  const n = Math.max(2, Math.ceil(L / 0.5));
  return Array.from({ length: n + 1 }, (_, i) => routeAt(a, m, i / n));
}

// Middle of leg i (between control points i and i+1), where a new bend point can be added.
export function legMid(a, m, i) {
  return segPoint(routeControls(a, m), i, 0.5, m.sharp);
}

// ---------- model ----------
export function normalizePlay(play) {
  play.field = play.field === 'full' ? 'full' : 'half';
  play.pieces = play.pieces || [];
  play.steps = (play.steps || []).map((s) => ({
    ...s,
    note: s.note || '',
    dur: s.dur || DEFAULT_DUR,
    order: ORDERS[s.order] ? s.order : 'pass-first',
    moves: (s.moves || []).map((m) => {
      if (m.via && !m.path) m.path = [m.via];
      delete m.via;
      return m;
    }),
    ball: s.ball || [],
  }));
  play.ball = play.ball || {};
  return play;
}

export const hasPhases = (step) => step.moves.some((m) => m.seq != null) || step.ball.some((e) => e.seq != null);

// Give every action in a step an explicit phase, matching how the step played before.
export function ensurePhases(step) {
  if (hasPhases(step)) {
    for (const x of [...step.moves, ...step.ball]) if (x.seq == null) x.seq = 0;
    return compactPhases(step);
  }
  const flying = step.ball.filter((e) => e.type !== 'pickup');
  const order = flying.length ? step.order : 'together';
  const ballSeq = order === 'move-first' ? 1 : 0;
  const moveSeq = order === 'pass-first' ? 1 : 0;
  for (const m of step.moves) m.seq = moveSeq;
  for (const e of step.ball) e.seq = e.type === 'pickup' ? moveSeq : ballSeq;
  return compactPhases(step);
}

// Renumber phases 0..n-1 with no gaps.
export function compactPhases(step) {
  const used = [...new Set([...step.moves, ...step.ball].map((x) => x.seq ?? 0))].sort((a, b) => a - b);
  const map = new Map(used.map((s, i) => [s, i]));
  for (const x of [...step.moves, ...step.ball]) x.seq = map.get(x.seq ?? 0);
  if (step.lead) {
    const lead = used.map((s, i) => (i === 0 ? null : step.lead[s] ?? null));
    if (lead.some((v) => v != null && v !== 1)) step.lead = lead; else delete step.lead;
  }
  return step;
}

export function phaseCount(step) {
  if (!hasPhases(step)) return 1;
  return 1 + Math.max(0, ...[...step.moves, ...step.ball].map((x) => x.seq ?? 0));
}

function phaseWeights(step) {
  const n = phaseCount(step);
  return Array.from({ length: n }, (_, w) => {
    const moves = step.moves.filter((m) => (m.seq ?? 0) === w).length;
    const flights = step.ball.filter((e) => (e.seq ?? 0) === w && e.type !== 'pickup').length;
    if (moves) return Math.max(1, flights * BALL_SHARE);
    if (flights) return flights * BALL_SHARE;
    return 0.2; // a scoop on its own
  });
}

// Start and length of each phase, in phase units, allowing phases to overlap.
function phaseLayout(step) {
  const weights = phaseWeights(step);
  const starts = [0];
  for (let w = 1; w < weights.length; w++) {
    const lead = step.lead?.[w] ?? 1;
    starts.push(starts[w - 1] + weights[w - 1] * lead);
  }
  const total = Math.max(...weights.map((wt, i) => starts[i] + wt));
  return { weights, starts, total };
}

// How long a step takes to play, in seconds at 1x speed.
export function stepSeconds(step) {
  const dur = step.dur || DEFAULT_DUR;
  if (!hasPhases(step)) return dur;
  return dur * phaseLayout(step).total;
}

// When each action runs, as fractions (0..1) of the step.
// Returns { win: Map(move -> [t0, t1]), ev: [{ e, t0, t1 }] in time order }.
export function timing(step) {
  const win = new Map();
  if (!hasPhases(step)) {
    const o = ORDERS[step.order] || ORDERS['pass-first'];
    const flying = step.ball.filter((e) => e.type !== 'pickup').length;
    const mv = flying ? o.move : [0, 1];
    for (const m of step.moves) win.set(m, mv);
    let i = 0;
    const ev = step.ball.map((e) => {
      if (e.type === 'pickup') return { e, t0: mv[1], t1: mv[1] };
      const span = o.ball[1] - o.ball[0];
      const r = { e, t0: o.ball[0] + (span * i) / flying, t1: o.ball[0] + (span * (i + 1)) / flying };
      i++;
      return r;
    });
    return { win, ev };
  }
  const { weights, starts, total } = phaseLayout(step);
  const slice = (w) => [starts[w] / total, (starts[w] + weights[w]) / total];
  for (const m of step.moves) win.set(m, slice(m.seq ?? 0));
  const ev = [];
  weights.forEach((weight, w) => {
    const [s0, s1] = slice(w);
    const flights = step.ball.filter((e) => (e.seq ?? 0) === w && e.type !== 'pickup');
    const hasMoves = step.moves.some((m) => (m.seq ?? 0) === w);
    // Passes take the front of a phase that also has runs; otherwise the whole phase.
    const span = hasMoves ? Math.min(1, (flights.length * BALL_SHARE) / weight) * (s1 - s0) : s1 - s0;
    flights.forEach((e, i) => ev.push({ e, t0: s0 + (span * i) / flights.length, t1: s0 + (span * (i + 1)) / flights.length }));
    for (const e of step.ball) if ((e.seq ?? 0) === w && e.type === 'pickup') ev.push({ e, t0: s1, t1: s1 });
  });
  ev.sort((x, y) => x.t0 - y.t0);
  return { win, ev };
}

export function initialState(play) {
  const pos = {};
  for (const p of play.pieces) pos[p.id] = pt(p.x, p.y);
  const b = play.ball || {};
  return {
    pos,
    holder: b.holder && pos[b.holder] ? b.holder : null,
    ball: b.at ? pt(b.at[0], b.at[1]) : null,
  };
}

function applyEvent(s, e) {
  if (e.type === 'pass') { s.holder = e.to; s.ball = null; }
  else if (e.type === 'pickup') { s.holder = e.by; s.ball = null; }
  else { s.holder = null; s.ball = pt(e.at[0], e.at[1]); }
}

export function endState(s0, step) {
  const s = { pos: {}, holder: s0.holder, ball: s0.ball ? { ...s0.ball } : null };
  for (const id in s0.pos) s.pos[id] = { ...s0.pos[id] };
  for (const m of step.moves) if (s.pos[m.id]) s.pos[m.id] = pt(m.to[0], m.to[1]);
  for (const { e } of timing(step).ev) applyEvent(s, e);
  return s;
}

// states[k] is the picture at the start of step k; the last entry is the final picture.
export function allStates(play) {
  const out = [initialState(play)];
  for (const step of play.steps) out.push(endState(out[out.length - 1], step));
  return out;
}

export function posAt(step, s0, id, u, tm) {
  const a = s0.pos[id];
  if (!a) return null;
  const m = step.moves.find((mm) => mm.id === id);
  if (!m) return { ...a };
  const [t0, t1] = tm.win.get(m) || [0, 1];
  const p = ease(clamp01((u - t0) / (t1 - t0 || 1)));
  const q = routeAt(a, m, p);
  if (m.kind === 'dodge' && p > 0 && p < 1) {
    // Shimmy side to side while dodging.
    const n = routeAt(a, m, Math.min(1, p + 0.01));
    const dx = n.x - q.x, dy = n.y - q.y, L = Math.hypot(dx, dy) || 1;
    const w = Math.sin(p * Math.PI * 6) * 0.7 * Math.sin(p * Math.PI);
    q.x += (-dy / L) * w;
    q.y += (dx / L) * w;
  }
  return q;
}

function evStart(step, s0, e, t0, tm, holder, ball) {
  const id = e.from || holder;
  if (id && s0.pos[id]) return withStick(posAt(step, s0, id, t0, tm));
  return ball ? { ...ball } : pt(30, 30);
}

function evEnd(step, s0, e, t1, tm) {
  if (e.type === 'pass' && s0.pos[e.to]) return withStick(posAt(step, s0, e.to, t1, tm));
  if (e.at) return pt(e.at[0], e.at[1]);
  return pt(30, 15);
}

// Everything on the field at fraction u (0..1) of a step.
export function frame(step, s0, u) {
  const tm = timing(step);
  const pos = {};
  for (const id in s0.pos) pos[id] = posAt(step, s0, id, u, tm);
  let holder = s0.holder;
  let ball = s0.ball ? { ...s0.ball } : null;
  for (const { e, t0, t1 } of tm.ev) {
    if (u < t0) break;
    if (u < t1) {
      const p = (u - t0) / (t1 - t0);
      const A = evStart(step, s0, e, t0, tm, holder, ball);
      const B = evEnd(step, s0, e, t1, tm);
      return {
        pos,
        holder: null,
        ball: pt(A.x + (B.x - A.x) * p, A.y + (B.y - A.y) * p),
        lift: e.type === 'roll' ? 0 : Math.sin(Math.PI * p),
      };
    }
    applyEvent({ set holder(v) { holder = v; }, set ball(v) { ball = v; } }, e);
  }
  if (holder && pos[holder]) ball = withStick(pos[holder]);
  return { pos, holder, ball, lift: 0 };
}

export function staticFrame(s) {
  const pos = {};
  for (const id in s.pos) pos[id] = { ...s.pos[id] };
  const ball = s.holder && pos[s.holder] ? withStick(pos[s.holder]) : s.ball ? { ...s.ball } : null;
  return { pos, holder: s.holder, ball, lift: 0 };
}

// Start and end points of each ball flight in a step, for drawing arrows.
export function ballSegments(step, s0) {
  const tm = timing(step);
  const s = { holder: s0.holder, ball: s0.ball };
  const out = [];
  for (const { e, t0, t1 } of tm.ev) {
    if (e.type !== 'pickup') out.push({ e, A: evStart(step, s0, e, t0, tm, s.holder, s.ball), B: evEnd(step, s0, e, t1, tm) });
    applyEvent(s, e);
  }
  return out;
}

// Who has the ball (or where it lies) after the events already in a step.
export function ballAfter(step, s0) {
  const s = { holder: s0.holder, ball: s0.ball };
  for (const { e } of timing(step).ev) applyEvent(s, e);
  return s;
}
