// Play Designer: place pieces, then build the play step by step by dragging.
import { createBoard } from './render.js';
import { el, fieldBounds, nearestGoalY } from './field.js';
import { normalizePlay, ballAfter, STICK, DEFAULT_DUR, ensurePhases, compactPhases, phaseCount, routeControls, legMid, LEADS } from './engine.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { h, svgEl, toast, store, CATEGORIES, PREVIEW, download, copyText, uid } from './ui.js';
import { publishFile, checkToken, TOKEN_URL, repoLabel } from './github.js';
import { printBlank } from './print.js';

const OUR_POSITIONS = ['A1', 'A2', 'A3', 'M1', 'M2', 'M3', 'D1', 'D2', 'D3', 'G', 'LSM', 'FO'];

// Formations. Coordinates are yards; our offense attacks the top goal at y = 15.
const FORMATIONS = {
  '3-3': { label: '3-3 (half field)', pieces: { A1: [15, 16], A2: [30, 7.5], A3: [45, 16], M1: [17, 32], M2: [30, 35], M3: [43, 32] } },
  '2-3-1': { label: '2-3-1 (half field)', pieces: { M1: [22, 34], M2: [38, 34], A1: [12, 18], M3: [30, 22], A3: [48, 18], A2: [30, 7.5] } },
  '1-4-1': { label: '1-4-1 (half field)', pieces: { M2: [30, 35], A1: [12, 19], M1: [23, 25], M3: [37, 25], A3: [48, 19], A2: [30, 7.5] } },
  full10: {
    label: 'Full team of 10 (full field)', field: 'full',
    pieces: { G: [30, 94], D1: [15, 86], D2: [30, 82], D3: [45, 86], M1: [15, 55], M2: [30, 58], M3: [45, 55], A1: [15, 25], A2: [30, 20], A3: [45, 25] },
  },
  man: { label: 'Add opponents: man-to-man defense' },
};

function newPlay() {
  const pieces = Object.entries(FORMATIONS['3-3'].pieces).map(([id, [x, y]]) => ({ id, type: 'O', label: id, x, y }));
  return normalizePlay({
    id: uid(), title: 'Untitled play', category: 'Offense', field: 'half', description: '',
    pieces, ball: { holder: 'M2' }, steps: [blankStep()],
  });
}

function blankStep() {
  return { note: '', dur: DEFAULT_DUR, order: 'pass-first', moves: [], ball: [], looks: [] };
}

export function renderDesigner(main, ctx, id) {
  let play;
  if (id && ctx.drafts[id]) play = ctx.drafts[id];
  else if (id) {
    const pub = ctx.published.find((p) => p.id === id);
    play = pub ? structuredClone(pub) : newPlay();
  } else play = newPlay();

  play.steps.forEach(ensurePhases);
  const D = { k: play.steps.length ? 0 : -1, tool: 'move', add: null, kind: 'run', sel: null, drag: null };
  let board = null;
  let saveTimer = 0;

  const svg = svgEl('design-svg');
  const panel = h('div', { class: 'd-panel' });
  const hint = h('p', { class: 'd-hint', role: 'status' });
  const savedNote = h('span', { class: 'saved' }, '');
  const fallback = h('textarea', { class: 'copy-fallback', hidden: true, readonly: true, 'aria-label': 'Play data to copy' });

  // ----- persistence -----
  function save() {
    play.updated = Date.now();
    ctx.drafts[play.id] = play;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { ctx.saveDrafts(); savedNote.textContent = 'Saved on this device · not in the team playbook yet'; }, 250);
    savedNote.textContent = 'Saving…';
  }
  function changed() { if (D.k >= 0 && step()) compactPhases(step()); save(); redraw(); renderPanel(); }

  // ----- geometry -----
  function toField(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const b = fieldBounds(play.field);
    return { x: Math.min(b.x1, Math.max(b.x0, q.x)), y: Math.min(b.y1, Math.max(b.y0, q.y)) };
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const step = () => play.steps[D.k];
  const piece = (pid) => play.pieces.find((p) => p.id === pid);

  // ----- drawing -----
  function redraw() {
    board = createBoard(svg, play, { looksAlways: true });
    board.show(D.k, 0);
    const ov = board.layers.overlay;
    if (D.k >= 0) {
      const s0 = board.states[D.k];
      for (const m of step().moves) {
        const a = s0.pos[m.id];
        if (!a) continue;
        el('circle', { cx: m.to[0], cy: m.to[1], r: 1.1, class: 'h-end', 'data-handle': 'end:' + m.id }, ov);
        // A diamond on every leg adds a bend point there; bend points can be dragged or tapped away.
        const legs = routeControls(a, m).length - 1;
        for (let i = 0; i < legs; i++) {
          const mid = legMid(a, m, i);
          el('rect', { x: mid.x - 0.55, y: mid.y - 0.55, width: 1.1, height: 1.1, transform: `rotate(45 ${mid.x} ${mid.y})`, class: 'h-via', 'data-handle': `ins:${m.id}:${i}` }, ov);
        }
        (m.path || []).forEach(([x, y], i) => el('circle', { cx: x, cy: y, r: 0.75, class: 'h-wp', 'data-handle': `wp:${m.id}:${i}` }, ov));
      }
    }
    if (D.k < 0 && D.sel && board.nodes[D.sel]) board.nodes[D.sel].classList.add('is-selected');
    svg.classList.toggle('tool-active', D.tool !== 'move');
    svg.classList.toggle('setup', D.k < 0);
    setHint();
  }

  function setHint() {
    const t = {
      move: D.k < 0 ? 'Drag pieces to their starting spots. Tap a piece to rename or delete it.'
        : 'Drag a player to where they go. Drag a diamond to bend the route (add as many bends as you like); tap a bend point to remove it.',
      add: `Tap the field to place ${D.add?.label || 'the piece'}.`,
      ball: 'Tap a player or the coach to give them the ball, or tap the field to drop a loose ball.',
      pass: 'Tap the player who receives the pass.',
      gb: 'Tap the spot where the ball ends up on the ground.',
      scoop: 'Tap the player who scoops the ground ball.',
      look: `Looks from ${piece(D.lookFrom)?.label || 'the ball carrier'}: tap a teammate to add a look, or tap the goal for a shot look. Tap again to remove it.`,
    }[D.tool];
    hint.textContent = t;
  }

  // ----- edits -----
  function setTool(t, add) { D.tool = t; D.add = add || null; renderPanel(); setHint(); svg.classList.toggle('tool-active', t !== 'move'); }

  function addPiece(at) {
    const a = D.add;
    let label = a.label;
    if (a.type === 'X' && !label) { let i = 1; while (piece('X' + i)) i++; label = 'X' + i; }
    if (a.type === 'box' && piece('BOX')) { setTool('move'); return toast('This play already has a box.'); }
    let pid = a.type === 'cone' ? 'cone' : a.type === 'coach' ? 'C' : a.type === 'box' ? 'BOX' : label;
    if (piece(pid) || a.type === 'cone') { let i = 1; while (piece(pid + i)) i++; pid = pid + i; }
    play.pieces.push({ id: pid, type: a.type, label: a.type === 'cone' ? '' : a.type === 'coach' ? 'C' : a.type === 'box' ? 'BOX' : label, x: r1(at.x), y: r1(at.y) });
    D.sel = pid;
    setTool('move');
    changed();
  }

  function removePiece(pid) {
    play.pieces = play.pieces.filter((p) => p.id !== pid);
    if (play.ball.holder === pid) play.ball = {};
    for (const s of play.steps) {
      s.moves = s.moves.filter((m) => m.id !== pid);
      s.ball = s.ball.filter((e) => e.from !== pid && e.to !== pid && e.by !== pid);
      s.looks = s.looks.filter((l) => l.from !== pid && l.to !== pid);
    }
    D.sel = null;
    changed();
  }

  function applyFormation(key) {
    const f = FORMATIONS[key];
    if (key === 'man') {
      const goal = { x: 30, y: 15 };
      const ours = play.pieces.filter((p) => p.type === 'O' && p.label !== 'G');
      ours.forEach((o, i) => {
        const dx = goal.x - o.x, dy = goal.y - o.y, L = Math.hypot(dx, dy) || 1;
        const pid = 'X' + (i + 1);
        const pos = { x: r1(o.x + (dx / L) * 2.6), y: r1(o.y + (dy / L) * 2.6) };
        const ex = piece(pid);
        if (ex) Object.assign(ex, pos); else play.pieces.push({ id: pid, type: 'X', label: pid, ...pos });
      });
      if (!piece('XG')) play.pieces.push({ id: 'XG', type: 'X', label: 'G', x: 30, y: 16.8 });
    } else {
      if (f.field && play.field !== f.field) play.field = f.field;
      for (const [pid, [x, y]] of Object.entries(f.pieces)) {
        const ex = piece(pid);
        if (ex) Object.assign(ex, { x, y }); else play.pieces.push({ id: pid, type: 'O', label: pid, x, y });
      }
    }
    changed();
  }

  function setMove(pid, to) {
    const s = step();
    const a = board.states[D.k].pos[pid];
    let m = s.moves.find((mm) => mm.id === pid);
    if (Math.hypot(to.x - a.x, to.y - a.y) < 0.8) {
      s.moves = s.moves.filter((mm) => mm.id !== pid);
      return;
    }
    if (!m) { m = { id: pid, kind: D.kind, to: [0, 0], seq: lastPhase() }; s.moves.push(m); }
    m.to = [r1(to.x), r1(to.y)];
  }

  // New actions join the step's latest phase; reorder them in the panel.
  const lastPhase = () => { const s = step(); return s.moves.length || s.ball.length ? phaseCount(s) - 1 : 0; };

  function ballNow() { return ballAfter(step(), board.states[D.k]); }
  function hasPickup() { return step().ball.some((e) => e.type === 'pickup'); }

  function addPass(to) {
    if (hasPickup()) return toast('Put the next pass in a new step, after the scoop.');
    const b = ballNow();
    if (!b.holder) return toast('Nobody has the ball at this point. Use Scoop first, or give someone the ball in Setup.');
    if (b.holder === to) return toast(`${piece(to)?.label} already has the ball.`);
    step().ball.push({ type: 'pass', from: b.holder, to, seq: lastPhase() });
    changed();
  }

  function addShot() {
    if (hasPickup()) return toast('Put the shot in a new step, after the scoop.');
    const b = ballNow();
    if (!b.holder) return toast('Nobody has the ball at this point, so there is no one to shoot.');
    const s0 = board.states[D.k];
    const m = step().moves.find((mm) => mm.id === b.holder);
    const y = m ? m.to[1] : s0.pos[b.holder].y;
    const gy = nearestGoalY(play.field, y);
    const x = (m ? m.to[0] : s0.pos[b.holder].x) < 30 ? 30.7 : 29.3; // aim for the far pipe
    step().ball.push({ type: 'shot', from: b.holder, at: [x, gy], seq: lastPhase() });
    changed();
  }

  function addRoll(at) {
    if (hasPickup()) return toast('Start a new step for the next ground ball.');
    const b = ballNow();
    if (!b.holder && !b.ball) return toast('There is no ball yet. In Setup, give the ball to a player or the coach.');
    const e = { type: 'roll', at: [r1(at.x), r1(at.y)], seq: lastPhase() };
    if (b.holder) e.from = b.holder;
    step().ball.push(e);
    setTool('move');
    changed();
  }

  function addScoop(by) {
    const b = ballNow();
    if (b.holder || !b.ball) return toast('There is no loose ball to scoop. Add a ground ball first.');
    const s = step();
    const seq = lastPhase();
    if (!s.moves.some((m) => m.id === by)) {
      s.moves.push({ id: by, kind: 'run', to: [r1(b.ball.x - STICK.x), r1(b.ball.y - STICK.y)], seq });
    }
    s.ball.push({ type: 'pickup', by, seq });
    setTool('move');
    changed();
  }

  // Looks: passing options shown at the end of the step. They never move the ball.
  function startLook() {
    if (D.tool === 'look') return setTool('move');
    const s = step();
    D.lookFrom = s.looks.at(-1)?.from || ballAfter(s, board.states[D.k]).holder || null;
    if (!D.lookFrom) {
      // After a shot nobody holds the ball, so default to the shooter.
      D.lookFrom = [...s.ball].reverse().find((e) => e.type === 'shot')?.from || null;
    }
    setTool('look');
  }

  function toggleLook(pid, at) {
    const s = step();
    const end = board.states[D.k + 1];
    let to = pid;
    if (!to) {
      const goals = play.field === 'full' ? [15, 95] : [15];
      if (goals.some((gy) => Math.hypot(at.x - 30, at.y - gy) < 4.5)) to = 'goal';
    }
    if (!to) return;
    if (!D.lookFrom) return toast('Pick the player who is looking first.');
    if (to === D.lookFrom) return;
    if (to !== 'goal' && !end.pos[to]) return;
    const i = s.looks.findIndex((l) => l.from === D.lookFrom && l.to === to);
    if (i >= 0) s.looks.splice(i, 1); else s.looks.push({ from: D.lookFrom, to });
    changed();
  }

  // ----- pointer handling -----
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const at = toField(ev);
    const handle = ev.target.closest('[data-handle]');
    const pc = ev.target.closest('.piece');
    let pid = pc?.getAttribute('data-id');
    // The box is placed in Setup only: it never moves, passes or looks.
    if (pid && piece(pid)?.type === 'box' && !(D.k < 0 && (D.tool === 'move' || D.tool === 'add'))) {
      if (D.k >= 0 && D.tool === 'move') return toast('The box stays put. Move it in Setup.');
      pid = undefined;
    }

    if (handle && D.tool === 'move') {
      const [kind, hid, i] = handle.getAttribute('data-handle').split(':');
      D.drag = { kind, id: hid, i: +i, start: at, moved: false };
    } else if (D.tool === 'add') {
      return addPiece(at);
    } else if (D.tool === 'ball') {
      play.ball = pid ? { holder: pid } : { at: [r1(at.x), r1(at.y)] };
      setTool('move');
      return changed();
    } else if (D.tool === 'pass') {
      if (pid) addPass(pid);
      return;
    } else if (D.tool === 'gb') {
      return addRoll(at);
    } else if (D.tool === 'look') {
      return toggleLook(pid, at);
    } else if (D.tool === 'scoop') {
      if (pid) addScoop(pid);
      return;
    } else if (pid) {
      D.drag = { kind: D.k < 0 ? 'setup' : 'piece', id: pid, start: at, moved: false };
    } else {
      if (D.sel) { D.sel = null; redraw(); renderPanel(); }
      return;
    }
    svg.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  svg.addEventListener('pointermove', (ev) => {
    const d = D.drag;
    if (!d) return;
    const at = toField(ev);
    if (!d.moved && Math.hypot(at.x - d.start.x, at.y - d.start.y) < 0.5) return;
    d.moved = true;
    if (d.kind === 'setup') {
      const p = piece(d.id);
      p.x = r1(at.x); p.y = r1(at.y);
    } else if (d.kind === 'piece' || d.kind === 'end') {
      setMove(d.id, at);
    } else if (d.kind === 'ins' || d.kind === 'wp') {
      const m = step().moves.find((mm) => mm.id === d.id);
      if (m) {
        m.path = m.path || [];
        if (d.kind === 'ins') { m.path.splice(d.i, 0, [0, 0]); d.kind = 'wp'; }
        m.path[d.i] = [r1(at.x), r1(at.y)];
      }
    }
    redraw();
  });

  const endDrag = () => {
    const d = D.drag;
    D.drag = null;
    if (!d) return;
    if (!d.moved) {
      if (d.kind === 'setup' || d.kind === 'piece') { D.sel = d.id; redraw(); renderPanel(); }
      if (d.kind === 'wp') {
        const m = step().moves.find((mm) => mm.id === d.id);
        if (m?.path) { m.path.splice(d.i, 1); if (!m.path.length) delete m.path; changed(); }
      }
      return;
    }
    changed();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  function onKey(e) {
    if (e.target.closest('input,select,textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && D.k < 0 && D.sel) { e.preventDefault(); removePiece(D.sel); }
    if (e.key === 'Escape') { setTool('move'); }
  }
  document.addEventListener('keydown', onKey);

  // ----- panel -----
  const seg = (items, cur, onPick) => h('div', { class: 'seg', role: 'group' },
    items.map(([v, label]) => h('button', { class: v === cur ? 'on' : '', 'aria-pressed': String(v === cur), onclick: () => onPick(v) }, label)));

  function describe(e) {
    const L = (x) => piece(x)?.label || x;
    if (e.type === 'pass') return `Pass ${L(e.from)} → ${L(e.to)}`;
    if (e.type === 'shot') return `Shot by ${L(e.from)}`;
    if (e.type === 'roll') return e.from ? `${L(e.from)} rolls a ground ball` : 'Ball rolls loose';
    return `${L(e.by)} scoops it`;
  }

  function stepTabs() {
    return h('div', { class: 'step-tabs', role: 'tablist', 'aria-label': 'Steps' },
      h('button', { role: 'tab', class: D.k < 0 ? 'on' : '', 'aria-selected': String(D.k < 0), onclick() { D.k = -1; setTool('move'); redraw(); } }, 'Setup'),
      play.steps.map((_, i) => h('button', { role: 'tab', class: D.k === i ? 'on' : '', 'aria-selected': String(D.k === i), onclick() { D.k = i; D.sel = null; setTool('move'); redraw(); } }, String(i + 1))),
      h('button', { class: 'add-step', onclick() { play.steps.splice(D.k + 1, 0, blankStep()); D.k = D.k + 1; setTool('move'); changed(); } }, '+ Step'));
  }

  function setupPanel() {
    const sel = D.sel && piece(D.sel);
    const formation = h('select', { id: 'formation', 'aria-label': 'Formation' },
      Object.entries(FORMATIONS).map(([k2, f]) => h('option', { value: k2 }, f.label)));
    const holder = play.ball.holder ? piece(play.ball.holder)?.label : null;
    return [
      h('h3', {}, 'Setup'),
      h('div', { class: 'row' }, formation, h('button', { class: 'btn btn-quiet', onclick: () => applyFormation(formation.value) }, 'Apply')),
      h('p', { class: 'label' }, 'Hawks (black)'),
      h('div', { class: 'pal' }, OUR_POSITIONS.map((p) => h('button', {
        class: 'pal-btn pal-o' + (D.tool === 'add' && D.add?.label === p ? ' on' : ''), disabled: !!piece(p),
        onclick: () => setTool('add', { type: 'O', label: p }),
      }, p))),
      h('p', { class: 'label' }, 'Opponents (red) and drill gear'),
      h('div', { class: 'pal' },
        h('button', { class: 'pal-btn pal-x' + (D.tool === 'add' && D.add?.type === 'X' ? ' on' : ''), onclick: () => setTool('add', { type: 'X', label: '' }) }, '+ Opponent'),
        h('button', { class: 'pal-btn' + (D.tool === 'add' && D.add?.type === 'cone' ? ' on' : ''), onclick: () => setTool('add', { type: 'cone', label: 'cone' }) }, '+ Cone'),
        h('button', { class: 'pal-btn' + (D.tool === 'add' && D.add?.type === 'coach' ? ' on' : ''), onclick: () => setTool('add', { type: 'coach', label: 'the coach' }) }, '+ Coach'),
        h('button', { class: 'pal-btn pal-box' + (D.tool === 'add' && D.add?.type === 'box' ? ' on' : ''), disabled: !!piece('BOX'), onclick: () => setTool('add', { type: 'box', label: 'the box' }) }, '+ Box')),
      h('p', { class: 'label' }, 'Ball'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-quiet' + (D.tool === 'ball' ? ' on' : ''), onclick: () => setTool(D.tool === 'ball' ? 'move' : 'ball') }, 'Place ball'),
        h('span', { class: 'muted' }, holder ? `Starts with ${holder}` : play.ball.at ? 'Loose ball on the field' : 'No ball yet')),
      sel ? h('div', { class: 'sel-box' },
        h('p', { class: 'label' }, 'Selected piece'),
        sel.type === 'cone' ? h('p', {}, 'Cone') : h('input', {
          id: 'sel-label', value: sel.label, maxlength: 4, 'aria-label': 'Label',
          oninput(e) { sel.label = e.target.value.toUpperCase(); save(); redraw(); },
        }),
        h('button', { class: 'btn btn-danger', onclick: () => removePiece(sel.id) }, 'Delete piece')) : null,
    ];
  }

  // Moving an action to an earlier or later phase. Phase 0 is the start of the step.
  function shiftPhase(s, x, dir) {
    const all = [...s.moves, ...s.ball];
    if (dir < 0) {
      if (x.seq > 0) x.seq -= 1;
      else if (all.some((y) => y !== x && y.seq === 0)) {
        for (const y of all) if (y !== x) y.seq += 1;
        if (s.lead) s.lead = [null, ...s.lead];
      }
    } else if (all.some((y) => y !== x && y.seq >= x.seq)) {
      x.seq += 1;
    }
    compactPhases(s);
    changed();
  }

  function actionRow(s, x, isMove) {
    const rm = () => { if (isMove) s.moves = s.moves.filter((y) => y !== x); else s.ball = s.ball.filter((y) => y !== x); compactPhases(s); changed(); };
    const label = isMove ? h('span', {}, piece(x.id)?.label || x.id) : h('span', {}, describe(x));
    const extras = isMove ? [
      h('select', { 'aria-label': 'Movement type', onchange(e) { x.kind = e.target.value; changed(); } },
        [['run', 'Run / cut'], ['dodge', 'Dodge'], ['pick', 'Pick']].map(([v, l]) => h('option', { value: v, selected: x.kind === v }, l))),
      x.path?.length ? h('select', { 'aria-label': 'Route shape', onchange(e) { x.sharp = e.target.value === 'sharp'; if (!x.sharp) delete x.sharp; changed(); } },
        h('option', { value: 'curve', selected: !x.sharp }, 'Curved'),
        h('option', { value: 'sharp', selected: !!x.sharp }, 'Sharp corners')) : null,
      x.path?.length ? h('button', { class: 'linkish', onclick() { delete x.path; delete x.sharp; changed(); } }, 'Straighten') : null,
    ] : [];
    return h('li', {
      draggable: 'true',
      ondragstart(e) { D.dragItem = x; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'action'); e.currentTarget.classList.add('dragging'); },
      ondragend(e) { e.currentTarget.classList.remove('dragging'); },
    },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠿'),
      label, ...extras,
      h('span', { class: 'order-btns' },
        h('button', { class: 'x', title: 'Happen earlier', 'aria-label': 'Move to an earlier phase', onclick: () => shiftPhase(s, x, -1) }, '▲'),
        h('button', { class: 'x', title: 'Happen later', 'aria-label': 'Move to a later phase', onclick: () => shiftPhase(s, x, 1) }, '▼'),
        h('button', { class: 'x', 'aria-label': 'Remove', onclick: rm }, '✕')));
  }

  function phaseList(s) {
    if (!s.moves.length && !s.ball.length) return h('p', { class: 'muted' }, 'Nothing yet. Drag a player to start.');
    const n = phaseCount(s);
    const dropZone = (w, cls, ...kids) => h('div', {
      class: cls,
      ondragover(e) { if (D.dragItem) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
      ondragleave(e) { e.currentTarget.classList.remove('over'); },
      ondrop(e) {
        e.preventDefault();
        const x = D.dragItem; D.dragItem = null;
        if (!x) return;
        x.seq = w; compactPhases(s); changed();
      },
    }, ...kids);
    const groups = [];
    for (let w = 0; w < n; w++) {
      const rows = [
        ...s.ball.filter((e) => e.seq === w).map((e) => actionRow(s, e, false)),
        ...s.moves.filter((m) => m.seq === w).map((m) => actionRow(s, m, true)),
      ];
      groups.push(dropZone(w, 'phase',
        h('div', { class: 'phase-head' }, h('b', {}, `Phase ${w + 1}`),
          w === 0 ? h('span', {}, 'starts the step') : h('label', {}, 'starts ',
            h('select', {
              'aria-label': `When phase ${w + 1} starts`,
              onchange(e) { s.lead = s.lead || []; s.lead[w] = +e.target.value; compactPhases(s); changed(); },
            }, LEADS.map(([v, l]) => h('option', { value: v, selected: (s.lead?.[w] ?? 1) === v }, l.replace('{n}', w)))))),
        h('ul', { class: 'actions' }, rows)));
    }
    groups.push(dropZone(n, 'phase phase-new', 'Drop here to make it happen after everything else'));
    return h('div', { class: 'phases' }, groups);
  }

  function stepPanel() {
    const s = step();
    const note = h('textarea', { id: 'note', rows: 4, placeholder: 'What should players read or say on this step?', oninput(e) { s.note = e.target.value; save(); } });
    note.value = s.note;
    const durLabel = h('label', { class: 'label', for: 'dur' }, `Speed: ${s.dur.toFixed(1)} seconds per phase`);
    return [
      h('h3', {}, `Step ${D.k + 1} of ${play.steps.length}`),
      h('p', { class: 'label' }, 'Next drag draws a'),
      seg([['run', 'Run / cut'], ['dodge', 'Dodge'], ['pick', 'Pick']], D.kind, (v) => { D.kind = v; renderPanel(); }),
      h('p', { class: 'label' }, 'Ball'),
      h('div', { class: 'pal' },
        h('button', { class: 'pal-btn' + (D.tool === 'pass' ? ' on' : ''), onclick: () => setTool(D.tool === 'pass' ? 'move' : 'pass') }, 'Pass'),
        h('button', { class: 'pal-btn' + (D.tool === 'gb' ? ' on' : ''), onclick: () => setTool(D.tool === 'gb' ? 'move' : 'gb') }, 'Ground ball'),
        h('button', { class: 'pal-btn' + (D.tool === 'scoop' ? ' on' : ''), onclick: () => setTool(D.tool === 'scoop' ? 'move' : 'scoop') }, 'Scoop'),
        h('button', { class: 'pal-btn', onclick: addShot }, 'Shot'),
        h('button', { class: 'pal-btn pal-look' + (D.tool === 'look' ? ' on' : ''), onclick: startLook }, 'Look')),
      D.tool === 'look' ? h('label', { class: 'row look-from' }, 'Looking player',
        h('select', { 'aria-label': 'Looking player', onchange(e) { D.lookFrom = e.target.value; setHint(); } },
          play.pieces.filter((p) => p.type === 'O' || p.type === 'X').map((p) => h('option', { value: p.id, selected: p.id === D.lookFrom }, p.label)))) : null,
      h('label', { class: 'label', for: 'note' }, 'Coaching note'),
      note,
      h('p', { class: 'label' }, 'Who moves when'),
      h('p', { class: 'muted small' }, 'Actions in the same phase happen together. Drag an action to another phase, or use ▲ ▼. Each later phase can start when the one before ends, halfway through it, or just after it begins.'),
      phaseList(s),
      s.looks.length ? [
        h('p', { class: 'label' }, 'Looks at the end of this step'),
        h('ul', { class: 'actions' }, s.looks.map((l) => h('li', {},
          h('span', {}, `${piece(l.from)?.label || l.from} looks ${l.to === 'goal' ? 'to shoot' : 'to ' + (piece(l.to)?.label || l.to)}`),
          h('button', { class: 'x', 'aria-label': 'Remove look', onclick() { s.looks = s.looks.filter((x) => x !== l); changed(); } }, '✕')))),
      ] : null,
      durLabel,
      h('input', { id: 'dur', type: 'range', min: 0.8, max: 4, step: 0.1, value: s.dur, oninput(e) { s.dur = +e.target.value; durLabel.textContent = `Speed: ${s.dur.toFixed(1)} seconds per phase`; save(); } }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-quiet', onclick() { const c = blankStep(); c.dur = s.dur; play.steps.splice(D.k + 1, 0, c); D.k++; changed(); } }, 'Add step after'),
        h('button', { class: 'btn btn-danger', onclick() { play.steps.splice(D.k, 1); D.k = Math.min(D.k, play.steps.length - 1); changed(); } }, 'Delete step')),
    ];
  }

  function renderPanel() {
    panel.replaceChildren(stepTabs(), h('div', { class: 'd-body' }, D.k < 0 ? setupPanel() : stepPanel()));
  }

  // ----- export / import -----
  const plain = () => JSON.stringify(play, null, 1);
  async function exportTeam() {
    const box = await encryptJSON(ctx.key, play);
    download(`${play.id}.enc.json`, JSON.stringify(box));
    toast('Team file downloaded. Upload it to the plays folder on GitHub.');
  }
  async function importFile(file) {
    try {
      let data = JSON.parse(await file.text());
      if (data.ct && data.iv) data = await decryptJSON(ctx.key, data);
      if (!data.pieces || !data.steps) throw new Error('not a play');
      data.id = data.id || uid();
      ctx.drafts[data.id] = normalizePlay(data);
      ctx.saveDrafts();
      ctx.go('#design-' + data.id);
      toast(`Imported "${data.title}".`);
    } catch {
      toast('That file is not a Hawks play, or it was locked with a different password.');
    }
  }
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange(e) { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; } });

  // ----- save to the team playbook (GitHub) -----
  const TOKEN_KEY = 'hawks.ghToken';
  async function loadToken() {
    const box = store.get(TOKEN_KEY, null);
    if (!box) return null;
    try { return await decryptJSON(ctx.key, box); } catch { return null; }
  }
  async function keepToken(token) { store.set(TOKEN_KEY, await encryptJSON(ctx.key, token)); }

  const saveBtn = h('button', { class: 'btn btn-primary', onclick: () => publish() }, 'Save to playbook');

  async function publish(token) {
    if (PREVIEW) return toast('Saving to the playbook works on the team site. Use Share & files → Copy play data here.');
    token = token || await loadToken();
    if (!token) return openKeyDialog();
    clearTimeout(saveTimer);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const copy = structuredClone(play);
      delete copy.updated;
      const box = await encryptJSON(ctx.key, copy);
      const result = await publishFile(token, `${play.id}.enc.json`, JSON.stringify(box) + '\n');
      const i = ctx.published.findIndex((p) => p.id === play.id);
      if (i >= 0) ctx.published[i] = structuredClone(copy); else ctx.published.push(structuredClone(copy));
      delete ctx.drafts[play.id];
      ctx.saveDrafts();
      savedNote.textContent = 'Saved to the team playbook';
      toast(result === 'created'
        ? 'Added to the team playbook. Players will see it in a minute or two.'
        : 'Team playbook updated. Players will see the change in a minute or two.');
    } catch (e) {
      console.error(e);
      if (e.status === 401) {
        store.del(TOKEN_KEY);
        toast('GitHub did not accept the saved key (it may have expired). Add a new one and try again.');
        openKeyDialog();
      } else if (e.status === 403 || e.status === 404) {
        toast(`The GitHub key can't write to ${repoLabel}. Check it has Contents: Read and write for that repository.`);
        openKeyDialog();
      } else {
        toast('Could not reach GitHub. Your play is still saved on this device; try again in a moment.');
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save to playbook';
    }
  }

  function openKeyDialog() {
    const input = h('input', { id: 'gh-token', type: 'password', autocomplete: 'off', placeholder: 'github_pat_…', required: true });
    const err = h('p', { class: 'lock-err', role: 'alert' });
    const go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save key and publish');
    const close = () => overlay.remove();
    const overlay = h('div', { class: 'modal-wrap', onclick(e) { if (e.target === overlay) close(); } },
      h('form', {
        class: 'modal',
        async onsubmit(e) {
          e.preventDefault();
          const token = input.value.trim();
          go.disabled = true; go.textContent = 'Checking…'; err.textContent = '';
          try {
            await checkToken(token);
            await keepToken(token);
            close();
            publish(token);
          } catch (ex) {
            err.textContent = ex.status === 401
              ? 'GitHub did not accept that key. Copy it again and paste the whole thing.'
              : ex.status === 404 ? `That key can't see ${repoLabel}. Make sure you picked that repository.`
              : 'Could not reach GitHub. Check your connection and try again.';
            go.disabled = false; go.textContent = 'Save key and publish';
          }
        },
      },
        h('h2', {}, 'Connect this device to GitHub'),
        h('p', { class: 'muted' }, `Saving commits the play to ${repoLabel}. Do this once on each device you coach from.`),
        h('ol', { class: 'steps' },
          h('li', {}, 'Open ', h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'GitHub → new fine-grained token'), ' while signed in as the repo owner.'),
          h('li', {}, 'Name it "Hawks playbook", pick an expiration (end of season works).'),
          h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ` → ${repoLabel}.`),
          h('li', {}, 'Permissions → Repository permissions → ', h('b', {}, 'Contents: Read and write'), '.'),
          h('li', {}, 'Generate the token, copy it, and paste it below.')),
        h('label', { for: 'gh-token', class: 'label' }, 'GitHub key'),
        input,
        h('p', { class: 'muted small' }, 'The key stays on this device, locked with the team password. It is never put in the repo.'),
        err,
        h('div', { class: 'row' }, go, h('button', { class: 'btn btn-quiet', type: 'button', onclick: close }, 'Cancel'))));
    document.body.append(overlay);
    input.focus();
  }

  let armDelete = false;
  const delBtn = h('button', {
    class: 'btn btn-danger',
    onclick() {
      if (!armDelete) { armDelete = true; delBtn.textContent = 'Tap again to delete'; setTimeout(() => { armDelete = false; delBtn.textContent = 'Delete draft'; }, 3000); return; }
      delete ctx.drafts[play.id]; ctx.saveDrafts(); toast('Draft deleted.'); ctx.go('#');
    },
  }, 'Delete draft');

  // ----- layout -----
  const title = h('input', { id: 'title', class: 'd-title', value: play.title, 'aria-label': 'Play name', oninput(e) { play.title = e.target.value || 'Untitled play'; save(); } });
  const desc = h('input', { id: 'desc', value: play.description || '', placeholder: 'One-line summary for players (optional)', 'aria-label': 'Summary', oninput(e) { play.description = e.target.value; save(); } });
  const cat = h('select', { id: 'cat', 'aria-label': 'Category', onchange(e) { play.category = e.target.value; save(); } },
    CATEGORIES.map((c) => h('option', { value: c, selected: c === play.category }, c)));
  const fieldSel = h('select', { id: 'fieldsel', 'aria-label': 'Field', onchange(e) { play.field = e.target.value; changed(); } },
    h('option', { value: 'half', selected: play.field === 'half' }, 'Half field'),
    h('option', { value: 'full', selected: play.field === 'full' }, 'Full field'));

  main.append(
    h('section', { class: 'd-head' },
      h('div', { class: 'd-meta' }, title, desc, h('div', { class: 'row' }, cat, fieldSel, savedNote)),
      h('div', { class: 'd-actions' },
        saveBtn,
        h('button', { class: 'btn btn-quiet', onclick() { save(); ctx.saveDrafts(); ctx.go('#draft-' + play.id); } }, '▶ Preview'),
        h('details', { class: 'menu' },
          h('summary', { class: 'btn btn-quiet' }, 'Share & files'),
          h('div', { class: 'menu-body' },
            h('button', { onclick: async () => { toast(await copyText(plain(), fallback) ? 'Play data copied. Paste it to Claude to edit or publish.' : 'Select the text below and copy it.'); } }, 'Copy play data (send to Claude)'),
            PREVIEW ? h('p', { class: 'muted' }, 'File downloads and printing work on the team site.') : [
              h('button', { onclick: exportTeam }, 'Download team file (.enc.json)'),
              h('button', { onclick: () => download(`${play.id}.json`, plain()) }, 'Download editable file (.json)'),
              h('button', { onclick: () => fileIn.click() }, 'Import a play file'),
              h('button', { onclick: () => printBlank(play.field) }, `Print blank ${play.field} field for sketching`),
              h('button', { onclick() { store.del(TOKEN_KEY); toast('GitHub key removed from this device.'); } }, 'Forget GitHub key on this device'),
            ],
            fallback)),
        delBtn, fileIn)),
    h('div', { class: 'designer ' + play.field },
      h('div', { class: 'd-board' }, svg, hint),
      panel));

  redraw();
  renderPanel();
  save();
  return () => { document.removeEventListener('keydown', onKey); ctx.saveDrafts(); };
}
