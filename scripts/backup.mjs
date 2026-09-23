import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const source=process.env.DATABASE_PATH || './data/subvencao.sqlite';
statSync(source); // Fail instead of silently backing up a new empty database.
const directory=process.env.BACKUP_DIR || '/backups';
mkdirSync(directory,{recursive:true,mode:0o700});
const target=resolve(directory,`subvencao-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
await backup(db,target);chmodSync(target,0o600);db.close();
const verify=new DatabaseSync(target,{readOnly:true});
const result=verify.prepare('PRAGMA integrity_check').get();verify.close();
if(result.integrity_check!=='ok')throw new Error('Backup reprovado na verificação de integridade.');
console.log(target);
