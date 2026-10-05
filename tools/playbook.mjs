#!/usr/bin/env node
// Playbook file tool. Passwords come from the HAWKS_PASSWORD (team) and HAWKS_COACH_PASSWORD
// environment variables and are never written to disk in readable form. The coach password
// unlocks a sealed copy of the team password, so coaches can read and publish plays.
//
//   node tools/playbook.mjs init               create plays/keyinfo.json (once)
//   node tools/playbook.mjs coach              set the coach password (HAWKS_COACH_PASSWORD)
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

async function sealForCoach(info) {
  const coachPw = process.env.HAWKS_COACH_PASSWORD;
  if (!coachPw) throw new Error('Set HAWKS_COACH_PASSWORD to the coach password.');
  const salt = toB64(randomBytes(16));
  const ck = await deriveKey(coachPw, salt, info.iter);
  info.coach = { salt, box: await encryptJSON(ck, process.env.HAWKS_PASSWORD) };
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
  if (process.env.HAWKS_COACH_PASSWORD) await sealForCoach(info);
  else console.log('No HAWKS_COACH_PASSWORD set: coach sign-in is off until you run the coach command.');
  await mkdir(PLAYS, { recursive: true });
  await writeFile(join(PLAYS, 'keyinfo.json'), JSON.stringify(info, null, 1) + '\n');
  console.log('Created plays/keyinfo.json');
} else if (cmd === 'coach') {
  await key(); // confirms HAWKS_PASSWORD is the current team password
  const path = join(PLAYS, 'keyinfo.json');
  const info = JSON.parse(await readFile(path, 'utf8'));
  await sealForCoach(info);
  await writeFile(path, JSON.stringify(info, null, 1) + '\n');
  console.log('Coach password set in plays/keyinfo.json');
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
  console.log('Usage: node tools/playbook.mjs init | coach | encrypt <files> | decrypt <dir> | index');
}
