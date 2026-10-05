// Team-password encryption: PBKDF2-SHA256 derives an AES-GCM-256 key.
// Plays are stored encrypted, so the public repo never contains a readable play.
// Works in browsers and in Node 20+ (globalThis.crypto).
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export const CHECK_TEXT = 'annapolis-hawks';

export function toB64(bytes) {
  bytes = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password, saltB64, iterations) {
  const base = await subtle().importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(key, box) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return JSON.parse(td.decode(pt));
}
