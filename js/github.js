// Commits encrypted plays straight to the GitHub repo from the browser, using a coach's
// fine-grained personal access token (Contents: read and write, this repository only).
// Commit messages name the play's id only: the repo is public and titles would reveal plays.
import { REPO } from './config.js';

const API = 'https://api.github.com';

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
export const repoLabel = `${REPO.owner}/${REPO.repo}`;

async function call(token, method, url, body) {
  const r = await fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'GET' && r.status === 404) return null;
  if (!r.ok) {
    const err = new Error(`GitHub ${method} failed: ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

const contentsUrl = (path) => `${API}/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;
const getFile = (token, path) => call(token, 'GET', `${contentsUrl(path)}?ref=${REPO.branch}`);
const decode = (b64) => atob(b64.replace(/\n/g, ''));

// Confirms the token can see the repo. Throws with .status on failure.
export async function checkToken(token) {
  const repo = await call(token, 'GET', `${API}/repos/${REPO.owner}/${REPO.repo}`);
  if (!repo) { const e = new Error('Repository not visible to this key'); e.status = 404; throw e; }
  return repo;
}

async function putFile(token, path, text, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await getFile(token, path);
    const body = { message, content: btoa(text), branch: REPO.branch };
    if (cur) body.sha = cur.sha;
    try {
      await call(token, 'PUT', contentsUrl(path), body);
      return cur ? 'updated' : 'created';
    } catch (e) {
      // Someone else committed in between: fetch the new version and try once more.
      if (attempt === 0 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

// Writes plays/<file> and makes sure plays/index.json lists it.
export async function publishFile(token, file, text) {
  const id = file.replace('.enc.json', '');
  const result = await putFile(token, `plays/${file}`, text, `Save play ${id} from the Designer`);
  const idx = await getFile(token, 'plays/index.json');
  const files = idx ? JSON.parse(decode(idx.content)).files || [] : [];
  if (!files.includes(file)) {
    files.push(file);
    files.sort();
    await putFile(token, 'plays/index.json', JSON.stringify({ files }, null, 1) + '\n', 'Update playbook index');
  }
  return result;
}
