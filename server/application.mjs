import { randomUUID } from 'node:crypto';
import { bootstrap, createUser, digest, hashPassword, newSession, sessionCookie, sessionUser, verifyPassword } from './auth.mjs';
import { transaction } from './database.mjs';
import { HttpError, check, cents, text, validate, rubrics } from './validation.mjs';

const entities = ['companies','projects','team','schedule','links','expenses','resources','budget','remaps'];
const moneyTables = ['schedule','expenses','resources','budget','remaps'];
const docKinds = ['invoice','payment','quote1','quote2','quote3','support','proof'];
const decode = row => row ? { ...JSON.parse(row.data), id:row.id, ...(row.project_id ? {projectId:row.project_id} : {}), version:row.version } : null;
const required = expense => expense.rubric.includes('Terceiros') ? ['invoice','payment','quote1','quote2','quote3'] : ['invoice','payment'];
const now = () => new Date().toISOString();
const json = (data, status=200, headers={}) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function rows(db, entity, projectId) { return db.prepare(`SELECT * FROM ${entity}${projectId ? ' WHERE project_id=?' : ''} ORDER BY rowid`).all(...(projectId ? [projectId] : [])).map(decode); }
function record(db, entity, id) { const result=decode(db.prepare(`SELECT * FROM ${entity} WHERE id=?`).get(id)); check(result,'Registro não encontrado.',404); return result; }
function audit(db,user,action,entity,id) { db.prepare('INSERT INTO audit(user_id,action,entity,entity_id,created_at) VALUES(?,?,?,?,?)').run(user.id,action,entity,id,now()); }
function insert(db,entity,data,projectId) {
  const id=randomUUID(), columns=['id','data'], values=[id,JSON.stringify(data)];
  if (entity==='projects') { columns.push('company_id'); values.push(data.companyId); }
  else if (entity!=='companies') { columns.push('project_id'); values.push(projectId); }
  if (moneyTables.includes(entity)) { columns.push('value_cents'); values.push(cents(entity==='budget' ? data.valorTotal : data.value,'Valor',entity==='budget'||entity==='schedule')); }
  if (entity==='resources') { columns.push('installment'); values.push(data.installment); }
  db.prepare(`INSERT INTO ${entity}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values);
  return record(db,entity,id);
}
function documents(db, column, id) { return db.prepare(`SELECT id,kind,name,mime,length(bytes) AS size FROM documents WHERE ${column}=?`).all(id); }
function expenseView(db,expense) { const docs=documents(db,'expense_id',expense.id), keys=required(expense); return {...expense,documents:docs,docs:docs.filter(d=>keys.includes(d.kind)).length,requiredDocs:keys.length}; }
function projectView(db,project) {
  const rs=rows(db,'resources',project.id), ex=rows(db,'expenses',project.id);
  const sum=list=>list.reduce((total,item)=>total+cents(item.value),0)/100;
  return {...project,status:project.status==='A iniciar'&&(rs.length||ex.some(e=>!e.draft))?'Em execução':project.status,released:sum(rs.filter(r=>r.kind==='Parcela da subvenção')),counterpartRealized:sum(rs.filter(r=>r.kind==='Contrapartida financeira')),income:sum(rs.filter(r=>r.kind==='Rendimento de aplicação')),executed:sum(ex.filter(e=>!e.draft)),receivedInstallments:rs.filter(r=>r.kind==='Parcela da subvenção').map(r=>r.installment)};
}
export function snapshot(db,user) {
  return {user,companies:rows(db,'companies'),projects:rows(db,'projects').map(p=>projectView(db,p)),team:rows(db,'team'),schedule:rows(db,'schedule'),links:rows(db,'links'),expenses:rows(db,'expenses').reverse().map(e=>expenseView(db,e)),resources:rows(db,'resources').map(r=>({...r,documents:documents(db,'resource_id',r.id)})),budget:rows(db,'budget'),remaps:rows(db,'remaps')};
}
function availableRubric(db,projectId,name) {
  const budget=rows(db,'budget',projectId).filter(b=>b.elemento===name).reduce((s,b)=>s+cents(b.valorTotal,'',true),0);
  const changes=rows(db,'remaps',projectId).filter(r=>r.status==='Aprovado').reduce((s,r)=>s+(r.to===name ? cents(r.value) : r.from===name ? -cents(r.value) : 0),0);
  const spent=rows(db,'expenses',projectId).filter(e=>!e.draft&&e.rubric===name).reduce((s,e)=>s+cents(e.value),0);
  return budget+changes-spent;
}
async function boundedBody(request, limit) {
  check(Number(request.headers.get('content-length') || 0)<=limit,'Arquivo ou requisição muito grande.',413);
  const reader=request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks=[]; let size=0;
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; check(size<=limit,'Arquivo ou requisição muito grande.',413); chunks.push(value); } }
  catch(error) { await reader.cancel(); throw error; }
  return Buffer.concat(chunks);
}
async function payload(request) {
  const multipart=request.headers.get('content-type')?.startsWith('multipart/form-data');
  const bytes=await boundedBody(request,multipart ? 55*1024*1024 : 2*1024*1024);
  if (!bytes.length) return {data:{},files:[],hash:digest(bytes)};
  let data,files=[];
  try {
    if (multipart) {
      const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')},body:bytes}).formData();
      data=JSON.parse(form.get('data'));
      for(const [kind,file] of form.entries()) {
        if (kind==='data') continue;
        check(docKinds.includes(kind) && typeof file!=='string','Tipo de documento inválido.');
        check(file.size>0&&file.size<=10*1024*1024,'Cada arquivo deve ter no máximo 10 MB.');
        check(!files.some(f=>f.kind===kind),'Documento duplicado.');
        const content=Buffer.from(await file.arrayBuffer());
        const mime=content.subarray(0,5).toString()==='%PDF-' ? 'application/pdf' : content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : content[0]===255&&content[1]===216&&content[2]===255 ? 'image/jpeg' : null;
        check(mime,'Envie um arquivo PDF, PNG ou JPEG válido.');
        files.push({kind,name:text(file.name,'Nome do arquivo',200).replace(/[\r\n/\\]/g,'_'),mime,bytes:content});
      }
    } else data=JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch(error) { if(error instanceof HttpError)throw error; throw new HttpError(400,'Conteúdo da requisição inválido.'); }
  check(data && typeof data==='object' && !Array.isArray(data),'Dados inválidos.',400);
  return {data,files,hash:digest(JSON.stringify(data)+files.map(f=>f.kind+f.name+digest(f.bytes)).join('|'))};
}
function storeFiles(db,projectId,entity,id,files) {
  for(const file of files) {
    check(entity==='resources' ? file.kind==='proof' : file.kind!=='proof','Documento incompatível.');
    const col=entity==='expenses' ? 'expense_id' : 'resource_id';
    check(!db.prepare(`SELECT id FROM documents WHERE ${col}=? AND kind=?`).get(id,file.kind),'Já existe um documento desta categoria.',409);
    db.prepare(`INSERT INTO documents(id,project_id,${col},kind,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),projectId,id,file.kind,file.name,file.mime,file.bytes,now());
  }
}
function assertComplete(db,expense,files=[]) {
  const kinds=[...documents(db,'expense_id',expense.id || ''),...files].map(d=>d.kind);
  check(required(expense).every(k=>kinds.includes(k)),'Anexe todos os documentos obrigatórios antes de registrar a despesa.');
}
function csvExport(state, projectId) {
  const list=state.expenses.filter(e=>e.projectId===projectId);
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\ufeff'+[['ID','Data','Fornecedor','Descrição','Rubrica','Valor','Situação','Rascunho','Documentos'],...list.map(e=>[e.id,e.date,e.supplier,e.description,e.rubric,e.value.toFixed(2).replace('.',','),e.status,e.draft?'Sim':'Não',`${e.docs}/${e.requiredDocs}`])].map(r=>r.map(cell).join(';')).join('\r\n');
}

export function createApplication(db,{origin=process.env.APP_ORIGIN || 'http://localhost:3000'}={}) {
  bootstrap(db);
  return async function handle(request) {
    try {
      const url=new URL(request.url), path=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean), method=request.method;
      if(path[0]==='health'&&method==='GET') { db.prepare('SELECT 1').get(); return json({status:'ok'}); }
      if (!['GET','HEAD','OPTIONS'].includes(method)) check(request.headers.get('origin')===origin,'Origem da requisição não permitida.',403);
      if(path.join('/')==='auth/login'&&method==='POST') {
        const {data}=await payload(request); const email=String(data.email||'').trim().toLowerCase();
        const key=digest(email), attempt=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
        check(!attempt||attempt.expires<Date.now()||attempt.attempts<8,'Muitas tentativas. Tente novamente em 15 minutos.',429);
        const account=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
        if(!verifyPassword(data.password,account?.password_hash)) {
          db.prepare('DELETE FROM login_attempts WHERE expires<?').run(Date.now());
          db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key,Date.now()+900000);
          throw new HttpError(401,'E-mail ou senha incorretos.');
        }
        db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
        const token=newSession(db,account.id);
        return json({user:{id:account.id,name:account.name,email:account.email,role:account.role}},200,{'Set-Cookie':sessionCookie(token,origin)});
      }
      const user=sessionUser(db,request); check(user,'Entre na sua conta para continuar.',401);
      if(path.join('/')==='auth/logout'&&method==='POST') { const token=request.headers.get('cookie')?.match(/subvencao_session=([a-f0-9]{64})/)?.[1]; if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); return json({ok:true},200,{'Set-Cookie':sessionCookie('',origin,true)}); }
      if(path.join('/')==='auth/password'&&method==='POST') {
        const {data}=await payload(request), account=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
        check(verifyPassword(data.currentPassword,account.password_hash),'Senha atual incorreta.',403);
        let hash; try{hash=hashPassword(data.password);}catch(e){throw new HttpError(422,e.message);}
        transaction(db,()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);audit(db,user,'password','users',user.id);});
        return json({ok:true},200,{'Set-Cookie':sessionCookie('',origin,true)});
      }
      if(path[0]==='state'&&method==='GET') return json(snapshot(db,user));
      if(path[0]==='users') {
        check(user.role==='admin','Acesso restrito à administração.',403);
        if(method==='GET')return json(db.prepare('SELECT id,name,email,role,active FROM users').all());
        if(method==='POST') { const {data}=await payload(request); let result; try {result=transaction(db,()=>{const u=createUser(db,data);audit(db,user,'create','users',u.id);return u;});}catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'E-mail já cadastrado.');throw new HttpError(422,e.message);} return json(result,201); }
        if(method==='PATCH'&&path[1]) {const {data}=await payload(request);check(path[1]!==user.id,'Não é permitido desativar a própria conta.');check(typeof data.active==='boolean','Situação inválida.');db.prepare('UPDATE users SET active=? WHERE id=?').run(data.active?1:0,path[1]);db.prepare('DELETE FROM sessions WHERE user_id=?').run(path[1]);audit(db,user,'access','users',path[1]);return json({ok:true});}
      }
      if(path[0]==='audit'&&method==='GET') {check(user.role==='admin','Acesso restrito.',403);return json(db.prepare('SELECT a.*,u.name FROM audit a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all());}
      if(path[0]==='documents'&&path[1]&&method==='GET') {
        const file=db.prepare('SELECT * FROM documents WHERE id=?').get(path[1]);check(file,'Arquivo não encontrado.',404);
        return new Response(file.bytes,{headers:{'Content-Type':file.mime,'Content-Length':String(file.bytes.length),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(path[0]==='reports'&&path[1]&&method==='GET') {record(db,'projects',path[1]);const state=snapshot(db,user); if(url.searchParams.get('format')==='json')return json(state.projects.find(p=>p.id===path[1]));return new Response(csvExport(state,path[1]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="lancamentos.csv"','Cache-Control':'no-store'}});}
      check(user.role!=='viewer','Seu perfil permite apenas consulta.',403);
      const entity=path[0]; check(entities.includes(entity),'Rota não encontrada.',404);
      check(['POST','PATCH','DELETE'].includes(method),'Método não permitido.',405);
      const {data,files,hash}=await payload(request);
      const key=request.headers.get('idempotency-key');check(key&&/^[a-zA-Z0-9-]{16,100}$/.test(key),'Identificador da operação ausente.',400);
      const requestHash=digest(method+url.pathname+hash);
      const result=transaction(db,()=>{
        const cached=db.prepare('SELECT * FROM requests WHERE user_id=? AND key=?').get(user.id,key);
        if(cached){check(cached.hash===requestHash,'Identificador reutilizado com outros dados.',409);return JSON.parse(cached.result);}
        let output;
        if(method==='POST'&&path[1]==='import') {
          check(['team','schedule','budget'].includes(entity),'Importação indisponível.'); record(db,'projects',data.projectId);
          check(Array.isArray(data.rows)&&data.rows.length>0&&data.rows.length<=2000,'Importe entre 1 e 2.000 linhas.');
          const validated=data.rows.map(row=>validate(entity,row));
          if(entity==='budget') db.prepare('DELETE FROM budget WHERE project_id=?').run(data.projectId);
          output=validated.map(row=>insert(db,entity,row,data.projectId));
          if(entity==='budget') {
            const p=record(db,'projects',data.projectId);
            check(validated.reduce((sum,row)=>sum+cents(row.valorTotal,'',true),0)<=cents(p.approved)+cents(p.counterpart,'',true),'O orçamento supera a subvenção e a contrapartida previstas.');
            for(const rubric of rubrics)check(availableRubric(db,data.projectId,rubric)>=0,'O orçamento não pode ficar abaixo do valor já executado ou remanejado.');
          }
          audit(db,user,'import',entity,data.projectId);
        } else if(method==='POST'&&path[2]==='documents') {
          check(['expenses','resources'].includes(entity),'Recurso inválido.');const current=record(db,entity,path[1]);check(files.length>0,'Selecione um arquivo.');storeFiles(db,current.projectId,entity,current.id,files);db.prepare(`UPDATE ${entity} SET version=version+1 WHERE id=?`).run(current.id);audit(db,user,'upload',entity,current.id);output={id:current.id};
        } else if(method==='POST'&&!path[1]) {
          const item=validate(entity,data);
          if(entity==='projects'){record(db,'companies',item.companyId);check(!rows(db,'projects').some(p=>p.companyId===item.companyId&&p.code===item.code),'Código de projeto já cadastrado.',409);}
          if(!['companies','projects'].includes(entity)) record(db,'projects',data.projectId);
          if(entity==='resources') {
            const p=projectView(db,record(db,'projects',data.projectId));
            if(item.kind==='Parcela da subvenção'){check(item.installment<=p.installments,'Parcela fora do cronograma.');check(cents(p.released,'',true)+cents(item.value)<=cents(p.approved),'O recurso ultrapassa o valor aprovado.');}
            if(item.kind==='Contrapartida financeira')check(cents(p.counterpartRealized,'',true)+cents(item.value)<=cents(p.counterpart,'',true),'O aporte ultrapassa a contrapartida prevista.');
          }
          if(entity==='expenses'&&!item.draft){assertComplete(db,item,files);check(availableRubric(db,data.projectId,item.rubric)>=cents(item.value),'Saldo insuficiente na rubrica. Importe ou ajuste o orçamento.');}
          output=insert(db,entity,item,data.projectId);
          if(files.length){check(['expenses','resources'].includes(entity),'Anexos não aceitos nesta operação.');storeFiles(db,data.projectId,entity,output.id,files);}
          audit(db,user,'create',entity,output.id);
        } else {
          const current=record(db,entity,path[1]);check(data.version===current.version,'Este registro foi alterado. Atualize a página antes de salvar.',409);
          if(method==='DELETE') {check(['team','schedule','links'].includes(entity),'Este registro financeiro deve ser preservado.',405);db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(current.id);output={id:current.id};}
          else if(entity==='expenses') {
            check(['submit','reconcile'].includes(data.action),'Ação inválida.');
            assertComplete(db,current);
            const next={...current};delete next.version;delete next.id;delete next.projectId;
            if(data.action==='submit'){check(current.draft,'A despesa já foi registrada.',409);check(availableRubric(db,current.projectId,current.rubric)>=cents(current.value),'Saldo insuficiente na rubrica.');next.draft=false;next.status='Em análise';}
            else {check(user.role==='admin','A conciliação exige administrador.',403);check(!current.draft,'Registre a despesa antes de conferir.');next.bankReference=text(data.bankReference,'Referência do extrato',200);next.status='Conciliado';}
            db.prepare('UPDATE expenses SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(next),current.id);output=record(db,entity,current.id);
          } else if(entity==='remaps') {
            check(user.role==='admin','Somente administradores registram a aprovação.',403);check(current.status!=='Aprovado','Remanejamento já aprovado.',409);
            check(availableRubric(db,current.projectId,current.from)>=cents(current.value),'Saldo insuficiente na rubrica de origem.');
            const next={...current,status:'Aprovado',authorization:text(data.authorization,'Referência da autorização',500)};
            db.prepare('UPDATE remaps SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(next),current.id);output=record(db,entity,current.id);
          } else {
            check(['team','schedule','links'].includes(entity),'Edição indisponível para este registro.',405);
            const next=validate(entity,data); const monetary=entity==='schedule';
            db.prepare(`UPDATE ${entity} SET data=?,version=version+1${monetary?',value_cents=?':''} WHERE id=?`).run(JSON.stringify(next),...(monetary?[cents(next.value,'',true)]:[]),current.id);output=record(db,entity,current.id);
          }
          audit(db,user,method.toLowerCase(),entity,current.id);
        }
        db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(user.id,key,requestHash,JSON.stringify(output),Date.now());return output;
      });
      return json(result,method==='POST'?201:200);
    } catch(error) {
      if(error instanceof HttpError)return json({error:error.message},error.status);
      if(String(error.message).includes('UNIQUE constraint'))return json({error:'Já existe um registro com estes dados ou esta parcela.'},409);
      console.error('API failure',error);
      return json({error:'Não foi possível concluir a operação. Tente novamente.'},500);
    }
  };
}
