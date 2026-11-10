import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const digest = (token) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return salt + ':' + hash.toString('hex');
}

export async function matches(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(await derive(password, salt, 64), Buffer.from(hash, 'hex'));
}
