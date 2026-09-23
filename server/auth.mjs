import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { transaction } from './database.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('A senha precisa ter entre 12 e 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
const dummy = hashPassword('dummy-only-for-timing-0123456789');
export function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = (hash || dummy).split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex')) && Boolean(hash);
}
export function createUser(db, { name, email, password, role = 'editor' }) {
  if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['admin','editor','viewer'].includes(role)) throw new Error('Dados do usuário inválidos.');
  const id = randomUUID();
  db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id, name.trim(), email.trim().toLowerCase(), hashPassword(password), role);
  return { id, name: name.trim(), email: email.trim().toLowerCase(), role };
}
export function bootstrap(db) {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) return;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  transaction(db, () => {
    if (!db.prepare('SELECT id FROM users LIMIT 1').get()) createUser(db, {name: process.env.ADMIN_NAME || 'Administrador', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin'});
  });
}
export function sessionUser(db, request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)subvencao_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return db.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1').get(digest(token), Date.now()) || null;
}
export function newSession(db, userId) {
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), userId, Date.now() + 12 * 60 * 60 * 1000);
  return token;
}
export function sessionCookie(token, origin, clear = false) {
  return `subvencao_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${origin.startsWith('https:') ? '; Secure' : ''}`;
}
