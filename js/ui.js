// Small DOM helpers shared by the viewer and the designer.
export const $ = (s, r = document) => r.querySelector(s);

export function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') n[k] = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function svgEl(cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  return s;
}

export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2800);
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export const CATEGORIES = ['Offense', 'Man-Up', 'Man-Down', 'Defense', 'Clears', 'Rides', 'Faceoffs', 'Drills'];

// Set by the preview build, where downloads and printing are unavailable.
export const PREVIEW = !!window.HAWKS_PREVIEW;

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) { fallbackEl.hidden = false; fallbackEl.value = text; fallbackEl.select(); }
    return false;
  }
}

export function uid() {
  return 'p' + Math.random().toString(36).slice(2, 8);
}

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
export const ICON = {
  play: I('M8 5.5v13l11-6.5z'),
  pause: I('M7 5h4v14H7zM13 5h4v14h-4z'),
  prev: I('M6 5h2v14H6zM20 5v14L9 12z'),
  next: I('M16 5h2v14h-2zM4 5v14l11-7z'),
  back: I('M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z'),
};
