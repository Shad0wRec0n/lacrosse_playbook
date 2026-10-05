// Play model and animation math. A play is a starting setup plus ordered steps.
//
// play = {
//   id, title, category, field: 'half'|'full', description,
//   pieces: [{ id, type: 'O'|'X'|'cone'|'coach', label, x, y }],
//   ball:   { holder: id } | { at: [x, y] },
//   steps:  [{ note, dur, order, moves: [{ id, to:[x,y], via?:[x,y], kind:'run'|'dodge'|'pick' }],
//              ball: [{ type:'pass', from, to } | { type:'shot', from, at } |
//                     { type:'roll', from?, at } | { type:'pickup', by }] }]
// }

// Where the ball sits relative to the player (stick side).
export const STICK = { x: 1.0, y: -1.0 };

export const ORDERS = {
  'pass-first': { ball: [0, 0.4], move: [0.3, 1] },
  together: { ball: [0.25, 0.75], move: [0, 1] },
  'move-first': { ball: [0.65, 1], move: [0, 0.7] },
};
export const ORDER_LABELS = {
  'pass-first': 'Ball first, then players move',
  together: 'Ball and players at the same time',
  'move-first': 'Players move first, then the ball',
};

export const DEFAULT_DUR = 2.2;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const pt = (x, y) => ({ x, y });
const withStick = (p) => pt(p.x + STICK.x, p.y + STICK.y);

// Quadratic curve that passes through `via` at its midpoint.
export function bezier(a, b, via, p) {
  if (!via) return pt(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p);
  const c = pt(2 * via[0] - (a.x + b.x) / 2, 2 * via[1] - (a.y + b.y) / 2);
  const q = 1 - p;
  return pt(q * q * a.x + 2 * q * p * c.x + p * p * b.x, q * q * a.y + 2 * q * p * c.y + p * p * b.y);
}

export function normalizePlay(play) {
  play.field = play.field === 'full' ? 'full' : 'half';
  play.pieces = play.pieces || [];
  play.steps = (play.steps || []).map((s) => ({
    note: s.note || '',
    dur: s.dur || DEFAULT_DUR,
    order: ORDERS[s.order] ? s.order : 'pass-first',
    moves: s.moves || [],
    ball: s.ball || [],
  }));
  play.ball = play.ball || {};
  return play;
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
  for (const e of step.ball) applyEvent(s, e);
  return s;
}

// states[k] is the picture at the start of step k; the last entry is the final picture.
export function allStates(play) {
  const out = [initialState(play)];
  for (const step of play.steps) out.push(endState(out[out.length - 1], step));
  return out;
}

export function timing(step) {
  const o = ORDERS[step.order] || ORDERS['pass-first'];
  const flying = step.ball.filter((e) => e.type !== 'pickup').length;
  const mv = flying ? o.move : [0, 1];
  let i = 0;
  const ev = step.ball.map((e) => {
    if (e.type === 'pickup') return { e, t0: mv[1], t1: mv[1] };
    const span = o.ball[1] - o.ball[0];
    const r = { e, t0: o.ball[0] + (span * i) / flying, t1: o.ball[0] + (span * (i + 1)) / flying };
    i++;
    return r;
  });
  return { mv, ev };
}

export function posAt(step, s0, id, u, tm) {
  const a = s0.pos[id];
  if (!a) return null;
  const m = step.moves.find((mm) => mm.id === id);
  if (!m) return { ...a };
  const p = ease(clamp01((u - tm.mv[0]) / (tm.mv[1] - tm.mv[0])));
  const b = pt(m.to[0], m.to[1]);
  const q = bezier(a, b, m.via, p);
  if (m.kind === 'dodge' && p > 0 && p < 1) {
    // Shimmy side to side while dodging.
    const n = bezier(a, b, m.via, Math.min(1, p + 0.01));
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
    if (e.type === 'pass') { holder = e.to; ball = null; }
    else if (e.type === 'pickup') { holder = e.by; ball = null; }
    else { holder = null; ball = pt(e.at[0], e.at[1]); }
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
  let holder = s0.holder;
  let ball = s0.ball;
  const out = [];
  for (const { e, t0, t1 } of tm.ev) {
    if (e.type !== 'pickup') {
      out.push({ e, A: evStart(step, s0, e, t0, tm, holder, ball), B: evEnd(step, s0, e, t1, tm) });
    }
    if (e.type === 'pass') { holder = e.to; ball = null; }
    else if (e.type === 'pickup') { holder = e.by; ball = null; }
    else { holder = null; ball = pt(e.at[0], e.at[1]); }
  }
  return out;
}

// Who has the ball (or where it lies) after the events already in a step.
export function ballAfter(step, s0) {
  const s = { holder: s0.holder, ball: s0.ball };
  for (const e of step.ball) applyEvent(s, e);
  return s;
}
