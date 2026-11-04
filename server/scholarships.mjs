import {randomUUID} from 'node:crypto';
import {check,cents,text,date,choice} from './validation.mjs';
import {scholarshipMonths,scholarshipTotal} from '../lib/scholarships.mjs';
export const scholarshipEntities=['scholarships','scholarshipEntries','scholarshipActivities'];
const decode=r=>r?{...JSON.parse(r.data),id:r.id,version:r.version,...(r.company_id?{companyId:r.company_id,projectId:r.project_id}:{}),...(r.scholarship_id?{scholarshipId:r.scholarship_id}:{})}:null;
export const scholarshipRows=(db,entity)=>db.prepare(`SELECT * FROM ${entity} ORDER BY rowid`).all().map(decode);
function get(db,entity,id) { const item=decode(db.prepare(`SELECT * FROM ${entity} WHERE id=?`).get(id));check(item,'Registro não encontrado.',404);return item; }
function month(value) {check(typeof value==='string'&&/^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(value),'Competência inválida. Use ano e mês.');return value;}
const optional=(v,label,max=10000)=>text(v??'',label,max,true);
const inPeriod=(s,m)=>m>=s.startMonth&&m<=s.endMonth;
function destinations(input, validate) {
  check(Array.isArray(input)&&input.length<=20,'Informe até 20 destinos.');
  const items=input.map((d,i)=>{check(d&&typeof d==='object','Destino inválido.');return {id:d.id?text(d.id,'Identificador do destino',80):randomUUID(),name:text(d.name,'Nome do destino',200),...validate(d,i)};});
  check(new Set(items.map(d=>d.id)).size===items.length,'Destino repetido.');
  check(new Set(items.map(d=>d.name.toLocaleLowerCase('pt-BR'))).size===items.length,'Use nomes distintos para os destinos.');
  return items;
}
function scholarship(db,input,user,current) {
  const companyId=text(input.companyId,'Empresa',80),projectId=input.projectId?text(input.projectId,'Projeto',80):null;
  check(db.prepare('SELECT id FROM companies WHERE id=?').get(companyId),'Empresa não encontrada.',404);
  if(projectId){const project=db.prepare('SELECT company_id FROM projects WHERE id=?').get(projectId);check(project,'Projeto não encontrado.',404);check(project.company_id===companyId,'O projeto deve pertencer à empresa selecionada.');}
  const startMonth=month(input.startMonth),endMonth=month(input.endMonth),months=scholarshipMonths(startMonth,endMonth);
  check(months.length>0,'Informe uma vigência válida de até 120 meses.');
  const beneficiaryType=choice(input.beneficiaryType,['self','thirdParty'],'Beneficiário');
  const beneficiaryName=beneficiaryType==='self'?(current?.beneficiaryType==='self'?current.beneficiaryName:user.name):text(input.beneficiaryName,'Nome do bolsista',200);
  const shares=destinations(input.destinations??[],d=>({percent:cents(d.percent,'Percentual')/100}));
  check(shares.reduce((sum,d)=>sum+Math.round(d.percent*100),0)<=10000,'A soma dos percentuais dos destinos não pode superar 100%.');
  const item={name:text(input.name,'Nome da bolsa',200),companyId,projectId,beneficiaryType,beneficiaryName,ownerUserId:current?.beneficiaryType===beneficiaryType?current.ownerUserId:user.id,monthlyValue:cents(input.monthlyValue,'Valor mensal')/100,startMonth,endMonth,destinations:shares,notes:optional(input.notes,'Observações')};
  if(current){
    const entries=scholarshipRows(db,'scholarshipEntries').filter(e=>e.scholarshipId===current.id);
    if(entries.length)check(companyId===current.companyId&&projectId===current.projectId&&beneficiaryType===current.beneficiaryType&&beneficiaryName===current.beneficiaryName,'Esta bolsa possui lançamentos. Preserve o vínculo e o beneficiário para manter o histórico.');
    check(entries.every(e=>inPeriod(item,e.competence)),'A vigência deve incluir todas as competências já lançadas.');
    check(entries.every(e=>cents(e.value)<=cents(item.monthlyValue)),'O valor mensal não pode ser menor que um lançamento existente.');
    const activities=scholarshipRows(db,'scholarshipActivities').filter(a=>a.scholarshipId===current.id);
    check(activities.every(a=>inPeriod(item,a.dueDate.slice(0,7))),'A vigência deve incluir os prazos das atividades cadastradas.');
  }
  return item;
}
function entry(db,input,s,current) {
  const competence=month(input.competence),value=cents(input.value)/100;
  check(inPeriod(s,competence),'A competência deve estar dentro da vigência da bolsa.');
  check(cents(value)<=cents(s.monthlyValue),'O lançamento supera o valor mensal da bolsa.');
  check(!db.prepare('SELECT id FROM scholarshipEntries WHERE scholarship_id=? AND competence=? AND id<>?').get(s.id,competence,current?.id||''),'Esta competência já foi lançada. Edite o lançamento existente.',409);
  const receivedDate=input.receivedDate?date(input.receivedDate):null;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  check(!receivedDate||receivedDate<=today,'O recebimento não pode ter data futura.');
  const shares=destinations(input.destinations??[],d=>{
    const amount=cents(d.value,'Valor do destino',true)/100,paidDate=d.paidDate?date(d.paidDate):null;
    check(!paidDate||(receivedDate&&paidDate>=receivedDate&&paidDate<=today),'O repasse deve ocorrer entre o recebimento e a data atual.');
    check(!paidDate||amount>0,'Um destino sem valor não pode ter repasse registrado.');
    return {value:amount,paidDate};
  });
  const allocated=shares.reduce((sum,d)=>sum+cents(d.value,'',true),0);
  check(allocated<=cents(value),'A soma dos destinos não pode superar o valor da bolsa.');
  return {competence,value,receivedDate,beneficiaryName:current?.beneficiaryName||s.beneficiaryName,beneficiaryValue:(cents(value)-allocated)/100,destinations:shares,notes:optional(input.notes,'Observações')};
}
function activity(input,s) {
  const dueDate=date(input.dueDate);check(inPeriod(s,dueDate.slice(0,7)),'O prazo da atividade deve estar dentro da vigência da bolsa.');
  return {title:text(input.title,'Atividade',200),description:optional(input.description,'Descrição'),responsible:text(input.responsible,'Responsável',200),dueDate,status:choice(input.status||'Não iniciada',['Não iniciada','Em andamento','Concluída'],'Status'),notes:optional(input.notes,'Acompanhamento')};
}
// Called inside the application's authenticated, idempotent transaction.
export function mutateScholarship(db,{entity,path,method,data,files,user,audit}) {
  check(path.length<3&&(method==='POST'?!path[1]:Boolean(path[1])),'Rota não encontrada.',404);
  check(!files.length,'Anexos não aceitos nesta operação.');
  const current=method==='POST'?null:get(db,entity,path[1]);
  if(current)check(data.version===current.version,'Este registro foi alterado. Atualize a página antes de salvar.',409);
  if(method==='DELETE') {
    if(entity==='scholarships')for(const child of ['scholarshipEntries','scholarshipActivities'])check(!db.prepare(`SELECT id FROM ${child} WHERE scholarship_id=? LIMIT 1`).get(current.id),'Exclua os lançamentos e atividades desta bolsa antes de excluí-la.');
    db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(current.id);audit(db,user,'delete',entity,current.id,current);return {id:current.id};
  }
  const input={...current,...data};let item,parent;
  if(entity==='scholarships')item=scholarship(db,input,user,current);
  else {
    check(!current||data.scholarshipId===undefined||data.scholarshipId===current.scholarshipId,'Não é possível transferir este registro para outra bolsa.');
    parent=get(db,'scholarships',text(current?.scholarshipId||data.scholarshipId,'Bolsa',80));
    if(method==='POST')check(data.scholarshipVersion===parent.version,'O cadastro da bolsa foi alterado. Atualize a página antes de lançar.',409);
    item=entity==='scholarshipEntries'?entry(db,input,parent,current):activity(input,parent);
  }
  const id=current?.id||randomUUID(),json=JSON.stringify(item);
  if(!current){
    if(entity==='scholarships')db.prepare('INSERT INTO scholarships(id,company_id,project_id,data) VALUES(?,?,?,?)').run(id,item.companyId,item.projectId,json);
    else if(entity==='scholarshipEntries')db.prepare('INSERT INTO scholarshipEntries(id,scholarship_id,competence,value_cents,data) VALUES(?,?,?,?,?)').run(id,parent.id,item.competence,cents(item.value),json);
    else db.prepare('INSERT INTO scholarshipActivities(id,scholarship_id,data) VALUES(?,?,?)').run(id,parent.id,json);
  }else if(entity==='scholarships')db.prepare('UPDATE scholarships SET company_id=?,project_id=?,data=?,version=version+1 WHERE id=?').run(item.companyId,item.projectId,json,id);
  else if(entity==='scholarshipEntries')db.prepare('UPDATE scholarshipEntries SET competence=?,value_cents=?,data=?,version=version+1 WHERE id=?').run(item.competence,cents(item.value),json,id);
  else db.prepare('UPDATE scholarshipActivities SET data=?,version=version+1 WHERE id=?').run(json,id);
  audit(db,user,current?'patch':'create',entity,id,current||item);
  return get(db,entity,id);
}
export function scholarshipState(db) {return Object.fromEntries(scholarshipEntities.map(entity=>[entity,scholarshipRows(db,entity)]));}
export function scholarshipTotalFor(db,column,id) {
  return db.prepare(`SELECT * FROM scholarships WHERE ${column}=?`).all(id).map(decode).reduce((sum,s)=>sum+Math.round(scholarshipTotal(s)*100),0)/100;
}
