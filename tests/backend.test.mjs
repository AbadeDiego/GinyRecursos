import { activityExecution } from '../lib/activity-execution.mjs';
import { sourceOf } from '../lib/funding.mjs';
import { schedulePeriod, scheduleStatus, schedulePeriodLabel, parseScheduleCsv, scheduleImportData } from '../lib/schedule.mjs';
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
import {validate} from '../server/validation.mjs';
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
// Older workflow fixtures select the first matching scheduled activity explicitly.
function postExpense(f,data,options) {
 const activity=f.db.prepare('SELECT id,data FROM schedule WHERE project_id=? ORDER BY rowid').all(data.projectId).map(r=>({...JSON.parse(r.data),id:r.id})).find(s=>(s.rubric||s.item)===data.rubric&&sourceOf(s)===sourceOf(data));
 return f.call('expenses','POST',{...data,scheduleId:activity?.id||null},options);
}
const team={name:'Ana',role:'Desenvolvedora',activity:'Desenvolver a plataforma web.'};
const schedule={item:'Plataforma web',activity:'Programar e validar os módulos.',value:2500.35,month:'Janeiro',status:'Não iniciada'};
const budgetRow={fonte:'Subvenção',elemento:'Material de Consumo',descricao:'Insumos',unitario:1000,qtd:5,valorTotal:5000};
const expense={supplier:'Fornecedor',description:'Compra de insumos',rubric:'Material de Consumo',date:'2026-09-23',value:100.10};
const pdf='%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF';
// Simulate expenses already stored before schedule membership was required.
function legacyExpense(f,data) {
  const id=randomUUID(),item=validate('expenses',{...expense,...data});
  f.db.prepare('INSERT INTO expenses(id,project_id,data,value_cents) VALUES(?,?,?,?)').run(id,f.projectId,JSON.stringify(item),Math.round(item.value*100));
  return {...item,id,projectId:f.projectId,version:1};
}


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
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:5000})).status,201);
  const created=(await postExpense(f,{...expense,projectId,draft:true})).data;
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
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:5000})).status,201);
  const data={...expense,projectId};const options={key,files:{invoice:pdf,payment:pdf}};
  const a=await postExpense(f,data,options),b=await postExpense(f,data,options);
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.id,b.data.id);assert.equal((await f.call('state')).data.expenses.length,1);f.db.close();
});
test('Bloqueia documentos falsos, limites de upload e despesa acima do orçamento',async()=>{
  const f=await fixture(),projectId=f.projectId;await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:5000})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId},{files:{invoice:'<script>bad</script>',payment:pdf}})).status,422);
  assert.equal((await postExpense(f,{...expense,projectId,value:5001},{files:{invoice:pdf,payment:pdf}})).status,422);
  assert.equal((await postExpense(f,{...expense,projectId},{files:{invoice:pdf+'x'.repeat(10*1024*1024),payment:pdf}})).status,422);
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
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',value:4000})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',value:0.01})).status,422);
  f.db.close();
});
test('Links bloqueiam javascript e exportação CSV neutraliza fórmulas',async()=>{
  const f=await fixture(),projectId=f.projectId;
  assert.equal((await f.call('links','POST',{projectId,name:'Portal',url:'javascript:alert(1)'})).status,422);
  assert.equal((await f.call('links','POST',{projectId,name:'Portal',url:'https://example.com'})).status,201);
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId,draft:true,supplier:'=1+1'})).status,201);
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
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Licenças de software'})).status,422);
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:'Licenças de software',value:500})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Licenças de software',value:500})).status,201);
  assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:'Contrapartida',source:'Contrapartida',value:2000})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Contrapartida',value:2000})).status,201);
  assert.equal((await postExpense(f,{...expense,projectId,rubric:'Contrapartida',value:0.01})).status,422);
  const state=(await f.call('state')).data;assert.equal(state.projects[0].executed,2500);
  assert.equal(state.expenses[0].missingDocuments.length,5);
  f.db.close();
});
test('Edição e exclusão recalculam saldos, preservam anexos na edição e registram auditoria',async()=>{
  const f=await fixture(),projectId=f.projectId;
  await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500});
  const r=await postExpense(f,{...expense,projectId},{files:{invoice:pdf,payment:pdf}});assert.equal(r.status,201);
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
  const r=(await postExpense(f,{...expense,projectId})).data;
  assert.equal((await f.call('expenses/'+r.id,'PATCH',{version:1,action:'reconcile',bankReference:'PIX'})).status,200);
  const draft=(await postExpense(f,{...expense,projectId,draft:true})).data;
  assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'submit'})).status,200);
  const state=(await f.call('state')).data;assert.equal(state.projects[0].executed,200.20);assert.ok(state.expenses.every(e=>e.docs===0));f.db.close();
});
test('Saldo executado impede reduzir previsão e remanejar depois de gastar',async()=>{
  const f=await fixture(),projectId=f.projectId;
  let source=(await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500})).data;
  assert.equal((await postExpense(f,{...expense,projectId,value:200})).status,201);
  source=(await f.call('state')).data.schedule.find(s=>s.id===source.id);
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
 let counter=imported.data[1];assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:400})).status,201);
 counter=(await f.call('state')).data.schedule.find(s=>s.id===counter.id);
 assert.equal((await f.call('schedule/'+counter.id,'DELETE',{version:counter.version})).status,422);
 assert.equal((await f.call('schedule/'+counter.id,'PATCH',{...counter,source:'Subvenção'})).status,422);
 assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',source:'Subvenção',value:1000})).status,201);
 assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:101})).status,422);
 assert.equal((await f.call('schedule/'+monthly.data[0].id,'DELETE',{version:1})).status,200);
 const state=(await f.call('state')).data;assert.equal(state.projects[0].executedSubvention,1000);assert.equal(state.projects[0].executedCounterpart,400);assert.equal(state.projects[0].executed,1400);
 assert.equal(state.schedule.find(s=>s.id===counter.id).source,'Contrapartida');f.db.close();
});

test('Orçamento legado preserva saldos separados para despesas já existentes',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const rows=[{...budgetRow,unitario:1000,qtd:1,valorTotal:1000},{...budgetRow,fonte:'Contrapartida',unitario:500,qtd:1,valorTotal:500}];
 assert.equal((await f.call('budget/import','POST',{projectId,rows})).status,201);
 const own=legacyExpense(f,{source:'Contrapartida',value:500}),sub=legacyExpense(f,{source:'Subvenção',value:1000});
 assert.equal((await f.call('expenses/'+own.id,'PATCH',{version:1,action:'edit',value:501})).status,422);
 assert.equal((await f.call('expenses/'+own.id,'PATCH',{version:1,action:'edit',description:'Correção contrapartida'})).status,200);
 assert.equal((await f.call('expenses/'+sub.id,'PATCH',{version:1,action:'edit',description:'Correção subvenção'})).status,200);
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
 const expenseResult=(await postExpense(f,{...expense,projectId,rubric:'Bolsa',source:'Contrapartida',value:350})).data;
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
 const sub=(await postExpense(f,{...expense,projectId,rubric:'Consultoria',supplier:'<script>alert(1)</script>',value:100},{files:{invoice:pdf,payment:pdf}})).data;
 const own=(await postExpense(f,{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:200},{files:{invoice:pdf,payment:pdf}})).data;
 await postExpense(f,{...expense,projectId,rubric:'Consultoria',source:'Contrapartida',value:50,draft:true});
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
 legacyExpense(f,{rubric:'Consultoria',value:900});
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
 assert.equal((await postExpense(f,{...expense,projectId,rubric:'Consultoria',value:100})).status,201);
 assert.equal((await f.call('remaps/'+created.data.id,'DELETE',{version:changed.data.version})).status,422);
 let state=(await f.call('state')).data;assert.equal(state.remaps[0].value,800);assert.equal(state.schedule.reduce((n,r)=>n+r.value,0),8500);
 assert.equal((await f.call('expenses/'+state.expenses[0].id,'DELETE',{version:1})).status,200);
 assert.equal((await f.call('remaps/'+created.data.id,'DELETE',{version:changed.data.version})).status,200);
 state=(await f.call('state')).data;assert.equal(state.schedule.length,1);assert.equal(state.schedule[0].value,8500);f.db.close();
});
test('Déficit legado por rubrica permite metadados e correção sem piorar cobertura nem outra fonte',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const item=(await f.call('schedule','POST',{...schedule,rubric:expense.rubric,projectId,value:500})).data;
 legacyExpense(f,{value:400});
 const legacy={...item,value:300};f.db.prepare('UPDATE schedule SET data=?,value_cents=? WHERE id=?').run(JSON.stringify(legacy),30000,item.id);
 const updated=await f.call('schedule/'+item.id,'PATCH',{...legacy,status:'Concluída'});assert.equal(updated.status,200);
 assert.equal((await f.call('schedule/'+item.id,'PATCH',{...updated.data,value:299})).status,422);
 const corrected=await f.call('schedule/'+item.id,'PATCH',{...updated.data,value:400});assert.equal(corrected.status,200);
 assert.equal((await f.call('schedule/'+item.id,'DELETE',{version:corrected.data.version})).status,422);
 const other=(await f.call('schedule','POST',{...schedule,projectId,source:'Contrapartida',value:2000})).data;
 assert.equal((await f.call('schedule/'+other.id,'PATCH',{...other,value:2001})).status,422);f.db.close();
});
test('Rubricas gerais: três orçamentos, cinco anexos opcionais e checklist exato',async()=>{
 const f=await fixture(),projectId=f.projectId;
 await f.call('schedule','POST',{...schedule,rubric:expense.rubric,projectId,value:500});
 const item=(await postExpense(f,{...expense,projectId})).data;
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
 await postExpense(f,{...expense,projectId:f.projectId},{files:{invoice:pdf}});
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
  assert.equal((await postExpense(f,{...expense,projectId:f.projectId},{files:{invoice:bytes},fileNames:{invoice:name}})).status,422);
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
  const created=await postExpense(f,{...expense,projectId},{files:{invoice:pdf}});assert.equal(created.status,201);
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
  legacyExpense(f,{rubric:'Contrapartida',value:800});
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

test('Novos lançamentos e rascunhos exigem rubrica no Cronograma da mesma fonte e projeto',async()=>{
 const f=await fixture(),projectId=f.projectId;
 await f.call('rubrics','POST',{projectId,name:'Licença especial',type:'Custeio'});
 await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
 for(const rubric of ['Material de Consumo','Licença especial','Contrapartida'])for(const draft of [true,false]){
  const r=await postExpense(f,{...expense,projectId,rubric,draft});assert.equal(r.status,422);assert.match(r.data.error,/Cronograma/);
 }
 const second=(await f.call('projects','POST',{...f.project,code:'OUTRO'})).data;
 assert.equal((await f.call('schedule','POST',{...schedule,projectId:second.id,rubric:'Licença especial',value:500})).status,201);
 assert.equal((await postExpense(f,{...expense,projectId,rubric:'Licença especial',draft:true})).status,422);
 assert.equal((await f.call('schedule/import','POST',{projectId,rows:[{...schedule,rubric:'Licença especial',source:'Contrapartida',value:500}]})).status,201);
 assert.equal((await postExpense(f,{...expense,projectId,rubric:'Licença especial',source:'Subvenção',draft:true})).status,422);
 const created=await postExpense(f,{...expense,projectId,rubric:'Licença especial',source:'Contrapartida'});assert.equal(created.status,201);
 assert.equal((await f.call('expenses/'+created.data.id,'PATCH',{version:1,action:'edit',source:'Subvenção'})).status,422);
 assert.equal((await f.call('expenses/'+created.data.id,'PATCH',{version:1,action:'edit',rubric:'Material de Consumo',source:'Subvenção'})).status,422);
 assert.equal((await f.call('state')).data.expenses.length,1);f.db.close();
});
test('Rascunho exige previsão vigente ao registrar e mudança de rubrica usa o Cronograma',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const row=(await f.call('schedule','POST',{...schedule,projectId,rubric:expense.rubric,value:500})).data;
 const draft=legacyExpense(f,{draft:true});assert.ok(draft.id);
 assert.equal((await f.call('schedule/'+row.id,'DELETE',{version:1})).status,200);
 const rejected=await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'submit'});assert.equal(rejected.status,422);assert.match(rejected.data.error,/Cronograma/);
 assert.equal((await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:500})).status,201);
 const target=(await f.call('state')).data.schedule.find(s=>s.rubric==='Consultoria');
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'edit',rubric:'Consultoria',scheduleId:target.id})).status,200);
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:2,action:'submit'})).status,200);
 assert.equal((await f.call('state')).data.projects[0].executed,100.10);f.db.close();
});
test('Despesas antigas permanecem editáveis sem liberar a mesma rubrica para novos lançamentos',async()=>{
 const f=await fixture(),projectId=f.projectId;
 await f.call('budget/import','POST',{projectId,rows:[budgetRow]});
 const old=legacyExpense(f,{value:200});
 const edited=await f.call('expenses/'+old.id,'PATCH',{version:1,action:'edit',supplier:'Fornecedor corrigido',value:150});assert.equal(edited.status,200);
 assert.equal((await postExpense(f,{...expense,projectId})).status,422);
 assert.equal((await f.call('expenses/'+old.id,'PATCH',{version:2,action:'reconcile',bankReference:'PIX'})).status,200);
 assert.equal((await f.call('state')).data.projects[0].executed,150);f.db.close();
});

test('Períodos resolvem mês único, vários meses, virada de ano e legado sem término',()=>{
 const start='2026-09-01';
 assert.deepEqual(schedulePeriod({month:'Setembro'},start),{month:'Setembro',year:2026,endMonth:'Setembro',endYear:2026,duration:1});
 assert.equal(schedulePeriod({month:'Janeiro'},start).year,2027);
 const range={month:'Novembro',year:2026,endMonth:'Fevereiro'};
 assert.equal(schedulePeriod(range,start).endYear,2027);assert.equal(schedulePeriod(range,start).duration,4);
 assert.equal(schedulePeriodLabel(range,start),'Nov/2026–Fev/2027');
 assert.equal(schedulePeriodLabel({month:'Setembro',year:2026,endMonth:'Novembro'},start),'Set–Nov/2026');
 for(const item of [{month:'Inválido'},{month:'Janeiro',endMonth:'Inválido'},{month:'Janeiro',year:1999},{month:'Novembro',year:2026,endMonth:'Janeiro',endYear:2026},{month:'Dezembro',year:2200,endMonth:'Janeiro'}])assert.throws(()=>schedulePeriod(item,start));
});
test('Atraso considera o último mês em Brasília, preserva concluídas e status manual',()=>{
 const item={month:'Agosto',year:2026,endMonth:'Setembro',endYear:2026,status:'Em andamento'},start='2026-01-01';
 assert.equal(scheduleStatus(item,start,new Date('2026-10-01T02:59:59Z')),'Em andamento');
 assert.equal(scheduleStatus(item,start,new Date('2026-10-01T03:00:00Z')),'Atrasada');
 assert.equal(scheduleStatus({...item,status:'Concluída'},start,new Date('2027-01-01')),'Concluída');
 assert.equal(scheduleStatus({...item,status:'Atrasada'},start,new Date('2026-01-01')),'Atrasada');
 assert.equal(scheduleStatus({month:'Setembro',status:'Não iniciada'},start,new Date('2026-10-05')),'Atrasada');
 assert.equal(scheduleStatus({...item,endMonth:'Novembro'},start,new Date('2026-10-05')),'Em andamento');
 assert.equal(scheduleStatus({month:'Setembro',status:'Não iniciada'},undefined,new Date('2026-10-05')),'Não iniciada');
});
test('Prévia CSV aceita formatos novos e antigos, calcula parcelas e aponta períodos inválidos',()=>{
 const start='2026-09-01';
 const old=parseScheduleCsv('Item;Atividade;Valor;Mês;Ano;Meses\nPró-labore;Coordenação;500;Novembro;2026;4',start);assert.deepEqual(old.rows[0].issues,[]);assert.equal(old.rows[0].endMonth,'Fevereiro');assert.equal(old.rows[0].endYear,2027);assert.equal(old.rows[0].monthsCount,4);
 const newCsv='Rubrica;Fonte;Atividade;Valor;Mês inicial;Mês final;Ano inicial;Ano final\nConsultoria;Subvenção;Pesquisa;1.200,50;Setembro;Novembro;2026;2026\nMaterial de Consumo;Contrapartida;Insumos;100;Outubro;;;';
 const result=parseScheduleCsv(newCsv,start);assert.equal(result.error,'');assert.ok(result.rows.every(r=>!r.issues.length));assert.equal(result.rows[0].valor,1200.50);assert.equal(result.rows[0].monthsCount,undefined);assert.equal(result.rows[1].endMonth,'Outubro');
 const invalid=parseScheduleCsv(newCsv+'\nConsultoria;Subvenção;Prazo invertido;10;Dezembro;Janeiro;2026;2026',start);assert.match(invalid.rows[2].issues.join(' '),/anterior/);
 assert.match(parseScheduleCsv('Rubrica;Atividade;Valor\nConsultoria;Pesquisa;100',start).error,/mês inicial/);
 const mismatch=parseScheduleCsv('Rubrica;Atividade;Valor;Mês inicial;Mês final;Ano;Meses\nPró-labore;Gestão;100;Janeiro;Março;2026;2',start);assert.match(mismatch.rows[0].issues.join(' '),/mesma quantidade/);
});
for(const extension of ['xls','xlsx'])test(`Períodos ${extension}: prévia real, importação, edição, relatório e total sem multiplicação`,async()=>{
 const f=await fixture(),projectId=f.projectId;
 const bytes=excelFixture(extension,[['Rubrica','Fonte','Atividade','Valor','Mês inicial','Mês final','Ano inicial','Ano final'],['Consultoria','Subvenção','Atividade longa',1200,'Setembro','Novembro',2026,2026],['Material de Consumo','Contrapartida','Compra pontual',200,'Outubro','Outubro',2026,2026]]);
 const parsed=parseScheduleCsv(spreadsheetCsv(bytes,'periodos.'+extension).csv,f.project.startDate);assert.ok(parsed.rows.every(r=>!r.issues.length));
 const result=await f.call('schedule/import','POST',{projectId,rows:parsed.rows.map(scheduleImportData)});assert.equal(result.status,201);assert.equal(result.data.length,2);assert.equal(result.data[0].endMonth,'Novembro');
 assert.equal(result.data.reduce((sum,r)=>sum+r.value,0),1400);
 const edited=await f.call('schedule/'+result.data[0].id,'PATCH',{...result.data[0],endMonth:'Janeiro',endYear:2027});assert.equal(edited.status,200);assert.equal(edited.data.value,1200);
 const invalid=await f.call('schedule/'+edited.data.id,'PATCH',{...edited.data,endYear:2025});assert.equal(invalid.status,422);assert.equal((await f.call('state')).data.schedule[0].version,2);
 const html=(await f.call('reports/'+projectId+'?format=html')).data;assert.match(html,/Setembro\/2026–Janeiro\/2027/);
 const report=(await f.call('reports/'+projectId+'?format=json')).data;assert.equal(report.schedule[0].endYear,2027);
 const rollback=await f.call('schedule/import','POST',{projectId,rows:[{...schedule,value:1},{...schedule,value:1,year:2026,endMonth:'Janeiro',endYear:2025}]});assert.equal(rollback.status,422);assert.equal((await f.call('state')).data.schedule.length,2);f.db.close();
});
test('Período de pró-labore gera parcelas mensais e preserva o modelo antigo',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const data={...schedule,rubric:'Pessoal / Pró-labore',projectId,month:'Novembro',year:2026,endMonth:'Fevereiro',endYear:2027,value:200};
 const created=await f.call('schedule','POST',data);assert.equal(created.status,201);assert.equal(created.data.length,4);assert.deepEqual(created.data.map(x=>x.month),['Novembro','Dezembro','Janeiro','Fevereiro']);assert.ok(created.data.every(x=>x.month===x.endMonth&&x.year===x.endYear));assert.equal(created.data.reduce((s,x)=>s+x.value,0),800);
 assert.equal((await f.call('schedule','POST',{...data,monthsCount:3})).status,422);
 const first=created.data[0];assert.equal((await f.call('schedule/'+first.id,'PATCH',{...first,endMonth:'Dezembro'})).status,422);
 const old=await f.call('schedule','POST',{...schedule,rubric:'Pessoal / Pró-labore',projectId,month:'Novembro',year:2026,monthsCount:2,value:100});assert.equal(old.status,201);assert.equal(old.data[1].endMonth,'Dezembro');
 f.db.close();
});
test('Registros legados sem mês final recebem período na edição sem perda de valor',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const created=(await f.call('schedule','POST',{...schedule,projectId,value:100})).data;
 const {endMonth,endYear,...old}=created;f.db.prepare('UPDATE schedule SET data=? WHERE id=?').run(JSON.stringify(old),old.id);
 const edited=await f.call('schedule/'+old.id,'PATCH',{...old,activity:'Descrição revisada'});assert.equal(edited.status,200);assert.equal(edited.data.endMonth,old.month);assert.equal(edited.data.endYear,old.year);assert.equal(edited.data.value,100);f.db.close();
});
test('Remanejamento mantém duração do destino ao deslocar o mês inicial',async()=>{
 const f=await fixture(),projectId=f.projectId;
 const origin=(await f.call('schedule','POST',{...schedule,projectId,rubric:'Consultoria',value:500,year:2026})).data;
 const remap=(await f.call('remaps','POST',{projectId,sourceScheduleId:origin.id,to:'Bolsa',activity:'Pesquisa',month:'Novembro',year:2026,value:100,reason:'Planejamento'})).data;
 const destination=(await f.call('state')).data.schedule.find(s=>s.id===remap.destinationScheduleId);
 assert.equal((await f.call('schedule/'+destination.id,'PATCH',{...destination,endMonth:'Janeiro',endYear:2027})).status,200);
 assert.equal((await f.call('remaps/'+remap.id,'PATCH',{...remap,month:'Dezembro'})).status,200);
 const shifted=(await f.call('state')).data.schedule.find(s=>s.id===destination.id);assert.equal(shifted.month,'Dezembro');assert.equal(shifted.endMonth,'Fevereiro');assert.equal(shifted.endYear,2027);
 const remapped=await f.call('remaps/'+remap.id,'PATCH',{...remap,version:2,month:'Dezembro',value:120});assert.equal(remapped.status,200);
 const replaced=(await f.call('state')).data.schedule.find(s=>s.id===remapped.data.destinationScheduleId);assert.equal(replaced.endMonth,'Fevereiro');assert.equal(replaced.endYear,2027);assert.equal(replaced.value,120);f.db.close();
});

async function activityFixture(f,overrides={}) {
 const result=await f.call('schedule','POST',{...schedule,projectId:f.projectId,rubric:'Serviços de Terceiros - PJ',activity:'Desenvolvimento web',value:1000,year:2026,...overrides});assert.equal(result.status,201);return result.data;
}
const allocatedExpense=(f,item,extra={})=>({...expense,projectId:f.projectId,rubric:item.rubric,source:sourceOf(item),scheduleId:item.id,value:100,...extra});
test('Atividades da mesma rubrica têm percentuais independentes; edição e exclusão recalculam sem duplicar',async()=>{
 const f=await fixture(),a=await activityFixture(f),b=await activityFixture(f,{activity:'Identidade visual'});
 const first=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf}})).data;
 const second=await f.call('expenses','POST',allocatedExpense(f,b,{value:250}));assert.equal(second.status,201);
 assert.equal((await f.call('expenses','POST',allocatedExpense(f,a,{value:900,draft:true}))).status,201);
 let report=(await f.call('reports/'+f.projectId+'?format=json')).data;
 assert.deepEqual(report.activityExecution.activities.map(x=>[x.executed,x.executionPercent]),[[100,10],[250,25]]);assert.equal(report.project.executed,350);
 const before=(await f.call('state')).data.expenses.find(e=>e.id===first.id),documentId=before.documents[0].id;
 const edited=await f.call('expenses/'+first.id,'PATCH',{version:1,action:'edit',scheduleId:b.id,value:150});assert.equal(edited.status,200);
 report=(await f.call('reports/'+f.projectId+'?format=json')).data;assert.deepEqual(report.activityExecution.activities.map(x=>x.executionPercent),[0,40]);assert.equal(report.project.executed,400);
 assert.equal((await f.call('documents/'+documentId)).data,pdf);
 assert.equal((await f.call('expenses/'+first.id,'PATCH',{version:1,action:'edit',scheduleId:a.id})).status,409);
 assert.equal((await f.call('expenses/'+first.id,'DELETE',{version:2})).status,200);
 report=(await f.call('reports/'+f.projectId+'?format=json')).data;assert.deepEqual(report.activityExecution.activities.map(x=>x.executionPercent),[0,25]);assert.equal(report.project.executed,250);
 const state=(await f.call('state')).data;assert.equal(state.expenses.find(e=>e.id===second.data.id).scheduleActivity,b.activity);
 const html=(await f.call('reports/'+f.projectId+'?format=html')).data;assert.match(html,/Execução financeira por atividade/);assert.match(html,/25%/);
 const csv=(await f.call('reports/'+f.projectId)).data;assert.match(csv,/ID da atividade/);assert.ok(csv.includes(b.id));assert.match(csv,/Identidade visual/);f.db.close();
});
test('Vínculo obrigatório e validado por projeto, fonte e rubrica, inclusive em rascunhos',async()=>{
 const f=await fixture(),a=await activityFixture(f),different=await activityFixture(f,{rubric:'Consultoria'}),own=await activityFixture(f,{source:'Contrapartida'});
 const otherProject=(await f.call('projects','POST',{...f.project,code:'ACT-2'})).data;
 const other=await activityFixture(f,{projectId:otherProject.id});
 for(const draft of [false,true])for(const id of [null,'',other.id,different.id,own.id]){
  const result=await f.call('expenses','POST',allocatedExpense(f,a,{scheduleId:id,draft}));assert.equal(result.status,422);
 }
 assert.equal((await f.call('expenses','POST',allocatedExpense(f,a,{scheduleId:'missing'}))).status,404);
 const created=(await f.call('expenses','POST',allocatedExpense(f,a))).data;
 for(const data of [{scheduleId:null},{scheduleId:own.id},{scheduleId:other.id},{source:'Contrapartida'},{rubric:'Consultoria'}])assert.equal((await f.call('expenses/'+created.id,'PATCH',{version:1,action:'edit',...data})).status,422);
 assert.equal((await f.call('expenses/'+created.id,'PATCH',{version:1,action:'edit',scheduleId:own.id,source:'Contrapartida'})).status,200);
 assert.equal((await f.call('state')).data.projects[0].executedCounterpart,100);f.db.close();
});
test('Saldo é protegido por atividade em centavos, mesmo com saldo em outra atividade; reenvio não duplica',async()=>{
 const f=await fixture(),a=await activityFixture(f,{value:100.30}),b=await activityFixture(f,{value:2000,activity:'Outro serviço'}),key=randomUUID(),data=allocatedExpense(f,a,{value:100.30});
 const one=await f.call('expenses','POST',data,{key}),repeat=await f.call('expenses','POST',data,{key});assert.equal(one.status,201);assert.equal(one.data.id,repeat.data.id);
 const blocked=await f.call('expenses','POST',allocatedExpense(f,a,{value:0.01}));assert.equal(blocked.status,422);assert.match(blocked.data.error,/atividade/);
 const draft=(await f.call('expenses','POST',allocatedExpense(f,a,{value:50,draft:true}))).data;
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'submit'})).status,422);
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:1,action:'edit',scheduleId:b.id})).status,200);
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{version:2,action:'submit'})).status,200);
 const report=(await f.call('reports/'+f.projectId+'?format=json')).data;assert.equal(report.activityExecution.activities[0].executionPercent,100);assert.equal(report.activityExecution.activities[1].executed,50);assert.equal(report.project.executed,150.30);f.db.close();
});
test('Cronograma protege os vínculos, o valor executado e rascunhos; renomear mantém a atividade',async()=>{
 const f=await fixture(),a=await activityFixture(f),b=await activityFixture(f,{activity:'Etapa B'});
 const created=(await f.call('expenses','POST',allocatedExpense(f,a,{value:500}))).data;
 Object.assign(a,(await f.call('state')).data.schedule.find(s=>s.id===a.id));
 for(const change of [{value:499},{source:'Contrapartida'}])assert.equal((await f.call('schedule/'+a.id,'PATCH',{...a,...change})).status,422);
 assert.equal((await f.call('schedule/'+a.id,'DELETE',{version:a.version})).status,422);
 const changed=await f.call('schedule/'+a.id,'PATCH',{...a,activity:'Web revisado',value:600});assert.equal(changed.status,200);
 assert.equal((await f.call('state')).data.expenses[0].scheduleActivity,'Web revisado');
 assert.equal((await f.call('remaps','POST',{projectId:f.projectId,sourceScheduleId:a.id,to:a.rubric,activity:'Outra etapa',month:'Março',year:2026,value:200,reason:'Transferir saldo'})).status,422);
 const draft=(await f.call('expenses','POST',allocatedExpense(f,b,{draft:true}))).data;
 assert.equal((await f.call('schedule/'+b.id,'DELETE',{version:1})).status,422);
 assert.throws(()=>f.db.prepare('DELETE FROM schedule WHERE id=?').run(b.id),/FOREIGN KEY/);
 assert.equal((await f.call('expenses/'+created.id,'PATCH',{version:1,action:'edit',scheduleId:b.id})).status,200);
 assert.equal((await f.call('schedule/'+a.id,'DELETE',{version:(await f.call('state')).data.schedule.find(s=>s.id===a.id).version})).status,200);
 assert.equal((await f.call('state')).data.expenses.find(e=>e.id===draft.id).scheduleId,b.id);f.db.close();
});
test('Remanejamento com destino vinculado mantém o ID e documentos ao editar valores',async()=>{
 const f=await fixture(),a=await activityFixture(f);
 const remap=(await f.call('remaps','POST',{projectId:f.projectId,sourceScheduleId:a.id,to:'Consultoria',activity:'Pesquisa',month:'Março',year:2026,value:400,reason:'Pesquisa necessária'})).data;
 const destination=(await f.call('state')).data.schedule.find(s=>s.id===remap.destinationScheduleId);
 const expense=(await f.call('expenses','POST',allocatedExpense(f,destination,{value:300}),{files:{invoice:pdf}})).data;
 assert.equal((await f.call('remaps/'+remap.id,'PATCH',{...remap,value:500})).status,200);
 assert.equal((await f.call('remaps/'+remap.id,'PATCH',{...remap,version:2,value:299})).status,422);
 assert.equal((await f.call('remaps/'+remap.id,'DELETE',{version:2})).status,422);
 const state=(await f.call('state')).data;assert.equal(state.remaps[0].destinationScheduleId,destination.id);assert.equal(state.expenses[0].scheduleId,destination.id);assert.equal(state.expenses[0].id,expense.id);assert.equal(state.expenses[0].docs,1);
 const report=(await f.call('reports/'+f.projectId+'?format=json')).data;assert.equal(report.activityExecution.activities.find(a=>a.id===destination.id).executionPercent,60);f.db.close();
});
test('Migração 5 preserva despesas e comprovantes sem atribuição automática; vínculo manual atualiza a execução',async()=>{
 const f=await fixture(),a=await activityFixture(f),b=await activityFixture(f,{activity:'Mesmo fornecedor, outra etapa'});
 const old=legacyExpense(f,{rubric:a.rubric,value:250});
 assert.equal((await f.call('expenses/'+old.id+'/documents','POST',{}, {files:{invoice:pdf}})).status,201);
 const directory=mkdtempSync(join(tmpdir(),'activity-migration-')),path=join(directory,'db.sqlite');
 try {
  f.db.exec('DROP INDEX expenses_schedule; ALTER TABLE expenses DROP COLUMN schedule_id; DELETE FROM migrations WHERE version=5');await backup(f.db,path);f.db.close();
  const db=openDatabase(path);assert.equal(db.prepare('SELECT schedule_id FROM expenses').get().schedule_id,null);assert.equal(db.prepare('SELECT count(*) AS n FROM schedule').get().n,2);assert.equal(Buffer.from(db.prepare('SELECT bytes FROM documents').get().bytes).toString(),pdf);
  const app=createApplication(db,{origin});
  const state=await(await app(new Request(origin+'/api/state',{headers:{cookie:f.cookie}}))).json();assert.equal(state.expenses[0].scheduleId,null);assert.equal(state.projects[0].executed,250);
  const summary=activityExecution(state.schedule,state.expenses);assert.equal(summary.unallocated.value,250);assert.ok(summary.activities.every(a=>a.executionPercent===0));
  const response=await app(new Request(origin+'/api/expenses/'+old.id,{method:'PATCH',headers:{origin,cookie:f.cookie,'idempotency-key':randomUUID(),'content-type':'application/json'},body:JSON.stringify({version:state.expenses[0].version,action:'edit',scheduleId:b.id})}));assert.equal(response.status,200);
  const after=await(await app(new Request(origin+'/api/state',{headers:{cookie:f.cookie}}))).json();assert.equal(after.projects[0].executed,250);assert.equal(activityExecution(after.schedule,after.expenses).activities.find(x=>x.id===b.id).executionPercent,25);assert.equal(after.expenses[0].docs,1);
  db.close();const reopened=openDatabase(path);assert.equal(reopened.prepare('SELECT schedule_id FROM expenses').get().schedule_id,b.id);assert.equal(reopened.prepare('SELECT count(*) AS n FROM migrations WHERE version=5').get().n,1);assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length,0);reopened.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('Execução mensal e percentuais não misturam parcelas, projetos ou rascunhos',()=>{
 const activities=[{id:'a',projectId:'p',value:0.30,rubric:'PJ',source:'Subvenção'},{id:'b',projectId:'p',value:10,rubric:'PJ',source:'Subvenção'}];
 const entries=[{id:'1',projectId:'p',scheduleId:'a',rubric:'PJ',source:'Subvenção',value:0.1},{id:'2',projectId:'p',scheduleId:'a',rubric:'PJ',source:'Subvenção',value:0.2},{id:'3',projectId:'p',scheduleId:'b',rubric:'PJ',source:'Subvenção',value:5,draft:true},{id:'4',projectId:'p',rubric:'PJ',source:'Subvenção',value:2}];
 const result=activityExecution(activities,entries);assert.equal(result.activities[0].executionPercent,100);assert.equal(result.activities[0].executed,0.3);assert.equal(result.activities[1].executed,0);assert.equal(result.unallocated.count,1);assert.equal(result.unallocated.value,2);
 const monthly=[{...activities[0],id:'jan',value:500},{...activities[1],id:'fev',value:500}];const paid=[{...entries[0],scheduleId:'jan',value:250}];assert.deepEqual(activityExecution(monthly,paid).activities.map(x=>x.executionPercent),[50,0]);
 assert.equal(activityExecution(activities,[{...entries[0],projectId:'other'}]).activities[0].executed,0);
});

test('Pró-labore exige checklist de três documentos opcionais e recusa orçamentos',async()=>{
 const f=await fixture(),a=await activityFixture(f,{rubric:'Pessoal / Pró-labore',year:2027});
 const data=allocatedExpense(f,a),created=await f.call('expenses','POST',data);assert.equal(created.status,201);
 let e=(await f.call('state')).data.expenses[0];assert.equal(e.requiredDocs,3);assert.equal(e.docs,0);assert.deepEqual(e.missingDocuments,['inss','invoice','payment']);
 const html=(await f.call('reports/'+f.projectId+'?format=html')).data;assert.match(html,/Guia do INSS/);assert.match(html,/Recibo Pró-labore/);assert.doesNotMatch(html,/Orçamento 1/);
 assert.equal((await f.call('expenses','POST',data,{files:{quote1:pdf}})).status,422);assert.equal((await f.call('state')).data.expenses.length,1);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{quote2:pdf}})).status,422);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{inss:'invalid'}})).status,422);
 const key=randomUUID(),uploaded=await f.call('expenses/'+e.id+'/documents','POST',{}, {key,files:{inss:pdf,invoice:pdf,payment:pdf}});assert.equal(uploaded.status,201);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {key,files:{inss:pdf,invoice:pdf,payment:pdf}})).status,201);
 e=(await f.call('state')).data.expenses[0];assert.equal(e.docs,3);assert.equal(e.documents.length,3);assert.deepEqual(e.missingDocuments,[]);
 assert.equal((await f.call('documents/'+e.documents.find(d=>d.kind==='inss').id)).data,pdf);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{inss:pdf}})).status,409);f.db.close();
});
test('Troca de rubrica preserva anexos antigos sem contar orçamentos no Pró-labore',async()=>{
 const f=await fixture(),a=await activityFixture(f),p=await activityFixture(f,{rubric:'Pessoal / Pró-labore'});
 const created=await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf,payment:pdf,quote1:pdf,quote2:pdf,quote3:pdf}});assert.equal(created.status,201);
 assert.equal((await f.call('expenses/'+created.data.id+'/documents','POST',{}, {files:{inss:pdf}})).status,422);
 assert.equal((await f.call('expenses/'+created.data.id,'PATCH',{version:1,action:'edit',rubric:p.rubric,scheduleId:p.id})).status,200);
 let e=(await f.call('state')).data.expenses[0];assert.equal(e.documents.length,5);assert.equal(e.docs,2);assert.equal(e.requiredDocs,3);assert.deepEqual(e.missingDocuments,['inss']);
 for(const doc of e.documents)assert.equal((await f.call('documents/'+doc.id)).data,pdf);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{inss:pdf}})).status,201);
 e=(await f.call('state')).data.expenses[0];assert.equal(e.docs,3);assert.equal(e.documents.length,6);f.db.close();
});
test('Status automático distingue atividade e fonte, ignora rascunhos e recalcula ao mover, editar e excluir',async()=>{
 const f=await fixture(),a=await activityFixture(f,{value:100.30,year:2027}),b=await activityFixture(f,{value:100.30,year:2027,activity:'Etapa B'}),c=await activityFixture(f,{value:100.30,year:2027,source:'Contrapartida'});
 const get=async id=>(await f.call('state')).data.schedule.find(s=>s.id===id);
 const draft=(await f.call('expenses','POST',allocatedExpense(f,a,{value:100.30,draft:true}))).data;
 assert.equal((await get(a.id)).status,'Não iniciada');assert.equal((await get(a.id)).version,1);
 const key=randomUUID(),data=allocatedExpense(f,b,{value:25.10});const e=(await f.call('expenses','POST',data,{key})).data;
 assert.equal((await get(b.id)).status,'Em andamento');assert.equal((await get(b.id)).statusAutomatic,true);const version=(await get(b.id)).version;
 assert.equal((await f.call('expenses','POST',data,{key})).status,201);assert.equal((await get(b.id)).version,version);
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{action:'submit',version:1})).status,200);assert.equal((await get(a.id)).status,'Concluída');assert.equal((await get(c.id)).status,'Não iniciada');
 assert.equal((await f.call('schedule/'+a.id,'PATCH',{...a,activity:'stale'})).status,409);
 assert.equal((await f.call('expenses/'+draft.id,'PATCH',{action:'edit',version:2,scheduleId:c.id,source:'Contrapartida'})).status,200);assert.equal((await get(a.id)).status,'Não iniciada');assert.equal((await get(c.id)).status,'Concluída');
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'edit',version:1,value:100.30})).status,200);assert.equal((await get(b.id)).status,'Concluída');
 assert.equal((await f.call('expenses/'+e.id,'DELETE',{version:2})).status,200);assert.equal((await get(b.id)).status,'Não iniciada');
 const html=(await f.call('reports/'+f.projectId+'?format=html')).data;assert.match(html,/Concluída/);assert.ok(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='automatic-status'").get().n>=6);f.db.close();
});
test('Status segue previsão e remanejamento, protege conclusão automática e mantém sinalização de atraso',async()=>{
 const f=await fixture(),a=await activityFixture(f,{value:100,year:2020});
 await f.call('expenses','POST',allocatedExpense(f,a,{value:50}));
 const get=async()=>(await f.call('state')).data.schedule.find(s=>s.id===a.id);
 assert.equal(scheduleStatus(await get(),f.project.startDate,new Date('2026-10-18')),'Atrasada');
 let current=await get();let changed=await f.call('schedule/'+a.id,'PATCH',{...current,value:50,status:'Não iniciada'});assert.equal(changed.status,200);assert.equal(changed.data.status,'Concluída');assert.equal(scheduleStatus(changed.data,f.project.startDate),'Concluída');
 current=await get();changed=await f.call('schedule/'+a.id,'PATCH',{...current,value:100,status:'Concluída'});assert.equal(changed.status,200);assert.equal(changed.data.status,'Em andamento');
 const remap=(await f.call('remaps','POST',{projectId:f.projectId,sourceScheduleId:a.id,to:'Consultoria',activity:'Outra etapa',month:'Março',year:2027,value:50,reason:'Transferir saldo livre'})).data;
 assert.ok(remap.id);assert.equal((await get()).status,'Concluída');
 assert.equal((await f.call('remaps/'+remap.id,'DELETE',{version:1})).status,200);assert.equal((await get()).status,'Em andamento');f.db.close();
});
test('Migração 6 atualiza atividades já executadas uma única vez e preserva valores e documentos',async()=>{
 const f=await fixture(),a=await activityFixture(f,{rubric:'Pessoal / Pró-labore',value:100}),b=await activityFixture(f,{value:100});
 await f.call('expenses','POST',allocatedExpense(f,a,{value:100}),{files:{inss:pdf,invoice:pdf,payment:pdf}});
 await f.call('expenses','POST',allocatedExpense(f,b,{value:100,draft:true}));
 f.db.exec("UPDATE schedule SET data=json_remove(json_set(data,'$.status','Não iniciada'),'$.statusAutomatic'); DELETE FROM migrations WHERE version=6");
 const dir=mkdtempSync(join(tmpdir(),'progress-migration-')),path=join(dir,'db.sqlite');
 try{await backup(f.db,path);f.db.close();let db=openDatabase(path);
 const row=db.prepare('SELECT * FROM schedule WHERE id=?').get(a.id);assert.equal(JSON.parse(row.data).status,'Concluída');assert.equal(JSON.parse(row.data).statusAutomatic,true);assert.equal(row.value_cents,10000);
 assert.equal(JSON.parse(db.prepare('SELECT data FROM schedule WHERE id=?').get(b.id).data).status,'Não iniciada');
 assert.equal(db.prepare('SELECT count(*) AS n FROM documents').get().n,3);assert.equal(Buffer.from(db.prepare("SELECT bytes FROM documents WHERE kind='inss'").get().bytes).toString(),pdf);
 const version=row.version;db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT version FROM schedule WHERE id=?').get(a.id).version,version);assert.equal(db.prepare('SELECT count(*) AS n FROM migrations WHERE version=6').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Diárias: dois anexos opcionais, pendências corretas e orçamentos recusados nas duas fontes',async()=>{
 const f=await fixture();
 for(const [rubric,source] of [['Diária','Subvenção'],['Diárias','Contrapartida']]) {
  if(rubric==='Diárias')assert.equal((await f.call('rubrics','POST',{projectId:f.projectId,name:rubric,type:'Custeio'})).status,201);
  const a=await activityFixture(f,{rubric,source});
  const data=allocatedExpense(f,a),created=await f.call('expenses','POST',data);assert.equal(created.status,201);
  let e=(await f.call('state')).data.expenses.find(e=>e.id===created.data.id);
  assert.equal(e.requiredDocs,2);assert.equal(e.docs,0);assert.deepEqual(e.missingDocuments,['invoice','payment']);
  const html=(await f.call('reports/'+f.projectId+'?format=html')).data;assert.match(html,/Recibo de diária/);assert.doesNotMatch(html,/Orçamento [123]/);
  for(const kind of ['quote1','quote2','quote3','inss']) {
   assert.equal((await f.call('expenses','POST',data,{files:{[kind]:pdf}})).status,422);
   assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{[kind]:pdf}})).status,422);
  }
  assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{invoice:pdf}})).status,201);
  e=(await f.call('state')).data.expenses.find(x=>x.id===e.id);assert.equal(e.docs,1);assert.deepEqual(e.missingDocuments,['payment']);
  const key=randomUUID();for(let i=0;i<2;i++)assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {key,files:{payment:pdf}})).status,201);
  e=(await f.call('state')).data.expenses.find(x=>x.id===e.id);assert.equal(e.docs,2);assert.equal(e.documents.length,2);assert.deepEqual(e.missingDocuments,[]);
  for(const doc of e.documents)assert.equal((await f.call('documents/'+doc.id)).data,pdf);
 }
 assert.equal((await f.call('state')).data.expenses.length,2);f.db.close();
});
test('Diárias preservam orçamentos anteriores sem contá-los no checklist; outras rubricas mantêm seus anexos',async()=>{
 const {expenseDocumentLabels,expenseDocumentKeys}=await import('../lib/expense-documents.mjs');
 for(const rubric of ['Diária','Diárias',' DIARIAS ','diaria'])assert.deepEqual(expenseDocumentLabels({rubric}),{invoice:'Recibo de diária',payment:'Comprovante de pagamento'});
 assert.equal(expenseDocumentKeys({rubric:'Pessoal / Pró-labore'}).length,3);assert.equal(expenseDocumentKeys({rubric:'Serviços de Terceiros - PJ'}).length,5);
 const f=await fixture(),a=await activityFixture(f),d=await activityFixture(f,{rubric:'Diária'});
 const e=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf,payment:pdf,quote1:pdf,quote2:pdf,quote3:pdf}})).data;
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{version:1,action:'edit',rubric:d.rubric,scheduleId:d.id})).status,200);
 const changed=(await f.call('state')).data.expenses[0];assert.equal(changed.requiredDocs,2);assert.equal(changed.docs,2);assert.equal(changed.documents.length,5);assert.deepEqual(changed.missingDocuments,[]);
 for(const doc of changed.documents)assert.equal((await f.call('documents/'+doc.id)).data,pdf);
 const csv=(await f.call('reports/'+f.projectId)).data;assert.match(csv,/2\/2/);f.db.close();
});

test('Editar rubrica da previsão reclassifica só os lançamentos vinculados, preservando anexos e conciliação',async()=>{
 const f=await fixture(),a=await activityFixture(f),b=await activityFixture(f,{activity:'Outra atividade PJ'});
 const e=(await f.call('expenses','POST',allocatedExpense(f,a,{value:300}),{files:{invoice:pdf,payment:pdf,quote1:pdf,quote2:pdf,quote3:pdf}})).data;
 const draft=(await f.call('expenses','POST',allocatedExpense(f,a,{value:200,draft:true}))).data;
 const other=(await f.call('expenses','POST',allocatedExpense(f,b))).data;
 const second=(await f.call('projects','POST',{...f.project,code:'RUB-2'})).data;
 const external=await activityFixture(f,{projectId:second.id});
 const externalExpense=(await f.call('expenses','POST',{...allocatedExpense(f,external),projectId:second.id})).data;
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{version:1,action:'reconcile',bankReference:'BANK-123'})).status,200);
 const before=(await f.call('state')).data,current=before.schedule.find(s=>s.id===a.id),key=randomUUID(),data={...current,rubric:'Diária'};
 const changed=await f.call('schedule/'+a.id,'PATCH',data,{key});assert.equal(changed.status,200);assert.equal(changed.data.id,a.id);assert.equal(changed.data.rubric,'Diária');assert.equal(changed.data.item,'Diária');
 const repeated=await f.call('schedule/'+a.id,'PATCH',data,{key});assert.deepEqual(repeated.data,changed.data);
 const after=(await f.call('state')).data,expenseAfter=after.expenses.find(x=>x.id===e.id),draftAfter=after.expenses.find(x=>x.id===draft.id);
 assert.equal(expenseAfter.rubric,'Diária');assert.equal(expenseAfter.value,300);assert.equal(expenseAfter.scheduleId,a.id);assert.equal(expenseAfter.status,'Conciliado');assert.equal(expenseAfter.bankReference,'BANK-123');assert.equal(expenseAfter.version,3);
 assert.equal(expenseAfter.docs,2);assert.equal(expenseAfter.requiredDocs,2);assert.deepEqual(expenseAfter.documents,before.expenses.find(x=>x.id===e.id).documents);
 for(const doc of expenseAfter.documents)assert.equal((await f.call('documents/'+doc.id)).data,pdf);
 assert.equal(draftAfter.rubric,'Diária');assert.equal(draftAfter.draft,true);assert.equal(draftAfter.version,2);
 for(const id of [other.id,externalExpense.id])assert.deepEqual(after.expenses.find(x=>x.id===id),before.expenses.find(x=>x.id===id));
 assert.equal(after.projects.find(x=>x.id===f.projectId).executedSubvention,400);assert.equal(after.schedule.find(s=>s.id===a.id).status,'Em andamento');
 const report=(await f.call('reports/'+f.projectId+'?format=json')).data;assert.equal(report.activityExecution.activities.find(s=>s.id===a.id).executionPercent,30);assert.equal(report.planning.find(p=>p.rubric==='Diária').executed,300);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{version:2,action:'edit',description:'Edição antiga'})).status,409);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='reclassify-rubric'").get().n,2);f.db.close();
});
test('Reclassificação inválida reverte previsão, lançamentos, rubrica nova e auditoria juntos',async()=>{
 const f=await fixture(),a=await activityFixture(f,{value:500});await f.call('expenses','POST',allocatedExpense(f,a,{value:400}),{files:{invoice:pdf}});
 const before=(await f.call('state')).data,current=before.schedule.find(x=>x.id===a.id),audits=f.db.prepare('SELECT count(*) AS n FROM audit').get().n;
 for(const change of [{rubric:'Nova rubrica temporária',value:399},{rubric:'Nova rubrica temporária',value:10001},{rubric:'Consultoria',source:'Contrapartida'}]) {
  const r=await f.call('schedule/'+a.id,'PATCH',{...current,...change});assert.equal(r.status,422);
  if(change.source)assert.match(r.data.error,/mantém a fonte/);
  assert.deepEqual((await f.call('state')).data,before);assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n,audits);
 }
 assert.equal((await f.call('schedule/'+a.id,'PATCH',{...current,rubric:'Consultoria'})).status,200);
 assert.equal((await f.call('schedule/'+a.id,'PATCH',{...current,rubric:'Bolsa'})).status,409);f.db.close();
});
test('Troca de rubrica preserva contrapartida inferida e não reclassifica despesas sem vínculo',async()=>{
 const f=await fixture(),a=await activityFixture(f,{rubric:'Contrapartida',source:'Contrapartida',value:1000}),b=await activityFixture(f,{rubric:'Contrapartida',source:'Contrapartida',value:500});
 const e=(await f.call('expenses','POST',allocatedExpense(f,a,{value:100}))).data;
 f.db.prepare("UPDATE expenses SET data=json_remove(data,'$.source') WHERE id=?").run(e.id);
 const legacy=legacyExpense(f,{rubric:'Contrapartida',source:'Contrapartida',value:100});
 const current=(await f.call('state')).data.schedule.find(x=>x.id===a.id);
 const r=await f.call('schedule/'+a.id,'PATCH',{...current,rubric:'Consultoria'});assert.equal(r.status,200);
 const state=(await f.call('state')).data,updated=state.expenses.find(x=>x.id===e.id);
 assert.equal(updated.rubric,'Consultoria');assert.equal(updated.source,'Contrapartida');assert.equal(state.projects[0].executedCounterpart,200);assert.equal(state.projects[0].executedSubvention,0);
 assert.equal(state.expenses.find(x=>x.id===legacy.id).rubric,'Contrapartida');assert.equal(state.expenses.find(x=>x.id===legacy.id).scheduleId,null);assert.equal(state.schedule.find(x=>x.id===b.id).rubric,'Contrapartida');f.db.close();
});
test('Reclassificação de uma parcela mantém recorrência e checklist sem alterar os demais meses',async()=>{
 const f=await fixture(),monthly=(await f.call('schedule','POST',{projectId:f.projectId,rubric:'Pessoal / Pró-labore',activity:'Coordenação',month:'Janeiro',year:2027,value:300,monthsCount:2})).data;
 const e=(await f.call('expenses','POST',allocatedExpense(f,monthly[0],{value:300}),{files:{inss:pdf,invoice:pdf,payment:pdf}})).data;
 const before=(await f.call('state')).data,current=before.schedule.find(x=>x.id===monthly[0].id);
 const changed=await f.call('schedule/'+current.id,'PATCH',{...current,rubric:'Diária'});assert.equal(changed.status,200);assert.equal(changed.data.recurrenceId,current.recurrenceId);assert.equal(changed.data.installment,1);assert.equal(changed.data.status,'Concluída');
 const after=(await f.call('state')).data;assert.deepEqual(after.schedule.find(x=>x.id===monthly[1].id),before.schedule.find(x=>x.id===monthly[1].id));
 const updated=after.expenses.find(x=>x.id===e.id);assert.equal(updated.docs,2);assert.equal(updated.requiredDocs,2);assert.equal(updated.documents.length,3);assert.equal(after.projects[0].executed,300);f.db.close();
});

test('Editar lançamento substitui arquivo no mesmo link, adiciona pendência e preserva demais anexos e totais',async()=>{
 const f=await fixture(),a=await activityFixture(f);
 const e=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf,payment:pdf}})).data;
 let state=(await f.call('state')).data,original=state.expenses[0],invoice=original.documents.find(d=>d.kind==='invoice'),payment=original.documents.find(d=>d.kind==='payment');
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'reconcile',version:1,bankReference:'extrato-1'})).status,200);
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
 const edited=await f.call('expenses/'+e.id,'PATCH',{action:'edit',version:2,description:'Documento corrigido'},{files:{invoice:png,quote1:pdf},fileNames:{invoice:'nota-corrigida.png'}});assert.equal(edited.status,200);
 state=(await f.call('state')).data;const current=state.expenses[0],doc=current.documents.find(d=>d.kind==='invoice');
 assert.equal(current.version,3);assert.equal(current.description,'Documento corrigido');assert.equal(current.status,'Em análise');assert.equal(current.docs,3);assert.equal(current.documents.length,3);assert.equal(state.projects[0].executed,100);
 assert.equal(doc.id,invoice.id);assert.equal(doc.name,'nota-corrigida.png');assert.equal(doc.mime,'image/png');assert.equal(doc.size,png.length);
 const download=await f.app(new Request(origin+'/api/documents/'+doc.id,{headers:{cookie:f.cookie}}));assert.equal(download.headers.get('content-type'),'image/png');assert.match(download.headers.get('content-disposition'),/nota-corrigida.png/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
 assert.equal((await f.call('documents/'+payment.id)).data,pdf);assert.equal(current.documents.find(d=>d.kind==='payment').id,payment.id);
 const audit=JSON.parse(f.db.prepare("SELECT details FROM audit WHERE action='replace-document' AND entity_id=?").get(doc.id).details);assert.equal(audit.expenseId,e.id);assert.equal(audit.previous.name,invoice.name);assert.equal(audit.name,doc.name);assert.equal(audit.previous.bytes,undefined);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='upload' AND entity='documents'").get().n,1);f.db.close();
});

test('Substituição de anexos respeita versão, idempotência, escopo e ação de edição',async()=>{
 const f=await fixture(),a=await activityFixture(f),e=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf}})).data;
 const other=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf}})).data;
 const input={action:'edit',version:1},key=randomUUID(),replacement=pdf+'\n% atualizado',options={key,files:{invoice:replacement}};
 assert.equal((await f.call('expenses/'+e.id,'PATCH',input,options)).status,200);assert.equal((await f.call('expenses/'+e.id,'PATCH',input,options)).status,200);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',input,{key,files:{invoice:pdf}})).status,409);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',input,{files:{invoice:pdf}})).status,409);
 assert.equal((await f.call('expenses/'+e.id+'/documents','POST',{}, {files:{invoice:pdf}})).status,409);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'reconcile',version:2,bankReference:'ref'},{files:{invoice:pdf}})).status,422);
 const state=(await f.call('state')).data,current=state.expenses.find(x=>x.id===e.id),untouched=state.expenses.find(x=>x.id===other.id);
 assert.equal(current.version,2);assert.equal((await f.call('documents/'+current.documents[0].id)).data,replacement);assert.equal((await f.call('documents/'+untouched.documents[0].id)).data,pdf);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='replace-document'").get().n,1);f.db.close();
});

test('Falhas no segundo anexo, arquivo inválido, tamanho, saldo e permissão revertem toda a edição',async()=>{
 const f=await fixture(),a=await activityFixture(f),e=(await f.call('expenses','POST',allocatedExpense(f,a),{files:{invoice:pdf}})).data;
 const before=(await f.call('state')).data.expenses[0],auditCount=f.db.prepare('SELECT count(*) AS n FROM audit').get().n;
 const input={action:'edit',version:1,description:'Não deve persistir'};
 const cases=[{files:{invoice:pdf+'\n% novo',inss:pdf}},{files:{invoice:'inválido'}},{files:{invoice:Buffer.concat([Buffer.from(pdf),Buffer.alloc(10*1024*1024)])}}];
 for(const options of cases)assert.equal((await f.call('expenses/'+e.id,'PATCH',input,options)).status,422);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{...input,value:1500},{files:{invoice:pdf+'\n% novo'}})).status,422);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n,auditCount);
 createUser(f.db,{name:'Consulta',email:'viewer@test.example',password:admin.password,role:'viewer'});
 const login=await f.call('auth/login','POST',{email:'viewer@test.example',password:admin.password});const cookie=login.response.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('expenses/'+e.id,'PATCH',input,{headers:{cookie},files:{invoice:pdf+'\n% novo'}})).status,403);
 assert.deepEqual((await f.call('state')).data.expenses[0],before);assert.equal((await f.call('documents/'+before.documents[0].id)).data,pdf);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='replace-document'").get().n,0);f.db.close();
});

test('Edição de documentos segue checklist da nova rubrica e preserva rascunho e anexos anteriores',async()=>{
 const f=await fixture(),a=await activityFixture(f),p=await activityFixture(f,{rubric:'Pessoal / Pró-labore'}),d=await activityFixture(f,{rubric:'Diária'});
 const e=(await f.call('expenses','POST',allocatedExpense(f,a,{draft:true}),{files:{invoice:pdf,payment:pdf,quote1:pdf}})).data;
 const replacement=pdf+'\n% recibo revisado';
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'edit',version:1,rubric:p.rubric,scheduleId:p.id},{files:{invoice:replacement,inss:pdf}})).status,200);
 let state=(await f.call('state')).data,current=state.expenses[0];assert.equal(current.draft,true);assert.equal(current.status,'Pendente');assert.equal(current.docs,3);assert.equal(current.requiredDocs,3);assert.equal(current.documents.length,4);assert.equal(state.projects[0].executed,0);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'edit',version:2,rubric:d.rubric,scheduleId:d.id},{files:{invoice:pdf,payment:replacement}})).status,200);
 current=(await f.call('state')).data.expenses[0];assert.equal(current.docs,2);assert.equal(current.requiredDocs,2);assert.equal(current.documents.length,4);assert.equal(current.version,3);
 assert.equal((await f.call('documents/'+current.documents.find(x=>x.kind==='payment').id)).data,replacement);
 assert.equal((await f.call('documents/'+current.documents.find(x=>x.kind==='quote1').id)).data,pdf);
 assert.equal((await f.call('expenses/'+e.id,'PATCH',{action:'edit',version:3},{files:{quote1:replacement}})).status,422);f.db.close();
});
