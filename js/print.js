// Printable sheets: one play broken into step diagrams, or a blank field for sketching.
import { h, svgEl } from './ui.js';
import { createBoard } from './render.js';

function sheet() {
  const root = document.getElementById('print');
  root.innerHTML = '';
  return root;
}

function header(title, sub) {
  return h('header', { class: 'pr-head' },
    h('img', { src: 'assets/logo-outline.png', alt: '', class: 'pr-logo' }),
    h('div', {}, h('div', { class: 'pr-eyebrow' }, 'Annapolis Hawks Lacrosse'), h('h1', {}, title), sub ? h('p', {}, sub) : null));
}

export function printPlay(play) {
  const root = sheet();
  root.append(header(play.title, [play.category, play.field === 'full' ? 'Full field' : 'Half field'].join(' · ')));
  if (play.description) root.append(h('p', { class: 'pr-desc' }, play.description));
  const grid = h('div', { class: 'pr-grid pr-' + play.field });
  play.steps.forEach((step, k) => {
    const svg = svgEl();
    const card = h('figure', { class: 'pr-step' }, svg,
      h('figcaption', {}, h('b', {}, `Step ${k + 1}`), ' ', step.note || ''));
    grid.append(card);
    createBoard(svg, play, { watermark: false }).show(k, 0);
  });
  root.append(grid);
  window.print();
}

export function printBlank(field) {
  const root = sheet();
  root.append(header(field === 'full' ? 'Full field play sheet' : 'Half field play sheet',
    'Circle each start spot, arrowhead at the finish, step number on every line.'));
  const svg = svgEl();
  const wrap = h('div', { class: 'pr-blank pr-' + field }, svg,
    h('div', { class: 'pr-lines' },
      h('div', { class: 'pr-legend' },
        h('span', {}, '——→ run / cut'), h('span', {}, '- - -→ pass'), h('span', {}, '∿∿∿→ dodge'),
        h('span', {}, '——┤ pick'), h('span', {}, '● ball'), h('span', {}, '① ② ③ step order')),
      h('div', { class: 'pr-field-row' }, h('span', {}, 'Play name'), h('i')),
      h('div', { class: 'pr-field-row' }, h('span', {}, 'Category'), h('i')),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('div', { class: 'pr-field-row' }, h('span', {}, `Step ${n}`), h('i')))));
  root.append(wrap);
  createBoard(svg, { field, pieces: [], steps: [], ball: {} }, { watermark: false }).show(-1);
  window.print();
}
