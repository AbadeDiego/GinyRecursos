import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,cpSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Run only after npm run build. Exercises the actual standalone HTTP server.
test('Produção standalone: autenticação, cookies, CRUD, anexos e reinício',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'subvencao-production-'));
 const deployed=join(dir,'app');
 const base='http://localhost:4318';
 const env={...process.env,NODE_ENV:'production',PORT:'4318',HOSTNAME:'127.0.0.1',APP_ORIGIN:base,DATABASE_PATH:join(dir,'db.sqlite'),ADMIN_NAME:'QA',ADMIN_EMAIL:'qa@example.test',ADMIN_PASSWORD:randomUUID()};
 let server,output='';
 async function start(){
  server=spawn(process.execPath,[join(deployed,'server.js')],{env,cwd:deployed,stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{} if(server.exitCode!==null)throw new Error(output);await delay(100);}throw new Error('Servidor não iniciou: '+output);
 }
 async function stop(){if(!server||server.exitCode!==null)return;await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});}
 let cookie='';
 async function call(path,method='GET',data,files){
  const headers={origin:base,cookie,'idempotency-key':randomUUID()};let body;
  if(files){body=new FormData();body.set('data',JSON.stringify(data));for(const [key,value]of Object.entries(files))body.set(key,new Blob([value],{type:'application/pdf'}),key+'.pdf');}
  else if(data){headers['content-type']='application/json';body=JSON.stringify(data);}
  return fetch(base+'/api/'+path,{method,headers,body});
 }
 try{
  cpSync('.next/standalone',deployed,{recursive:true});
  cpSync('.next/static',join(deployed,'.next/static'),{recursive:true});cpSync('public',join(deployed,'public'),{recursive:true});
  await start();
  assert.equal((await fetch(base+'/fonts/Geist-latin.woff2')).status,200);
  const root=await fetch(base);assert.equal(root.status,200);assert.match(await root.text(),/Gestão de Subvenção/);assert.equal(root.headers.get('x-frame-options'),'DENY');
  assert.equal((await call('state')).status,401);
  const login=await call('auth/login','POST',{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);cookie=login.headers.get('set-cookie').split(';')[0];
  const company=await (await call('companies','POST',{name:'QA Ltda',short:'QA',cnpj:'000',city:'Recife',state:'PE',responsible:'QA',email:'qa@example.test',phone:'000'})).json();assert.ok(company.id);
  const project=await(await call('projects','POST',{companyId:company.id,name:'Teste HTTP',code:'HTTP-1',agency:'FACEPE',startDate:'2026-01-01',endDate:'2027-12-31',approved:10000,counterpart:1000,installments:2})).json();assert.ok(project.id);
  const member=await(await call('team','POST',{projectId:project.id,name:'Ana',role:'Dev',activity:'Desenvolver'})).json();assert.ok(member.id);
  assert.equal((await call('team/'+member.id,'PATCH',{...member,name:'Ana atualizada'})).status,200);
  assert.equal((await call('schedule/import','POST',{projectId:project.id,rows:[{item:'Web',activity:'Desenvolver plataforma',month:'Janeiro',value:500,status:'Em andamento'}]})).status,201);
  assert.equal((await call('budget/import','POST',{projectId:project.id,rows:[{fonte:'Subvenção',elemento:'Material de Consumo',descricao:'Insumos',unitario:1000,qtd:1,valorTotal:1000}]})).status,201);
  const bytes='%PDF-1.4\n%%EOF';
  const expense=await(await call('expenses','POST',{projectId:project.id,supplier:'Fornecedor',description:'Insumos',rubric:'Material de Consumo',value:100.30,date:'2026-09-23'},{invoice:bytes,payment:bytes})).json();assert.ok(expense.id);
  let state=await(await call('state')).json();assert.equal(state.projects[0].executed,100.30);assert.equal(state.expenses[0].docs,2);
  const documentId=state.expenses[0].documents[0].id;assert.equal(await(await call('documents/'+documentId)).text(),bytes);
  await stop();await start();state=await(await call('state')).json();assert.equal(state.team[0].name,'Ana atualizada');assert.equal(state.schedule[0].month,'Janeiro');assert.equal(state.projects[0].executed,100.30);assert.equal(await(await call('documents/'+documentId)).text(),bytes);
  // New workflows through the actual HTTP API, including pending documents and edits.
  const recurring=await call('schedule','POST',{projectId:project.id,rubric:'Pessoal / Pró-labore',activity:'Coordenação mensal',month:'Dezembro',year:2026,value:300,monthsCount:2});assert.equal(recurring.status,201);
  const installments=await recurring.json();assert.equal(installments[1].year,2027);
  const pending=await call('expenses','POST',{projectId:project.id,supplier:'Coordenação',description:'Pró-labore dezembro',rubric:'Pessoal / Pró-labore',value:300,date:'2026-12-20'});assert.equal(pending.status,201);
  const pendingExpense=await pending.json();
  assert.equal((await call('expenses/'+pendingExpense.id,'PATCH',{action:'edit',version:1,value:250})).status,200);
  const remap=await call('remaps','POST',{projectId:project.id,sourceScheduleId:installments[1].id,to:'Bolsa',activity:'Pesquisa aplicada',month:'Janeiro',year:2027,value:100,reason:'Ajuste de execução'});assert.equal(remap.status,201);
  const remapData=await remap.json();assert.equal((await call('remaps/'+remapData.id,'PATCH',{version:1,authorization:'Ofício QA'})).status,200);
  state=await(await call('state')).json();assert.equal(state.projects[0].executed,350.30);assert.equal(state.expenses.find(e=>e.id===pendingExpense.id).docs,0);
  await stop();await start();state=await(await call('state')).json();assert.equal(state.projects[0].executed,350.30);assert.equal(state.schedule.find(s=>s.rubric==='Bolsa').value,100);
  assert.equal((await call('expenses/'+pendingExpense.id,'DELETE',{version:2})).status,200);
  const backupPath=execFileSync(process.execPath,['scripts/backup.mjs'],{env:{...env,BACKUP_DIR:join(dir,'backups')},encoding:'utf8'}).trim();
  await stop();env.DATABASE_PATH=backupPath;await start();
  assert.equal(await(await call('documents/'+documentId)).text(),bytes);
  assert.equal((await(await call('state')).json()).projects[0].executed,100.30);
  assert.equal((await call('team/'+member.id,'DELETE',{version:2})).status,200);assert.equal((await(await call('state')).json()).team.length,0);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
