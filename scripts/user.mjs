import { openDatabase } from '../server/database.mjs';
import { createUser, hashPassword } from '../server/auth.mjs';
const db=openDatabase();
if(process.argv[2]==='reset') {
  if(!process.env.USER_EMAIL || !process.env.USER_PASSWORD)throw new Error('Defina USER_EMAIL e USER_PASSWORD.');
  const result=db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(hashPassword(process.env.USER_PASSWORD),process.env.USER_EMAIL.toLowerCase());
  if(!result.changes)throw new Error('Usuário não encontrado.');
  db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)').run(process.env.USER_EMAIL.toLowerCase());
  console.log('Senha redefinida e sessões revogadas.');
} else {
  createUser(db,{name:process.env.USER_NAME,email:process.env.USER_EMAIL,password:process.env.USER_PASSWORD,role:process.env.USER_ROLE || 'admin'});
  console.log('Usuário criado.');
}
db.close();
