import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Định dạng lưu: scrypt$<saltHex>$<hashHex>
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(plain), salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex + hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = await scrypt(String(plain), Buffer.from(saltHex, 'hex'), KEY_LEN);
  return crypto.timingSafeEqual(actual, expected);
}

export function isValidPassword(plain) {
  return typeof plain === 'string' && plain.length >= PASSWORD_MIN && plain.length <= PASSWORD_MAX;
}
