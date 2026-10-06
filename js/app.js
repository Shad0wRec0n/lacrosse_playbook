// Hawks Playbook: password gate, playbook list, animated play viewer, routing.
import { deriveKey, decryptJSON, CHECK_TEXT } from './crypto.js';
import { createBoard } from './render.js';
import { normalizePlay, stepSeconds } from './engine.js';
import { $, h, svgEl, toast, store, CATEGORIES, PREVIEW, ICON } from './ui.js';
import { renderDesigner } from './designer.js';
import { printPlay } from './print.js';

const PW_KEY = 'hawks.pw';
const DRAFTS_KEY = 'hawks.drafts';

const ctx = {
  key: null,
  role: null,
  keyinfo: null,
  published: [],
  drafts: {},
  saveDrafts() { store.set(DRAFTS_KEY, ctx.drafts); },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
};

const app = $('#app');
let teardown = null;

async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// ---------- unlock ----------
// Players unlock with the team password. Coaches use their own password, which opens a
// sealed copy of the team password stored in keyinfo.json, so they can read and publish plays.
async function tryUnlock(role, pw) {
  ctx.keyinfo = ctx.keyinfo || await fetchJSON('plays/keyinfo.json');
  const info = ctx.keyinfo;
  let teamPw = pw;
  if (role === 'coach') {
    if (!info.coach) return false;
    try {
      const coachKey = await deriveKey(pw, info.coach.salt, info.iter);
      teamPw = await decryptJSON(coachKey, info.coach.box);
    } catch {
      return false;
    }
  }
  const key = await deriveKey(teamPw, info.salt, info.iter);
  try {
    if ((await decryptJSON(key, info.check)) !== CHECK_TEXT) return false;
  } catch {
    return false;
  }
  ctx.key = key;
  ctx.role = role;
  return true;
}

const isCoach = () => ctx.role === 'coach';

async function loadPlays() {
  const idx = await fetchJSON('plays/index.json').catch(() => ({ files: [] }));
  const plays = await Promise.all(idx.files.map(async (f) => {
    try { return normalizePlay(await decryptJSON(ctx.key, await fetchJSON('plays/' + f))); }
    catch (e) { console.warn('Could not open', f, e); return null; }
  }));
  ctx.published = plays.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  ctx.drafts = store.get(DRAFTS_KEY, {});
  for (const id in ctx.drafts) normalizePlay(ctx.drafts[id]);
}

function renderLock(msg) {
  app.className = 'lock-screen';
  let role = store.get('hawks.role', 'player');
  const pw = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
  const roleBtns = ['player', 'coach'].map((r) => h('button', {
    type: 'button', 'data-role': r,
    onclick() { role = r; store.set('hawks.role', r); syncRole(); pw.focus(); },
  }, r === 'player' ? 'Player' : 'Coach'));
  function syncRole() {
    for (const b of roleBtns) {
      const on = b.dataset.role === role;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    pw.placeholder = role === 'coach' ? 'Coach password' : 'Team password';
  }
  const remember = h('input', { id: 'remember', type: 'checkbox', checked: true });
  const err = h('p', { class: 'lock-err', role: 'alert' }, msg || '');
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Unlock playbook');
  const form = h('form', {
    class: 'lock-card',
    async onsubmit(e) {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
      try {
        if (await tryUnlock(role, pw.value)) {
          if (remember.checked) store.set(PW_KEY, { role, pw: pw.value }); else store.del(PW_KEY);
          await loadPlays();
          route();
          return;
        }
        err.textContent = role === 'coach'
          ? "That isn't the coach password. Players should choose Player."
          : "That password didn't work. Ask Coach for the team password.";
      } catch (ex) {
        err.textContent = 'Could not reach the playbook files. Check your connection and try again.';
        console.error(ex);
      }
      btn.disabled = false; btn.textContent = 'Unlock playbook';
    },
  },
    h('img', { src: 'assets/logo-outline.png', alt: 'Annapolis Hawks', class: 'lock-logo' }),
    h('h1', { class: 'lock-title' }, 'Playbook'),
    h('div', { class: 'role-pick', role: 'group', 'aria-label': 'I am a' }, h('span', {}, 'I am a'), h('div', { class: 'seg' }, roleBtns)),
    h('label', { for: 'pw', class: 'sr-only' }, 'Password'),
    pw,
    h('label', { class: 'check' }, remember, ' Remember on this device'),
    btn, err);
  app.replaceChildren(form);
  syncRole();
  pw.focus();
}

function lock() {
  store.del(PW_KEY);
  ctx.key = null;
  ctx.role = null;
  location.hash = '';
  renderLock();
}

// ---------- shell ----------
function shell(active, ...content) {
  app.className = 'shell';
  const nav = h('header', { class: 'topbar' },
    h('a', { href: '#', class: 'brand' }, h('img', { src: 'assets/logo-outline.png', alt: '' }),
      h('span', {}, 'PLAYBOOK')),
    h('nav', {},
      h('a', { href: '#', class: active === 'home' ? 'on' : '' }, 'Plays'),
      isCoach() ? h('a', { href: '#design', class: active === 'design' ? 'on' : '' }, 'Designer') : null,
      h('span', { class: 'role-badge' }, isCoach() ? 'Coach' : 'Player'),
      h('button', { class: 'linkish', onclick: lock, title: 'Sign out on this device' }, 'Sign out')));
  const main = h('main', { class: 'main' }, ...content);
  app.replaceChildren(nav, main);
  return main;
}

function chip(text, cls = '') { return h('span', { class: 'chip ' + cls }, text); }

function thumb(play) {
  const svg = svgEl('thumb');
  createBoard(svg, play, { watermark: false }).show(play.steps.length ? 0 : -1, 0);
  return svg;
}

// ---------- home ----------
function renderHome() {
  let q = '';
  let cat = store.get('hawks.cat', 'All');
  const grid = h('div', { class: 'cards' });
  const draftGrid = h('div', { class: 'cards' });
  const chipsRow = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by category' });
  const used = ['All', ...CATEGORIES.filter((c) => ctx.published.some((p) => p.category === c))];

  function card(play, draft) {
    const href = (draft ? '#draft-' : '#play-') + play.id;
    return h('a', { href, class: 'card' }, thumb(play),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-chips' }, chip(play.category || 'Offense'), chip(play.field === 'full' ? 'Full' : 'Half', 'chip-quiet'),
          draft ? chip('Draft', 'chip-draft') : null),
        h('h3', {}, play.title),
        h('p', { class: 'meta' }, `${play.steps.length} step${play.steps.length === 1 ? '' : 's'}`)));
  }

  function fill() {
    chipsRow.replaceChildren(...used.map((c) => h('button', {
      class: 'filter' + (c === cat ? ' on' : ''), 'aria-pressed': String(c === cat),
      onclick() { cat = c; store.set('hawks.cat', c); fill(); },
    }, c)));
    const match = (p) => (cat === 'All' || p.category === cat) &&
      (!q || (p.title + ' ' + (p.description || '')).toLowerCase().includes(q));
    const list = ctx.published.filter(match);
    grid.replaceChildren(...(list.length ? list.map((p) => card(p, false))
      : [h('p', { class: 'empty' }, ctx.published.length ? 'No plays match that search.' : isCoach() ? 'No plays published yet. Build one in the Designer.' : 'No plays published yet. Check back after Coach adds some.')]));
    const drafts = Object.values(ctx.drafts).filter(match).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    draftGrid.replaceChildren(...drafts.map((p) => card(p, true)));
    draftSec.hidden = !drafts.length || !isCoach();
  }

  const draftSec = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', {}, 'Drafts on this device'),
      h('p', { class: 'muted' }, 'Only you can see these until you publish them to the team site.')),
    draftGrid);

  const nPlays = ctx.published.filter((p) => p.category !== 'Drills').length;
  const nDrills = ctx.published.length - nPlays;
  shell('home',
    h('section', { class: 'hero' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Annapolis Hawks · Middle School'),
        h('h1', {}, 'Team Playbook'),
        h('p', { class: 'muted' }, `${nPlays} play${nPlays === 1 ? '' : 's'} · ${nDrills} drill${nDrills === 1 ? '' : 's'}. Tap one to watch it run, then step through it at your own pace.`)),
      isCoach() ? h('a', { href: '#design', class: 'btn' }, '+ New play') : null),
    h('div', { class: 'toolbar' },
      h('input', { id: 'search', type: 'search', placeholder: 'Search plays', 'aria-label': 'Search plays', oninput(e) { q = e.target.value.trim().toLowerCase(); fill(); } }),
      chipsRow),
    h('section', { class: 'sec' }, grid),
    draftSec);
  fill();
}

// ---------- viewer ----------
function renderViewer(play, isDraft) {
  const n = play.steps.length;
  const svg = svgEl('stage-svg');
  let speed = store.get('hawks.speed', 1);
  let loop = store.get('hawks.loop', false);
  let trails = store.get('hawks.trails', true);
  let k = 0, u = 0, playing = false, hold = 0, last = 0, raf = 0, ended = false;

  const board = createBoard(svg, play, { trails });

  const playBtn = h('button', { class: 'ctl ctl-main', 'aria-label': 'Play', html: ICON.play, onclick: toggle });
  const readout = h('span', { class: 'readout' });
  const scrub = h('input', { id: 'scrub', type: 'range', min: 0, max: Math.max(1, n) * 100, value: 0, 'aria-label': 'Play timeline',
    oninput(e) { pause(); const v = +e.target.value; if (v >= n * 100) { k = n - 1; u = 1; } else { k = Math.floor(v / 100); u = v / 100 - k; } draw(); } });

  const noteItems = play.steps.map((s, i) => h('li', {},
    h('button', { class: 'note', onclick() { pause(); k = i; u = 0; draw(); } },
      h('span', { class: 'note-num' }, String(i + 1)),
      h('span', { class: 'note-text' }, s.note || 'No note for this step.'))));
  const notes = h('ol', { class: 'notes' }, noteItems);

  const pieces = play.pieces.filter((p) => p.type === 'O' || p.type === 'X');
  const follow = h('select', { id: 'follow', 'aria-label': 'Follow a position',
    onchange(e) { board.setFocus(e.target.value); } },
    h('option', { value: '' }, 'Everyone'),
    pieces.map((p) => h('option', { value: p.id }, (p.type === 'X' ? 'Opponent ' : '') + p.label)));

  const speedSel = h('select', { id: 'speed', 'aria-label': 'Speed',
    onchange(e) { speed = +e.target.value; store.set('hawks.speed', speed); } },
    [0.5, 0.75, 1, 1.5, 2].map((s) => h('option', { value: s, selected: s === speed }, s + '×')));

  const toggleBtn = (label, get, set) => {
    const b = h('button', { class: 'toggle', 'aria-pressed': String(get()), onclick() { set(!get()); b.setAttribute('aria-pressed', String(get())); } }, label);
    return b;
  };

  function draw() {
    board.show(k, u);
    readout.textContent = n ? `Step ${k + 1} of ${n}` : 'No steps yet';
    scrub.value = Math.round((k + u) * 100);
    noteItems.forEach((li, i) => li.classList.toggle('on', i === k));
    const on = noteItems[k];
    if (on && notes.scrollHeight > notes.clientHeight) {
      const top = on.offsetTop - notes.offsetTop;
      if (top < notes.scrollTop || top + on.offsetHeight > notes.scrollTop + notes.clientHeight) notes.scrollTop = top - 8;
    }
  }

  function tick(ts) {
    if (!playing) return;
    const dt = Math.min(0.1, (ts - last) / 1000) * speed;
    last = ts;
    if (hold > 0) {
      hold -= dt;
      if (hold <= 0) {
        if (k < n - 1) { k++; u = 0; }
        else if (loop) { k = 0; u = 0; }
        else { pause(); ended = true; draw(); return; }
      }
    } else {
      u += dt / stepSeconds(play.steps[k]);
      if (u >= 1) { u = 1; hold = k < n - 1 ? 0.7 : 1.4; }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!n) return;
    if (ended || (k === n - 1 && u >= 1)) { k = 0; u = 0; ended = false; }
    playing = true; hold = 0; last = performance.now();
    playBtn.innerHTML = ICON.pause; playBtn.setAttribute('aria-label', 'Pause');
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false; cancelAnimationFrame(raf);
    playBtn.innerHTML = ICON.play; playBtn.setAttribute('aria-label', 'Play');
  }
  function toggle() { playing ? pause() : start(); }
  function stepBy(d) {
    pause();
    if (d < 0 && u > 0.05 && u < 1) { u = 0; }
    else if (d < 0 && u >= 1) { u = 0; }
    else { k = Math.max(0, Math.min(n - 1, k + d)); u = 0; }
    draw();
  }

  function onKey(e) {
    if (e.target.closest('input,select,textarea')) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') stepBy(1);
    else if (e.key === 'ArrowLeft') stepBy(-1);
  }
  document.addEventListener('keydown', onKey);
  teardown = () => { pause(); document.removeEventListener('keydown', onKey); };

  const edit = () => {
    if (!ctx.drafts[play.id]) { ctx.drafts[play.id] = structuredClone(play); ctx.saveDrafts(); }
    ctx.go('#design-' + play.id);
  };

  shell('home',
    h('a', { href: '#', class: 'back', html: ICON.back + '<span>All plays</span>' }),
    h('section', { class: 'play-head' },
      h('div', { class: 'card-chips' }, chip(play.category || 'Offense'), chip(play.field === 'full' ? 'Full field' : 'Half field', 'chip-quiet'),
        isDraft ? chip('Draft, only on this device', 'chip-draft') : null),
      h('h1', {}, play.title),
      play.description ? h('p', { class: 'muted lede' }, play.description) : null),
    h('div', { class: 'viewer ' + play.field },
      h('div', { class: 'stage' },
        h('div', { class: 'stage-field' }, svg),
        h('div', { class: 'controls' },
          h('div', { class: 'ctl-row' },
            h('button', { class: 'ctl', 'aria-label': 'Previous step', html: ICON.prev, onclick: () => stepBy(-1) }),
            playBtn,
            h('button', { class: 'ctl', 'aria-label': 'Next step', html: ICON.next, onclick: () => stepBy(1) }),
            readout),
          scrub,
          h('div', { class: 'ctl-row ctl-opts' },
            h('label', {}, 'Speed ', speedSel),
            h('label', {}, 'Follow ', follow),
            toggleBtn('Loop', () => loop, (v) => { loop = v; store.set('hawks.loop', v); }),
            toggleBtn('Trails', () => trails, (v) => { trails = v; store.set('hawks.trails', v); board.setTrails(v); draw(); })))),
      h('aside', { class: 'notes-panel' },
        h('h2', {}, 'Coaching points'),
        notes,
        h('div', { class: 'legend' },
          h('span', { class: 'lg lg-run' }, 'Run / cut'), h('span', { class: 'lg lg-pass' }, 'Pass'),
          h('span', { class: 'lg lg-dodge' }, 'Dodge'), h('span', { class: 'lg lg-pick' }, 'Pick')),
        h('div', { class: 'aside-actions' },
          isCoach() ? h('button', { class: 'btn btn-quiet', onclick: edit }, isDraft ? 'Keep editing' : 'Edit in Designer') : null,
          PREVIEW ? null : h('button', { class: 'btn btn-quiet', onclick: () => printPlay(play) }, 'Print sheet')))));
  draw();
}

// ---------- routing ----------
function route() {
  if (teardown) { teardown(); teardown = null; }
  if (!ctx.key) return;
  let hash = location.hash.slice(1);
  window.scrollTo(0, 0);
  if (!isCoach() && (hash === 'design' || hash.startsWith('design-') || hash.startsWith('draft-'))) {
    toast('Only coaches can create or edit plays.');
    history.replaceState(null, '', location.pathname);
    hash = '';
  }
  if (hash.startsWith('play-') || hash.startsWith('draft-')) {
    const isDraft = hash.startsWith('draft-');
    const id = hash.slice(isDraft ? 6 : 5);
    const play = isDraft ? ctx.drafts[id] : ctx.published.find((p) => p.id === id);
    if (play) return renderViewer(play, isDraft);
    toast('That play is not in the playbook any more.');
    return renderHome();
  }
  if (hash === 'design' || hash.startsWith('design-')) {
    const main = shell('design');
    teardown = renderDesigner(main, ctx, hash.slice(7) || null);
    return;
  }
  renderHome();
}

window.addEventListener('hashchange', route);

(async function boot() {
  let saved = store.get(PW_KEY, null);
  if (typeof saved === 'string') saved = { role: 'player', pw: saved };
  if (saved && saved.pw) {
    try {
      if (await tryUnlock(saved.role === 'coach' ? 'coach' : 'player', saved.pw)) { await loadPlays(); route(); return; }
    } catch (e) { console.error(e); }
  }
  renderLock();
})();
