import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {openDatabase} from '../server/database.mjs';
import {createUser} from '../server/auth.mjs';
import {createApplication} from '../server/application.mjs';
import {csvRecords} from '../lib/csv.mjs';

const origin='http://localhost:3000';
const admin={name:'Administradora',email:'admin@test.example',password:'test-password-12345',role:'admin'};
async function fixture() {
  const db=openDatabase(':memory:');createUser(db,admin);
  const app=createApplication(db,{origin});
  let cookie='';
  async function call(path,method='GET',data,options={}) {
    const headers={origin,cookie,...options.headers};
    if(method!=='GET')headers['idempotency-key']=options.key||randomUUID();
    let body;
    if(options.files) {body=new FormData();body.set('data',JSON.stringify(data));for(const [kind,contents] of Object.entries(options.files))body.set(kind,new Blob([contents]),`${kind}.pdf`);}
    else if(data!==undefined){headers['content-type']='application/json';body=JSON.stringify(data);}
    const response=await app(new Request(origin+'/api/'+path,{method,headers,body}));
    const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{result=raw;}
    return {status:response.status,data:result,response};
  }
  const login=await call('auth/login','POST',admin);cookie=login.response.headers.get('set-cookie').split(';')[0];
  const company=(await call('companies','POST',{name:'Empresa',short:'Empresa',cnpj:'00.000.000/0001-00',city:'Recife',state:'PE',responsible:'Ana',email:'ana@example.com',phone:'123'})).data;
  const project=(await call('projects','POST',{companyId:company.id,name:'Plataforma',code:'P-01',agency:'FACEPE',startDate:'2026-01-01',endDate:'2027-12-31',approved:10000,counterpart:2000,installments:2})).data;
  const projectId=project.id;
  return {db,app,call,project,projectId,company,cookie};
}
const team={name:'Ana',role:'Desenvolvedora',activity:'Desenvolver a plataforma web.'};
const schedule={item:'Plataforma web',activity:'Programar e validar os módulos.',value:2500.35,month:'Janeiro',status:'Não iniciada'};
const budgetRow={fonte:'Subvenção',elemento:'Material de Consumo',descricao:'Insumos',unitario:1000,qtd:5,valorTotal:5000};
const expense={supplier:'Fornecedor',description:'Compra de insumos',rubric:'Material de Consumo',date:'2026-09-23',value:100.10};
const pdf='%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF';

test('Login obrigatório, CSRF, senha incorreta, logout e sessão revogada',async()=>{
  const f=await fixture();
  assert.equal((await f.app(new Request(origin+'/api/state'))).status,401);
  assert.equal((await f.call('team','POST',{...team,projectId:f.projectId},{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await f.call('auth/login','POST',{email:admin.email,password:'wrong'})).status,401);
  assert.equal((await f.call('auth/logout','POST',{})).status,200);
  assert.equal((await f.call('state')).status,401);f.db.close();
});
test('Bloqueia tentativa repetida de senha e usuário de consulta não altera dados',async()=>{
  const f=await fixture();createUser(f.db,{...admin,email:'viewer@test.example',role:'viewer'});
  for(let i=0;i<8;i++)assert.equal((await f.call('auth/login','POST',{email:'unknown@test.example',password:'wrong'})).status,401);
  assert.equal((await f.call('auth/login','POST',{email:'unknown@test.example',password:'wrong'})).status,429);
  const login=await f.call('auth/login','POST',{email:'viewer@test.example',password:admin.password});
  const cookie=login.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('state','GET',undefined,{headers:{cookie}})).status,200);
  assert.equal((await f.call('team','POST',{...team,projectId:f.projectId},{headers:{cookie}})).status,403);
  assert.equal((await f.call('users','GET',undefined,{headers:{cookie}})).status,403);f.db.close();
});
test('Equipe CRUD com conflito de versão e exclusão persistida',async()=>{
  const f=await fixture();const created=await f.call('team','POST',{...team,projectId:f.projectId});assert.equal(created.status,201);
  const changed=await f.call('team/'+created.data.id,'PATCH',{...created.data,name:'Ana Paula'});assert.equal(changed.status,200);assert.equal(changed.data.version,2);
  assert.equal((await f.call('team/'+created.data.id,'PATCH',created.data)).status,409);
  assert.equal((await f.call('team/'+created.data.id,'DELETE',{version:2})).status,200);
  assert.equal((await f.call('state')).data.team.length,0);f.db.close();
});
test('Importação da equipe é atômica e preserva membros de outros projetos',async()=>{
  const f=await fixture();const id=f.projectId;
  await f.call('team','POST',{...team,projectId:id});
  const bad=await f.call('team/import','POST',{projectId:id,rows:[team,{...team,name:''}]});assert.equal(bad.status,422);assert.equal((await f.call('state')).data.team.length,1);
  assert.equal((await f.call('team/import','POST',{projectId:id,rows:[{...team,name:'João'},{...team,name:'Maria'}]})).status,201);
  assert.equal((await f.call('state')).data.team.length,3);
  assert.equal((await f.call('team','POST',{...team,projectId:'absent'})).status,404);f.db.close();
});
test('Cronograma valida mês, valores e status e mantém edições',async()=>{
  const f=await fixture();
  const r=await f.call('schedule/import','POST',{projectId:f.projectId,rows:[schedule]});assert.equal(r.status,201);const item=r.data[0];
  assert.equal((await f.call('schedule/'+item.id,'PATCH',{...item,status:'Concluída'})).status,200);
  assert.equal((await f.call('state')).data.schedule[0].status,'Concluída');
  for(const invalid of [{month:'13'},{value:-1},{status:'X'},{value:1.123}])assert.equal((await f.call('schedule','POST',{...schedule,...invalid,projectId:f.projectId})).status,422);
  f.db.close();
});
test('Idempotência evita duplicação e rejeita a reutilização com outro conteúdo',async()=>{
  const f=await fixture(),key=randomUUID(),data={...team,projectId:f.projectId};
  const a=await f.call('team','POST',data,{key}),b=await f.call('team','POST',data,{key});assert.equal(a.data.id,b.data.id);
  assert.equal((await f.call('team','POST',{...data,name:'Outro'},{key})).status,409);assert.equal((await f.call('state')).data.team.length,1);f.db.close();
});
test('Despesas, anexos reais, finalização de rascunho e conferência financeira',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
  assert.equal((await f.call('expenses','POST',{...expense,projectId})).status,422);
  const created=(await f.call('expenses','POST',{...expense,projectId,draft:true})).data;
  assert.equal((await f.call('state')).data.projects[0].executed,0);
  const upload=await f.call('expenses/'+created.id+'/documents','POST',{}, {files:{invoice:pdf,payment:pdf}});assert.equal(upload.status,201);
  let state=(await f.call('state')).data;assert.equal(state.expenses[0].docs,2);
  const downloaded=await f.call('documents/'+state.expenses[0].documents[0].id);assert.equal(downloaded.data,pdf);
  assert.equal((await f.call('expenses/'+created.id,'PATCH',{version:state.expenses[0].version,action:'submit'})).status,200);
  state=(await f.call('state')).data;assert.equal(state.projects[0].executed,100.10);
  assert.equal((await f.call('expenses/'+created.id,'PATCH',{version:state.expenses[0].version,action:'reconcile',bankReference:'PIX-123'})).status,200);
  assert.equal((await f.call('state')).data.expenses[0].status,'Conciliado');f.db.close();
});
test('Envio multipart repetido não duplica documentos nem despesa',async()=>{
  const f=await fixture(),projectId=f.projectId,key=randomUUID();await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
  const data={...expense,projectId};const options={key,files:{invoice:pdf,payment:pdf}};
  const a=await f.call('expenses','POST',data,options),b=await f.call('expenses','POST',data,options);
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.id,b.data.id);assert.equal((await f.call('state')).data.expenses.length,1);f.db.close();
});
test('Bloqueia documentos falsos, limites de upload e despesa acima do orçamento',async()=>{
  const f=await fixture(),projectId=f.projectId;await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
  assert.equal((await f.call('expenses','POST',{...expense,projectId},{files:{invoice:'<script>bad</script>',payment:pdf}})).status,422);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,value:5001},{files:{invoice:pdf,payment:pdf}})).status,422);
  assert.equal((await f.call('expenses','POST',{...expense,projectId},{files:{invoice:pdf+'x'.repeat(10*1024*1024),payment:pdf}})).status,422);
  assert.equal((await f.call('state')).data.expenses.length,0);f.db.close();
});
test('Parcelas únicas, contrapartida e rendimentos não são truncados silenciosamente',async()=>{
  const f=await fixture(),projectId=f.projectId;
  const base={projectId,kind:'Parcela da subvenção',value:5000,date:'2026-09-23',installment:1,reference:'TED 1'};
  assert.equal((await f.call('resources','POST',base)).status,201);
  assert.equal((await f.call('resources','POST',base)).status,409);
  assert.equal((await f.call('resources','POST',{...base,value:5001,installment:2})).status,422);
  assert.equal((await f.call('resources','POST',{...base,kind:'Contrapartida financeira',value:2000})).status,201);
  assert.equal((await f.call('resources','POST',{...base,kind:'Rendimento de aplicação',value:0.10})).status,201);
  assert.equal((await f.call('resources','POST',{...base,kind:'Rendimento de aplicação',value:0.20})).status,201);
  const state=(await f.call('state')).data;assert.equal(state.projects[0].released,5000);assert.equal(state.projects[0].counterpartRealized,2000);assert.equal(state.projects[0].income,0.30);f.db.close();
});
test('Remanejamento só muda o orçamento com aprovação e saldo, reimportação inválida faz rollback',async()=>{
  const f=await fixture(),projectId=f.projectId;await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
  const remap=(await f.call('remaps','POST',{projectId,from:'Material de Consumo',to:'Consultoria',value:4000,reason:'Ajuste autorizado'})).data;
  assert.equal((await f.call('remaps/'+remap.id,'PATCH',{version:1,authorization:'Ofício 01/2026'})).status,200);
  const tooMuch=(await f.call('remaps','POST',{projectId,from:'Material de Consumo',to:'Consultoria',value:2000,reason:'Teste de saldo'})).data;
  assert.equal((await f.call('remaps/'+tooMuch.id,'PATCH',{version:1,authorization:'Ofício'})).status,422);
  assert.equal((await f.call('budget/import','POST',{projectId,rows:[{...budgetRow,qtd:1,valorTotal:1000}]})).status,422);
  assert.equal((await f.call('state')).data.budget[0].valorTotal,5000);f.db.close();
});
test('Links bloqueiam javascript e exportação CSV neutraliza fórmulas',async()=>{
  const f=await fixture(),projectId=f.projectId;
  assert.equal((await f.call('links','POST',{projectId,name:'Portal',url:'javascript:alert(1)'})).status,422);
  assert.equal((await f.call('links','POST',{projectId,name:'Portal',url:'https://example.com'})).status,201);
  await f.call('expenses','POST',{...expense,projectId,draft:true,supplier:'=1+1'});
  const csv=await f.call('reports/'+projectId);assert.match(csv.data,/'=1\+1/);assert.match(csv.data,/100,10/);f.db.close();
});
test('Isolamento entre projetos e ausência de registros demonstrativos',async()=>{
  const f=await fixture();assert.equal((await f.call('state')).data.team.length,0);
  const second=(await f.call('projects','POST',{companyId:f.company.id,name:'Outro projeto',code:'P-02',agency:'FINEP',startDate:'2026-01-01',endDate:'2026-12-31',approved:10000,counterpart:0,installments:1})).data;
  await f.call('team','POST',{...team,projectId:second.id});await f.call('schedule/import','POST',{projectId:f.projectId,rows:[schedule]});
  const state=(await f.call('state')).data;assert.equal(state.team[0].projectId,second.id);assert.equal(state.schedule[0].projectId,f.projectId);assert.equal(state.projects[1].executed,0);f.db.close();
});
test('Persistência sobrevive reabertura; backup do banco e integridade',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'subvencao-test-')),path=join(dir,'db.sqlite');let db=openDatabase(path);createUser(db,admin);
  const app=createApplication(db,{origin});let response=await app(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(admin)}));
  const cookie=response.headers.get('set-cookie').split(';')[0];
  response=await app(new Request(origin+'/api/companies',{method:'POST',headers:{origin,cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({name:'Persistente',short:'P',cnpj:'0',city:'Recife',state:'PE',responsible:'Ana',email:'a@b.com',phone:'1'})}));assert.equal(response.status,201);
  await backup(db,join(dir,'backup.sqlite'));db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) AS n FROM companies').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
  const restored=openDatabase(join(dir,'backup.sqlite'));assert.equal(restored.prepare('SELECT count(*) AS n FROM companies').get().n,1);assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);restored.close();rmSync(dir,{recursive:true});
});
test('CSV brasileiro, BOM, aspas escapadas, campos multilinha e erros',()=>{
  assert.deepEqual(csvRecords('\ufeffnome;função;atividade\r\nAna;Dev;"Linha 1\nLinha 2 com ""aspas"""'),[['nome','função','atividade'],['Ana','Dev','Linha 1\nLinha 2 com "aspas"']]);
  assert.deepEqual(csvRecords('item,valor\n"Web, app","1.234,56"'),[['item','valor'],['Web, app','1.234,56']]);
  assert.throws(()=>csvRecords('a;b\n"ab;c'));assert.throws(()=>csvRecords('a;b\n1;2;3'));
});

test('Duas edições simultâneas não sobrescrevem uma à outra',async()=>{
  const f=await fixture();const item=(await f.call('team','POST',{...team,projectId:f.projectId})).data;
  const result=await Promise.all([f.call('team/'+item.id,'PATCH',{...item,name:'Primeira'}),f.call('team/'+item.id,'PATCH',{...item,name:'Segunda'})]);
  assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal((await f.call('state')).data.team[0].version,2);f.db.close();
});
test('Administração de usuários, desativação e troca de senha revogam acesso',async()=>{
  const f=await fixture();const editor=await f.call('users','POST',{name:'Editor',email:'editor@test.example',password:'editor-password-1234',role:'editor'});assert.equal(editor.status,201);
  const login=await f.call('auth/login','POST',{email:'editor@test.example',password:'editor-password-1234'});const cookie=login.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('users/'+editor.data.id,'PATCH',{active:false})).status,200);
  assert.equal((await f.call('state','GET',undefined,{headers:{cookie}})).status,401);
  assert.equal((await f.call('auth/password','POST',{currentPassword:admin.password,password:'new-admin-password-5678'})).status,200);
  assert.equal((await f.call('state')).status,401);
  assert.equal((await f.call('auth/login','POST',{email:admin.email,password:admin.password})).status,401);f.db.close();
});
