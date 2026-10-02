import {utils as excelUtils,write as writeExcel} from 'xlsx';
import {spreadsheetCsv} from '../lib/spreadsheets.mjs';
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
    if(options.files) {body=new FormData();body.set('data',JSON.stringify(data));for(const [kind,contents] of Object.entries(options.files))body.set(kind,new Blob([contents]),options.fileNames?.[kind]||`${kind}.pdf`);}
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
test('Remanejamento é aplicado ao salvar, preserva total e respeita idempotência',async()=>{
  const f=await fixture(),projectId=f.projectId;
  const source=(await f.call('schedule','POST',{...schedule,rubric:'Material de Consumo',value:5000,projectId})).data;
  const request={projectId,sourceScheduleId:source.id,to:'Consultoria',activity:'Nova consultoria técnica',month:'Fevereiro',year:2026,value:4000,reason:'Ajustar o planejamento'};
  const key=randomUUID(),r=await f.call('remaps','POST',request,{key});assert.equal(r.status,201);assert.equal(r.data.status,'Aprovado');
  assert.equal((await f.call('remaps','POST',request,{key})).data.id,r.data.id);
  assert.equal((await f.call('state')).data.schedule.length,2);
  const state=(await f.call('state')).data;
  assert.equal(state.schedule.find(s=>s.id===source.id).value,1000);
  assert.equal(state.schedule.find(s=>s.id!==source.id).value,4000);
  assert.equal(state.schedule.find(s=>s.id!==source.id).activity,request.activity);
  assert.equal(state.schedule.reduce((sum,s)=>sum+s.value,0),5000);
  assert.equal((await f.call('remaps','POST',{...request,value:2000})).status,422);
  assert.equal((await f.call('remaps/'+r.data.id,'PATCH',{version:0,...request})).status,409);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',value:4000})).status,201);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',value:0.01})).status,422);
  f.db.close();
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

test('Pró-labore mensal atravessa o ano, é atômico e não duplica no reenvio',async()=>{
  const f=await fixture(),projectId=f.projectId,key=randomUUID();
  const input={projectId,rubric:'Pessoal / Pró-labore',activity:'Coordenação',value:1000.35,month:'Novembro',year:2026,monthsCount:3};
  const a=await f.call('schedule','POST',input,{key});assert.equal(a.status,201);
  assert.deepEqual(a.data.map(s=>[s.month,s.year,s.value]),[['Novembro',2026,1000.35],['Dezembro',2026,1000.35],['Janeiro',2027,1000.35]]);
  assert.equal(new Set(a.data.map(s=>s.recurrenceId)).size,1);
  assert.equal((await f.call('schedule','POST',input,{key})).status,201);
  assert.equal((await f.call('state')).data.schedule.length,3);
  const changed=await f.call('schedule/'+a.data[1].id,'PATCH',{...a.data[1],value:500});assert.equal(changed.status,200);
  assert.equal((await f.call('state')).data.schedule[0].value,1000.35);
  assert.equal((await f.call('schedule/import','POST',{projectId,rows:[{...input,monthsCount:60}]})).status,422);
  assert.equal((await f.call('state')).data.schedule.length,3);f.db.close();
});
test('Rubricas personalizadas, contrapartida e planejamento controlam o saldo',async()=>{
  const f=await fixture(),projectId=f.projectId;
  assert.equal((await f.call('rubrics','POST',{projectId,name:'Licenças de software',type:'Custeio'})).status,201);
  assert.equal((await f.call('rubrics','POST',{projectId,name:'licencas de software'})).status,409);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Licenças de software'})).status,422);
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:'Licenças de software',value:500})).status,201);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Licenças de software',value:500})).status,201);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Contrapartida',value:2000})).status,201);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Contrapartida',value:0.01})).status,422);
  const state=(await f.call('state')).data;assert.equal(state.projects[0].executed,2500);
  assert.equal(state.expenses[0].missingDocuments.length,5);
  f.db.close();
});
test('Edição e exclusão recalculam saldos, preservam anexos na edição e registram auditoria',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500});
  const r=await f.call('expenses','POST',{...expense,projectId},{files:{invoice:pdf,payment:pdf}});assert.equal(r.status,201);
  const id=r.data.id;
  assert.equal((await f.call('expenses/'+id,'PATCH',{action:'reconcile',version:1,bankReference:'PIX-01'})).status,200);
  assert.equal((await f.call('expenses/'+id,'PATCH',{...expense,action:'edit',version:2,value:600})).status,422);
  assert.equal((await f.call('expenses/'+id,'PATCH',{...expense,action:'edit',version:2,value:400})).status,200);
  let state=(await f.call('state')).data;assert.equal(state.projects[0].executed,400);assert.equal(state.expenses[0].docs,2);assert.equal(state.expenses[0].status,'Em análise');assert.equal(state.expenses[0].bankReference,undefined);
  assert.equal((await f.call('expenses/'+id,'DELETE',{version:2})).status,409);
  const documentId=state.expenses[0].documents[0].id;
  assert.equal((await f.call('expenses/'+id,'DELETE',{version:3})).status,200);
  state=(await f.call('state')).data;assert.equal(state.projects[0].executed,0);assert.equal(state.expenses.length,0);
  assert.equal((await f.call('documents/'+documentId)).status,404);
  const audit=(await f.call('audit')).data.find(a=>a.entity_id===id&&a.action==='delete');assert.equal(JSON.parse(audit.details).value,400);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);f.db.close();
});
test('Sem anexos: registro, rascunho e conferência permitidos; checklist informativo',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:1000});
  const r=(await f.call('expenses','POST',{...expense,projectId})).data;
  assert.equal((await f.call('expenses/'+r.id,'PATCH',{version:1,action:'reconcile',bankReference:'PIX'})).status,200);
  const draft=(await f.call('expenses','POST',{...expense,projectId,draft:true})).data;
  assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'submit'})).status,200);
  const state=(await f.call('state')).data;assert.equal(state.projects[0].executed,200.20);assert.ok(state.expenses.every(e=>e.docs===0));f.db.close();
});
test('Saldo executado impede reduzir previsão e remanejar depois de gastar',async()=>{
  const f=await fixture(),projectId=f.projectId;
  const source=(await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500})).data;
  assert.equal((await f.call('expenses','POST',{...expense,projectId,value:200})).status,201);
  assert.equal((await f.call('remaps','POST',{projectId,sourceScheduleId:source.id,to:'Bolsa',activity:'Bolsa de pesquisa',month:'Março',year:2026,value:400,reason:'Ajuste'})).status,422);
  assert.equal((await f.call('schedule/'+source.id,'PATCH',{...source,value:100})).status,422);
  assert.equal((await f.call('state')).data.schedule[0].value,500);f.db.close();
});
test('Banco anterior recebe migração sem perder empresas e contas',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'migration-')),path=join(dir,'db.sqlite');
  let db=openDatabase(path);createUser(db,admin);
  db.exec("INSERT INTO companies(id,data) VALUES('legacy','{\"name\":\"Empresa anterior\"}'); DROP TABLE rubrics; ALTER TABLE audit DROP COLUMN details; DELETE FROM migrations WHERE version=2;");
  db.close();db=openDatabase(path);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM companies').get().n,1);
  assert.equal(db.prepare('SELECT version FROM migrations WHERE version=2').get().version,2);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  db.close();rmSync(dir,{recursive:true});
});

test('Remanejamento preserva orçamento legado do destino e rejeita origem de outro projeto',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('budget/import','POST',{projectId,rows:[{...budgetRow,elemento:'Consultoria',unitario:500,qtd:1,valorTotal:500}]});
  const source=(await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:1000})).data;
  const second=(await f.call('projects','POST',{companyId:f.company.id,name:'Outro',code:'R2',agency:'FACEPE',startDate:'2026-01-01',endDate:'2027-12-31',approved:10000,counterpart:0,installments:1})).data;
  const request={projectId,sourceScheduleId:source.id,to:'Consultoria',activity:'Nova atividade',month:'Março',year:2026,value:300,reason:'Ajuste'};
  assert.equal((await f.call('remaps','POST',{...request,projectId:second.id})).status,422);
  const remap=(await f.call('remaps','POST',request)).data;
  assert.equal(remap.status,'Aprovado');
  const state=(await f.call('state')).data;
  assert.equal(state.schedule.reduce((sum,s)=>sum+s.value,0),1500);
  assert.equal(state.schedule.filter(s=>s.rubric==='Consultoria').reduce((sum,s)=>sum+s.value,0),800);
  f.db.close();
});

test('Fontes separadas na importação, pró-labore, limites e exclusão do cronograma',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const imported=await f.call('schedule/import','POST',{projectId,rows:[{...schedule,rubric:'Consultoria',source:'Subvenção',value:1000},{...schedule,rubric:'Consultoria',source:'Contrapartida',value:500}]});assert.equal(imported.status,201);
 assert.equal((await f.call('schedule','POST',{...schedule,projectId,source:'Contrapartida',value:1600})).status,422);
 const monthly=await f.call('schedule','POST',{...schedule,projectId,rubric:'Pessoal / Pró-labore',source:'Contrapartida',value:100,monthsCount:3,year:2026,month:'Dezembro'});assert.equal(monthly.status,201);assert.ok(monthly.data.every(s=>s.source==='Contrapartida'));assert.equal(monthly.data[1].year,2027);
 const counter=imported.data[1];assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:400})).status,201);
 assert.equal((await f.call('schedule/'+counter.id,'DELETE',{version:1})).status,422);
 assert.equal((await f.call('schedule/'+counter.id,'PATCH',{...counter,source:'Subvenção'})).status,422);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',source:'Subvenção',value:1000})).status,201);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:101})).status,422);
 assert.equal((await f.call('schedule/'+monthly.data[0].id,'DELETE',{version:1})).status,200);
 const state=(await f.call('state')).data;assert.equal(state.projects[0].executedSubvention,1000);assert.equal(state.projects[0].executedCounterpart,400);assert.equal(state.projects[0].executed,1400);
 assert.equal(state.schedule.find(s=>s.id===counter.id).source,'Contrapartida');f.db.close();
});

test('Orçamento importado preserva saldos separados para a mesma rubrica',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const rows=[{...budgetRow,unitario:1000,qtd:1,valorTotal:1000},{...budgetRow,fonte:'Contrapartida',unitario:500,qtd:1,valorTotal:500}];
 assert.equal((await f.call('budget/import','POST',{projectId,rows})).status,201);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,source:'Contrapartida',value:501})).status,422);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,source:'Contrapartida',value:500})).status,201);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,source:'Subvenção',value:1000})).status,201);
 assert.equal((await f.call('budget/import','POST',{projectId,rows:[rows[0]]})).status,422);
 const report=(await f.call('reports/'+projectId+'?format=json')).data;assert.equal(report.planning.length,2);assert.equal(report.project.executed,1500);f.db.close();
});

test('Remanejamento pode ser editado e excluído com reversão atômica e proteção de gastos',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const source=(await f.call('schedule','POST',{...schedule,projectId,source:'Contrapartida',rubric:'Consultoria',value:1000})).data;
 const remap=(await f.call('remaps','POST',{projectId,sourceScheduleId:source.id,to:'Bolsa',activity:'Pesquisa',month:'Março',year:2026,value:400,reason:'Ajuste'})).data;assert.equal(remap.source,'Contrapartida');
 let state=(await f.call('state')).data;
 assert.equal(state.schedule.find(s=>s.id===source.id).value,600);
 const destination=state.schedule.find(s=>s.id===remap.destinationScheduleId);
 assert.equal((await f.call('schedule/'+destination.id,'PATCH',{...destination,value:900})).status,422);
 assert.equal((await f.call('schedule/'+destination.id,'DELETE',{version:1})).status,422);
 const expenseResult=(await f.call('expenses','POST',{...expense,projectId,rubric:'Bolsa',source:'Contrapartida',value:350})).data;
 assert.equal((await f.call('remaps/'+remap.id,'PATCH',{...remap,value:300})).status,422);
 assert.equal((await f.call('remaps/'+remap.id,'DELETE',{version:1})).status,422);
 state=(await f.call('state')).data;assert.equal(state.remaps[0].version,1);assert.equal(state.schedule.find(s=>s.id===source.id).value,600);
 const changed=await f.call('remaps/'+remap.id,'PATCH',{...remap,value:500,reason:'Ajuste revisado'});assert.equal(changed.status,200);assert.equal(changed.data.version,2);
 assert.equal((await f.call('remaps/'+remap.id,'DELETE',{version:1})).status,409);
 assert.equal((await f.call('expenses/'+expenseResult.id,'DELETE',{version:1})).status,200);
 assert.equal((await f.call('remaps/'+remap.id,'DELETE',{version:2})).status,200);
 state=(await f.call('state')).data;assert.equal(state.remaps.length,0);assert.equal(state.schedule.length,1);assert.equal(state.schedule[0].value,1000);assert.ok(f.db.prepare("SELECT * FROM audit WHERE action='delete' AND entity='remaps'").get());f.db.close();
});

test('Remanejamentos encadeados exigem reversão do último destino primeiro',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const source=(await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:1000})).data;
 const input={projectId,to:'Bolsa',activity:'Pesquisa',month:'Março',year:2026,value:400,reason:'Ajuste'};
 const first=(await f.call('remaps','POST',{...input,sourceScheduleId:source.id})).data;
 const second=(await f.call('remaps','POST',{...input,sourceScheduleId:first.destinationScheduleId,to:'Material de Consumo',value:100})).data;
 assert.equal((await f.call('remaps/'+first.id,'PATCH',{...first,reason:'Justificativa atualizada'})).status,200);
 assert.equal((await f.call('remaps/'+first.id,'DELETE',{version:2})).status,422);
 assert.equal((await f.call('remaps/'+second.id,'DELETE',{version:1})).status,200);
 assert.equal((await f.call('remaps/'+first.id,'DELETE',{version:2})).status,200);
 assert.equal((await f.call('state')).data.schedule[0].value,1000);f.db.close();
});

test('Recursos: editar valor, tipo e comprovante; conflitos, limites e exclusão',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const input={projectId,kind:'Parcela da subvenção',value:5000,date:'2026-01-01',installment:1,reference:'PIX',notes:''};
 const first=(await f.call('resources','POST',input,{files:{proof:pdf}})).data;
 const second=(await f.call('resources','POST',{...input,installment:2})).data;
 assert.equal((await f.call('resources/'+first.id,'PATCH',{...input,version:1,value:6000})).status,422);
 assert.equal((await f.call('resources/'+first.id,'PATCH',{...input,version:1,installment:2})).status,409);
 assert.equal((await f.call('resources/'+first.id,'PATCH',{...input,version:1,value:4000})).status,200);
 let state=(await f.call('state')).data;const originalDoc=state.resources[0].documents[0].id;assert.equal((await f.call('documents/'+originalDoc)).data,pdf);
 const replacement='%PDF-1.4\nnovo comprovante\n%%EOF';
 assert.equal((await f.call('resources/'+first.id,'PATCH',{...input,version:2,value:1000,kind:'Contrapartida financeira'},{files:{proof:replacement}})).status,200);
 state=(await f.call('state')).data;assert.equal(state.projects[0].released,5000);assert.equal(state.projects[0].counterpartRealized,1000);assert.equal(state.resources[0].installment,null);
 assert.equal((await f.call('documents/'+originalDoc)).status,404);assert.equal((await f.call('documents/'+state.resources[0].documents[0].id)).data,replacement);
 assert.equal((await f.call('resources/'+first.id,'DELETE',{version:2})).status,409);
 assert.equal((await f.call('resources/'+first.id,'DELETE',{version:3})).status,200);
 assert.equal((await f.call('resources/'+second.id,'DELETE',{version:1})).status,200);
 assert.equal((await f.call('resources','POST',input)).status,201);assert.equal(f.db.prepare('SELECT count(*) AS n FROM documents').get().n,0);f.db.close();
});

test('Relatório completo separa fontes, protege HTML e concilia somente subvenção',async()=>{
 const f=await fixture(),projectId=f.projectId;
 await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:1000});
 await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:500,source:'Contrapartida'});
 const sub=(await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',supplier:'<script>alert(1)</script>',value:100},{files:{invoice:pdf,payment:pdf}})).data;
 const own=(await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:200},{files:{invoice:pdf,payment:pdf}})).data;
 await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:50,draft:true});
 assert.equal((await f.call('expenses/'+own.id,'PATCH',{version:1,action:'reconcile',bankReference:'OWN'})).status,422);
 assert.equal((await f.call('expenses/'+sub.id,'PATCH',{version:1,action:'reconcile',bankReference:'PIX'})).status,200);
 for(const [kind,value]of [['Parcela da subvenção',1000],['Contrapartida financeira',500],['Rendimento de aplicação',0.3]])assert.equal((await f.call('resources','POST',{projectId,kind,value,date:'2026-01-01',reference:'QA',installment:1})).status,201);
 const report=(await f.call('reports/'+projectId+'?format=json')).data;
 assert.equal(report.project.executedSubvention,100);assert.equal(report.project.executedCounterpart,200);assert.equal(report.reconciliation.balance,900.3);assert.equal(report.reconciliation.outgoing.length,1);assert.equal(report.reconciliation.incoming.length,2);
 assert.equal(report.expenses.length,3);assert.equal(report.planning.length,2);
 const html=(await f.call('reports/'+projectId+'?format=html')).data;assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/10\. Links e referências/);assert.match(html,/Imprimir \/ Salvar em PDF/);
 const csv=(await f.call('reports/'+projectId)).data;assert.match(csv,/Fonte/);assert.match(csv,/Contrapartida/);
 const second=(await f.call('projects','POST',{...f.project,companyId:f.company.id,code:'R2',name:'Outro projeto'})).data;
 const other=(await f.call('reports/'+second.id+'?format=json')).data;assert.equal(other.expenses.length,0);assert.equal(other.resources.length,0);assert.equal(other.project.executedSubvention,0);f.db.close();
});

test('Migração 3 classifica legado sem apagar contas, documentos ou valores',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'funding-migration-')),path=join(dir,'db.sqlite');let db=openDatabase(path);createUser(db,admin);
 db.prepare('INSERT INTO companies(id,data) VALUES(?,?)').run('c',JSON.stringify({name:'Empresa anterior'}));
 db.prepare('INSERT INTO projects(id,company_id,data) VALUES(?,?,?)').run('p','c',JSON.stringify({approved:10000,counterpart:2000}));
 db.prepare('INSERT INTO budget(id,project_id,data,value_cents) VALUES(?,?,?,?)').run('b','p',JSON.stringify({...budgetRow,fonte:'Contrapartida',elemento:'Consultoria',valorTotal:500}),50000);
 db.prepare('INSERT INTO schedule(id,project_id,data,value_cents) VALUES(?,?,?,?)').run('s','p',JSON.stringify({...schedule,rubric:'Consultoria',value:500}),50000);
 db.prepare('INSERT INTO expenses(id,project_id,data,value_cents) VALUES(?,?,?,?)').run('e','p',JSON.stringify({...expense,rubric:'Consultoria',value:200}),20000);
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run('d','p','e',null,'invoice','old.pdf','application/pdf',Buffer.from(pdf),new Date().toISOString());
 db.exec('DELETE FROM migrations WHERE version=3');db.close();db=openDatabase(path);
 assert.equal(JSON.parse(db.prepare("SELECT data FROM schedule WHERE id='s'").get().data).source,'Contrapartida');
 assert.equal(JSON.parse(db.prepare("SELECT data FROM expenses WHERE id='e'").get().data).source,'Contrapartida');
 assert.equal(db.prepare("SELECT value_cents FROM expenses WHERE id='e'").get().value_cents,20000);
 assert.equal(Buffer.from(db.prepare("SELECT bytes FROM documents WHERE id='d'").get().bytes).toString(),pdf);
 assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) AS n FROM migrations WHERE version=3').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();rmSync(dir,{recursive:true});
});

test('Transferência na mesma rubrica preserva gastos e o status do destino na edição',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const source=(await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:1000})).data;
 assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',value:900})).status,201);
 const result=await f.call('remaps','POST',{projectId,sourceScheduleId:source.id,to:'Consultoria',activity:'Etapa seguinte',month:'Março',year:2026,value:500,reason:'Reprogramar'});assert.equal(result.status,201);
 const target=(await f.call('state')).data.schedule.find(s=>s.id===result.data.destinationScheduleId);
 assert.equal((await f.call('schedule/'+target.id,'PATCH',{...target,status:'Concluída'})).status,200);
 assert.equal((await f.call('remaps/'+result.data.id,'PATCH',{...result.data,value:600,reason:'Reprogramação revisada'})).status,200);
 let state=(await f.call('state')).data;assert.equal(state.schedule.find(s=>s.id===state.remaps[0].destinationScheduleId).status,'Concluída');assert.equal(state.projects[0].executed,900);
 assert.equal((await f.call('remaps/'+result.data.id,'DELETE',{version:2})).status,200);state=(await f.call('state')).data;assert.equal(state.schedule[0].value,1000);f.db.close();
});

function lowerProjectLimit(f,approved) {
 const row=f.db.prepare('SELECT data FROM projects WHERE id=?').get(f.projectId);
 f.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),approved}),f.projectId);
}
test('Excesso legado: edita metadados, reduz em etapas e exclui sem aumentar o excesso',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const item=(await f.call('schedule','POST',{...schedule,projectId,value:8500})).data;
 lowerProjectLimit(f,8000);
 const edit=await f.call('schedule/'+item.id,'PATCH',{...item,activity:'Descrição corrigida',status:'Em andamento'});
 assert.equal(edit.status,200);assert.equal(edit.data.value,8500);
 assert.equal((await f.call('schedule/'+item.id,'PATCH',{...edit.data,value:8600})).status,422);
 const reduced=await f.call('schedule/'+item.id,'PATCH',{...edit.data,value:8300});assert.equal(reduced.status,200);
 assert.equal((await f.call('schedule/'+item.id,'PATCH',{...reduced.data,value:8400})).status,422);
 assert.equal((await f.call('schedule','POST',{...schedule,projectId,value:1})).status,422);
 assert.equal((await f.call('schedule/'+item.id,'DELETE',{version:reduced.data.version})).status,200);
 assert.equal((await f.call('state')).data.schedule.length,0);f.db.close();
});
test('Excesso legado: remanejamento neutro permite criar, editar e reverter; execução continua protegida',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const source=(await f.call('schedule','POST',{...schedule,rubric:expense.rubric,projectId,value:8500})).data;
 lowerProjectLimit(f,8000);
 const data={projectId,sourceScheduleId:source.id,to:'Consultoria',activity:'Consultoria técnica',month:'Março',year:2026,value:500,reason:'Justificativa inicial'};
 const created=await f.call('remaps','POST',data);assert.equal(created.status,201);
 let changed=await f.call('remaps/'+created.data.id,'PATCH',{...created.data,value:800});assert.equal(changed.status,200);
 changed=await f.call('remaps/'+created.data.id,'PATCH',{...changed.data,reason:'Justificativa revisada\nCom segundo parágrafo.'});assert.equal(changed.status,200);
 assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Consultoria',value:100})).status,201);
 assert.equal((await f.call('remaps/'+created.data.id,'DELETE',{version:changed.data.version})).status,422);
 let state=(await f.call('state')).data;assert.equal(state.remaps[0].value,800);assert.equal(state.schedule.reduce((n,r)=>n+r.value,0),8500);
 assert.equal((await f.call('expenses/'+state.expenses[0].id,'DELETE',{version:1})).status,200);
 assert.equal((await f.call('remaps/'+created.data.id,'DELETE',{version:changed.data.version})).status,200);
 state=(await f.call('state')).data;assert.equal(state.schedule.length,1);assert.equal(state.schedule[0].value,8500);f.db.close();
});
test('Déficit legado por rubrica permite metadados e correção sem piorar cobertura nem outra fonte',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const item=(await f.call('schedule','POST',{...schedule,rubric:expense.rubric,projectId,value:500})).data;
 assert.equal((await f.call('expenses','POST',{...expense,projectId,value:400})).status,201);
 const legacy={...item,value:300};f.db.prepare('UPDATE schedule SET data=?,value_cents=? WHERE id=?').run(JSON.stringify(legacy),30000,item.id);
 const updated=await f.call('schedule/'+item.id,'PATCH',{...legacy,status:'Concluída'});assert.equal(updated.status,200);
 assert.equal((await f.call('schedule/'+item.id,'PATCH',{...updated.data,value:299})).status,422);
 const corrected=await f.call('schedule/'+item.id,'PATCH',{...updated.data,value:400});assert.equal(corrected.status,200);
 assert.equal((await f.call('schedule/'+item.id,'DELETE',{version:corrected.data.version})).status,422);
 const other=(await f.call('schedule','POST',{...schedule,projectId,source:'Contrapartida',value:2000})).data;
 assert.equal((await f.call('schedule/'+other.id,'PATCH',{...other,value:2001})).status,422);f.db.close();
});
test('Três orçamentos disponíveis em qualquer rubrica; cinco anexos opcionais e checklist exato',async()=>{
 const f=await fixture(),projectId=f.projectId;
 await f.call('schedule','POST',{...schedule,rubric:expense.rubric,projectId,value:500});
 const item=(await f.call('expenses','POST',{...expense,projectId})).data;
 let entry=(await f.call('state')).data.expenses[0];assert.equal(entry.requiredDocs,5);assert.equal(entry.docs,0);assert.equal(entry.missingDocuments.length,5);
 assert.equal((await f.call('expenses/'+item.id+'/documents','POST',{}, {files:{quote1:pdf,quote2:pdf,quote3:pdf}})).status,201);
 entry=(await f.call('state')).data.expenses[0];assert.equal(entry.docs,3);assert.deepEqual(entry.missingDocuments,['invoice','payment']);
 assert.equal((await f.call('expenses/'+item.id+'/documents','POST',{}, {files:{invoice:pdf,payment:pdf}})).status,201);
 entry=(await f.call('state')).data.expenses[0];assert.equal(entry.docs,5);assert.deepEqual(entry.missingDocuments,[]);f.db.close();
});
test('Documentos gerais: CRUD, bytes originais, idempotência, validação e separação de lançamentos',async()=>{
 const f=await fixture(),projectId=f.projectId,key=randomUUID();
 const request={projectId,name:'Projeto original'},options={key,files:{project:pdf}};
 const created=await f.call('projectDocuments','POST',request,options);assert.equal(created.status,201);
 assert.equal((await f.call('projectDocuments','POST',request,options)).data.id,created.data.id);
 assert.equal(created.data.name,'Projeto original');assert.equal(created.data.bytes,undefined);
 let state=(await f.call('state')).data;assert.equal(state.projectDocuments.length,1);assert.equal(state.expenses.length,0);
 assert.equal(state.projectDocuments[0].filename,'project.pdf');assert.equal((await f.call('projectDocuments/'+created.data.id)).data,pdf);
 const renamed=await f.call('projectDocuments/'+created.data.id,'PATCH',{version:1,name:'Termo de outorga'});assert.equal(renamed.status,200);
 assert.equal((await f.call('projectDocuments/'+created.data.id,'PATCH',{version:1,name:'Versão antiga'})).status,409);
 const replacement=pdf+'\n% revisão';assert.equal((await f.call('projectDocuments/'+created.data.id,'PATCH',{version:2,name:'Termo revisado'},{files:{project:replacement}})).status,200);
 assert.equal((await f.call('projectDocuments/'+created.data.id)).data,replacement);
 assert.equal((await f.call('projectDocuments','POST',request)).status,422);
 assert.equal((await f.call('projectDocuments','POST',{...request,name:''},{files:{project:pdf}})).status,422);
 assert.equal((await f.call('projectDocuments','POST',request,{files:{project:'arquivo falso'}})).status,422);
 assert.equal((await f.call('projectDocuments','POST',request,{files:{invoice:pdf}})).status,422);
 assert.equal((await f.call('projectDocuments','POST',{...request,projectId:'inexistente'},{files:{project:pdf}})).status,404);
 const report=await f.call('reports/'+projectId+'?format=json');assert.equal(report.data.projectDocuments[0].name,'Termo revisado');assert.match(report.response.headers.get('content-disposition'),/attachment/);
 assert.match((await f.call('reports/'+projectId+'?format=html')).data,/Termo revisado/);
 assert.equal((await f.app(new Request(origin+'/api/projectDocuments/'+created.data.id))).status,401);
 createUser(f.db,{...admin,email:'reader@test.example',role:'viewer'});
 const login=await f.call('auth/login','POST',{email:'reader@test.example',password:admin.password});const cookie=login.response.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('projectDocuments/'+created.data.id,'GET',undefined,{headers:{cookie}})).status,200);
 assert.equal((await f.call('projectDocuments/'+created.data.id,'DELETE',{version:3},{headers:{cookie}})).status,403);
 assert.equal((await f.call('projectDocuments/'+created.data.id,'DELETE',{version:3})).status,200);
 assert.equal((await f.call('projectDocuments/'+created.data.id)).status,404);assert.equal((await f.call('state')).data.projectDocuments.length,0);
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);f.db.close();
});
test('Links editáveis: preservam data original, validam URL e detectam versão desatualizada',async()=>{
 const f=await fixture();const item=(await f.call('links','POST',{projectId:f.projectId,name:'Portal',url:'https://example.com'})).data;
 f.db.prepare('UPDATE links SET data=? WHERE id=?').run(JSON.stringify({...item,addedAt:'2020-01-01'}),item.id);
 const edited=await f.call('links/'+item.id,'PATCH',{...item,name:'Portal atualizado',url:'https://example.com/novo'});assert.equal(edited.status,200);assert.equal(edited.data.addedAt,'2020-01-01');
 assert.equal((await f.call('links/'+item.id,'PATCH',{...edited.data,url:'javascript:alert(1)'})).status,422);
 assert.equal((await f.call('links/'+item.id,'PATCH',item)).status,409);assert.equal((await f.call('state')).data.links[0].name,'Portal atualizado');f.db.close();
});

test('Migração 4 preserva banco existente e anexos ao criar o arquivo geral do projeto',async()=>{
 const f=await fixture();await f.call('schedule','POST',{...schedule,projectId:f.projectId,rubric:expense.rubric,value:500});
 await f.call('expenses','POST',{...expense,projectId:f.projectId},{files:{invoice:pdf}});
 const directory=mkdtempSync(join(tmpdir(),'migration4-')),path=join(directory,'legacy.sqlite');
 try {
  f.db.exec('DROP TABLE projectDocuments; DELETE FROM migrations WHERE version=4');await backup(f.db,path);f.db.close();
  let db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) AS n FROM expenses').get().n,1);assert.equal(Buffer.from(db.prepare('SELECT bytes FROM documents').get().bytes).toString(),pdf);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projectDocuments').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);db.close();
  db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) AS n FROM migrations WHERE version=4').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 } finally {rmSync(directory,{recursive:true,force:true});}
});

function excelFixture(bookType,values=[['Rubrica','Fonte','Atividade','Valor','Mês','Ano','Meses'],['Consultoria','Subvenção','Pesquisa, teste; revisão\nSegunda linha',1234.56,'Janeiro',2026,1],['Pró-labore','Contrapartida','Coordenação mensal',500,'Fevereiro',2026,2]],edit) {
 const book=excelUtils.book_new(),sheet=excelUtils.aoa_to_sheet(values);if(edit)edit(sheet);
 excelUtils.book_append_sheet(book,sheet,'Cronograma');
 excelUtils.book_append_sheet(book,excelUtils.aoa_to_sheet([['Não importar esta aba'],['Outros registros']]),'Referência');
 return Buffer.from(writeExcel(book,{bookType,type:'buffer'}));
}
for(const extension of ['xls','xlsx']) {
 test(`Cronograma ${extension}: números formatados, acentos, primeira aba, fontes e pró-labore mensal`,async()=>{
  const bytes=excelFixture(extension,undefined,sheet=>{sheet.D2.z='"R$ "#,##0.00';});
  const result=spreadsheetCsv(bytes,'cronograma.'+extension),rows=csvRecords(result.csv);
  assert.equal(result.sheetName,'Cronograma');assert.equal(rows.length,3);assert.equal(rows[1][3],'1234.56');assert.equal(rows[1][2],'Pesquisa, teste; revisão\nSegunda linha');
  const f=await fixture();
  const imports=rows.slice(1).map(r=>({rubric:r[0],source:r[1],activity:r[2],value:Number(r[3]),month:r[4],year:Number(r[5]),monthsCount:Number(r[6])}));
  const response=await f.call('schedule/import','POST',{projectId:f.projectId,rows:imports});assert.equal(response.status,201);
  const state=(await f.call('state')).data;assert.equal(state.schedule.length,3);assert.equal(state.schedule[0].value,1234.56);assert.equal(state.schedule[1].source,'Contrapartida');assert.equal(state.schedule[2].month,'Março');assert.equal(state.schedule[1].rubric,'Pessoal / Pró-labore');
  const invalid=await f.call('schedule/import','POST',{projectId:f.projectId,rows:[...imports,{...imports[0],value:10000}]});assert.equal(invalid.status,422);assert.equal((await f.call('state')).data.schedule.length,3);f.db.close();
 });
 test(`Documentos ${extension}: upload, nome, MIME, bytes preservados, substituição e restrição aos documentos gerais`,async()=>{
  const f=await fixture(),bytes=excelFixture(extension),name='orçamento.'+extension;
  const added=await f.call('projectDocuments','POST',{projectId:f.projectId,name:'Orçamento original'},{files:{project:bytes},fileNames:{project:name}});assert.equal(added.status,201);
  const expected=extension==='xls'?'application/vnd.ms-excel':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  assert.equal(added.data.mime,expected);assert.equal(added.data.filename,name);
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM projectDocuments WHERE id=?').get(added.data.id).bytes),bytes);
  const download=await f.call('projectDocuments/'+added.data.id);assert.equal(download.response.headers.get('content-type'),expected);assert.equal(Number(download.response.headers.get('content-length')),bytes.length);
  const replacement=excelFixture(extension,[['Dados'],['Revisão']]);assert.equal((await f.call('projectDocuments/'+added.data.id,'PATCH',{version:1,name:'Planilha revisada'},{files:{project:replacement},fileNames:{project:name}})).status,200);
  assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM projectDocuments WHERE id=?').get(added.data.id).bytes),replacement);
  await f.call('schedule','POST',{...schedule,projectId:f.projectId,rubric:expense.rubric,value:1000});
  assert.equal((await f.call('expenses','POST',{...expense,projectId:f.projectId},{files:{invoice:bytes},fileNames:{invoice:name}})).status,422);
  assert.equal((await f.call('projectDocuments','POST',{projectId:f.projectId,name:'Falso'},{files:{project:'a,b,c\n1,2,3'},fileNames:{project:name}})).status,422);
  f.db.close();
 });
}
test('Planilhas rejeitam fórmulas, conteúdo renomeado, arquivos corrompidos, abas vazias e limite de linhas',()=>{
 assert.throws(()=>spreadsheetCsv(Buffer.from('rubrica;valor\nTeste;10'),'falso.xls'),/inválido/);
 assert.throws(()=>spreadsheetCsv(Buffer.from([0x50,0x4b,0x03,0x04]),'corrompido.xlsx'),/íntegro/);
 assert.throws(()=>spreadsheetCsv(excelFixture('xlsx',undefined,s=>{s.D2={t:'n',f:'100+200',v:300};}),'formula.xlsx'),/fórmulas/);
 assert.throws(()=>spreadsheetCsv(excelFixture('xlsx',[]),'vazia.xlsx'),/vazia/);
 assert.throws(()=>spreadsheetCsv(excelFixture('xlsx',Array.from({length:2002},(_,i)=>[String(i)])),'grande.xlsx'),/2.000/);
});
test('Órgão concedente personalizado persiste no projeto e no relatório',async()=>{
 const f=await fixture();
 const data={companyId:f.company.id,name:'Projeto municipal',code:'MUN-01',agency:'Secretaria Municipal de Ciência e Tecnologia',startDate:'2026-01-01',endDate:'2027-12-31',approved:5000,counterpart:1000,installments:1};
 const result=await f.call('projects','POST',data);assert.equal(result.status,201);
 assert.equal((await f.call('state')).data.projects.find(p=>p.id===result.data.id).agency,data.agency);
 assert.equal((await f.call('reports/'+result.data.id+'?format=json')).data.project.agency,data.agency);
 assert.equal((await f.call('projects','POST',{...data,code:'MUN-02',agency:'   '})).status,422);f.db.close();
});

test('Edição do cadastro preserva vínculos, documentos, execução e controla versão e idempotência',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('schedule','POST',{...schedule,rubric:'Material de Consumo',projectId});
  const created=await f.call('expenses','POST',{...expense,projectId},{files:{invoice:pdf}});assert.equal(created.status,201);
  const before=(await f.call('state')).data;
  const data={version:1,name:'Projeto atualizado',code:'TERMO-2026',agency:'Fundação Municipal',approved:12000.50,counterpart:3000.25,startDate:'2026-02-01',endDate:'2028-01-31',installments:4},key=randomUUID();
  const updated=await f.call('projects/'+projectId,'PATCH',data,{key});assert.equal(updated.status,200);assert.equal(updated.data.version,2);
  assert.deepEqual((await f.call('projects/'+projectId,'PATCH',data,{key})).data,updated.data);
  assert.equal((await f.call('projects/'+projectId,'PATCH',data)).status,409);
  const after=(await f.call('state')).data,p=after.projects[0];
  for(const [field,value] of Object.entries(data))if(field!=='version')assert.equal(p[field],value);
  assert.equal(p.id,projectId);assert.equal(p.companyId,f.company.id);assert.equal(p.executed,100.10);assert.equal(p.status,'Em execução');
  assert.deepEqual(after.expenses,before.expenses);assert.deepEqual(after.schedule,before.schedule);
  assert.equal((await f.call('documents/'+after.expenses[0].documents[0].id)).data,pdf);
  const report=(await f.call('reports/'+projectId+'?format=json')).data;assert.equal(report.project.name,data.name);assert.equal(report.project.approved,data.approved);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE entity='projects' AND action='patch'").get().n,1);
  f.db.close();
});
test('Cadastro permite corrigir excesso legado sem bloquear metadados e rejeita reduções incompatíveis',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('schedule','POST',{...schedule,value:8500,projectId});lowerProjectLimit(f,8000);
  let result=await f.call('projects/'+projectId,'PATCH',{version:1,name:'Novo nome'});assert.equal(result.status,200);assert.equal(result.data.planningWarnings[0].excess,500);
  result=await f.call('projects/'+projectId,'PATCH',{version:2,approved:8200});assert.equal(result.status,200);
  const failed=await f.call('projects/'+projectId,'PATCH',{version:3,approved:8100,name:'Não salvar'});assert.equal(failed.status,422);assert.match(failed.data.error,/planejamento/);
  assert.equal((await f.call('state')).data.projects[0].name,'Novo nome');assert.equal((await f.call('state')).data.projects[0].version,3);
  result=await f.call('projects/'+projectId,'PATCH',{version:3,approved:9000});assert.equal(result.status,200);assert.equal(result.data.planningWarnings.length,0);
  result=await f.call('projects/'+projectId,'PATCH',{version:4,approved:8500});assert.equal(result.status,200);
  await f.call('schedule','POST',{...schedule,rubric:'Consultoria',source:'Contrapartida',value:1500,projectId});
  assert.equal((await f.call('projects/'+projectId,'PATCH',{version:5,counterpart:1499})).status,422);
  assert.equal((await f.call('projects/'+projectId,'PATCH',{version:5,counterpart:1500})).status,200);f.db.close();
});
test('Edição de limites protege recursos, despesas de contrapartida e parcelas já recebidas',async()=>{
  const f=await fixture(),projectId=f.projectId;
  for(const item of [{kind:'Parcela da subvenção',installment:2,value:3000},{kind:'Contrapartida financeira',value:500},{kind:'Rendimento de aplicação',value:5000}])assert.equal((await f.call('resources','POST',{...item,projectId,date:'2026-09-01'})).status,201);
  assert.equal((await f.call('expenses','POST',{...expense,projectId,rubric:'Contrapartida',value:800})).status,201);
  for(const data of [{approved:2999},{counterpart:799},{installments:1}])assert.equal((await f.call('projects/'+projectId,'PATCH',{version:1,...data})).status,422);
  const updated=await f.call('projects/'+projectId,'PATCH',{version:1,approved:3000,counterpart:800});assert.equal(updated.status,200);assert.equal(updated.data.counterpartRealized,500);assert.equal(updated.data.executedCounterpart,800);
  f.db.close();
});
test('Cadastro valida campos, duplicidade e empresa, e usuário de consulta não pode editar',async()=>{
  const f=await fixture(),path='projects/'+f.projectId;
  await f.call('projects','POST',{...f.project,code:'OUTRO'});
  for(const data of [{name:''},{agency:''},{approved:0},{approved:1.123},{counterpart:-1},{endDate:'2025-01-01'},{installments:49},{companyId:'outra'}])assert.equal((await f.call(path,'PATCH',{version:1,...data})).status,422);
  assert.equal((await f.call(path,'PATCH',{version:1,code:'OUTRO'})).status,409);
  createUser(f.db,{...admin,email:'viewer-project@test.example',role:'viewer'});
  const login=await f.call('auth/login','POST',{email:'viewer-project@test.example',password:admin.password}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call(path,'PATCH',{version:1,name:'Proibido'},{headers:{cookie}})).status,403);
  assert.equal((await f.call('state')).data.projects[0].version,1);f.db.close();
});
