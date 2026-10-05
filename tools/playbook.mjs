#!/usr/bin/env node
// Playbook file tool. The team password comes from the HAWKS_PASSWORD environment variable
// and is never written to disk.
//
//   node tools/playbook.mjs init               create plays/keyinfo.json (once)
//   node tools/playbook.mjs encrypt a.json ...  encrypt plain play files into plays/<id>.enc.json
//   node tools/playbook.mjs decrypt out-dir    write every published play as plain JSON
//   node tools/playbook.mjs index              rebuild plays/index.json (no password needed)
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, encryptJSON, decryptJSON, toB64, randomBytes, CHECK_TEXT } from '../js/crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYS = join(ROOT, 'plays');
const ITER = 250000;

async function key() {
  const pw = process.env.HAWKS_PASSWORD;
  if (!pw) throw new Error('Set HAWKS_PASSWORD to the team password.');
  const info = JSON.parse(await readFile(join(PLAYS, 'keyinfo.json'), 'utf8'));
  const k = await deriveKey(pw, info.salt, info.iter);
  if ((await decryptJSON(k, info.check).catch(() => null)) !== CHECK_TEXT) throw new Error('Wrong password for this playbook.');
  return k;
}

async function index() {
  const files = (await readdir(PLAYS)).filter((f) => f.endsWith('.enc.json')).sort();
  await writeFile(join(PLAYS, 'index.json'), JSON.stringify({ files }, null, 1) + '\n');
  console.log(`index.json lists ${files.length} play(s)`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'init') {
  if (existsSync(join(PLAYS, 'keyinfo.json')) && !args.includes('--force')) throw new Error('keyinfo.json exists. Use --force to change the password (re-encrypt plays first).');
  const pw = process.env.HAWKS_PASSWORD;
  if (!pw) throw new Error('Set HAWKS_PASSWORD to the team password.');
  const salt = toB64(randomBytes(16));
  const k = await deriveKey(pw, salt, ITER);
  const info = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt, check: await encryptJSON(k, CHECK_TEXT) };
  await mkdir(PLAYS, { recursive: true });
  await writeFile(join(PLAYS, 'keyinfo.json'), JSON.stringify(info, null, 1) + '\n');
  console.log('Created plays/keyinfo.json');
} else if (cmd === 'encrypt') {
  const k = await key();
  for (const f of args) {
    const play = JSON.parse(await readFile(f, 'utf8'));
    if (!play.id) throw new Error(`${f} has no id`);
    await writeFile(join(PLAYS, `${play.id}.enc.json`), JSON.stringify(await encryptJSON(k, play)) + '\n');
    console.log(`${f} -> plays/${play.id}.enc.json  (${play.title})`);
  }
  await index();
} else if (cmd === 'decrypt') {
  const k = await key();
  const out = args[0] || 'decrypted';
  await mkdir(out, { recursive: true });
  for (const f of (await readdir(PLAYS)).filter((x) => x.endsWith('.enc.json'))) {
    const play = await decryptJSON(k, JSON.parse(await readFile(join(PLAYS, f), 'utf8')));
    await writeFile(join(out, `${play.id}.json`), JSON.stringify(play, null, 1) + '\n');
    console.log(`${f} -> ${out}/${play.id}.json  (${play.title})`);
  }
} else if (cmd === 'index') {
  await index();
} else {
  console.log('Usage: node tools/playbook.mjs init | encrypt <files> | decrypt <dir> | index');
}
