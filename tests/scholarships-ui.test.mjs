import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,cpSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Optional browser gate, after build. Install Playwright separately or provide
// PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE_PATH for an existing test runtime.
test('Bolsas no navegador: cadastro, divisão, recebimento, repasses, atividades e responsividade', {timeout:180000}, async()=>{
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const dir=mkdtempSync(join(tmpdir(),'bolsas-ui-')),deployed=join(dir,'app'),base='http://127.0.0.1:4327';
 let server,browser,output='',page;
 const screenshot=async name=>{if(process.env.UI_SCREENSHOT_DIR){mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.locator('.sidebar').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await page.screenshot({path:join(process.env.UI_SCREENSHOT_DIR,name+'.png'),fullPage:!(await page.getByRole('dialog').count()),timeout:15000});}};
 try {
  cpSync('.next/standalone',deployed,{recursive:true});cpSync('.next/static',join(deployed,'.next/static'),{recursive:true});cpSync('public',join(deployed,'public'),{recursive:true});for(const folder of ['server','lib'])cpSync(folder,join(deployed,folder),{recursive:true});
  const password=randomUUID();
  server=spawn(process.execPath,[join(deployed,'server.js')],{cwd:deployed,env:{...process.env,NODE_ENV:'production',PORT:'4327',HOSTNAME:'127.0.0.1',APP_ORIGIN:base,DATABASE_PATH:join(dir,'db.sqlite'),ADMIN_NAME:'Gestão de bolsas',ADMIN_EMAIL:'bolsas@example.test',ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(output);await delay(100);}assert.ok(ready,output);
  let cookie='';
  async function call(path,method='GET',data){const r=await fetch(base+'/api/'+path,{method,headers:{origin:base,cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});assert.ok(r.ok,await r.clone().text());if(path==='auth/login')cookie=r.headers.get('set-cookie').split(';')[0];return r.json();}
  await call('auth/login','POST',{email:'bolsas@example.test',password});
  const company=await call('companies','POST',{name:'Empresa de pesquisa',short:'Pesquisa',cnpj:'000',city:'Petrolina',state:'PE',responsible:'Ana',email:'qa@example.test',phone:'000'});
  const other=await call('companies','POST',{...company,name:'Empresa sem projeto',short:'Empresa B',cnpj:'111'});
  const project=await call('projects','POST',{companyId:company.id,name:'Pesquisa de materiais',code:'UI-1',agency:'Fundação',startDate:'2026-01-01',endDate:'2027-12-31',approved:80000,counterpart:4000,installments:2});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-gpu','--no-zygote']});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:'subvencao_session',value:cookie.split('=')[1],url:base}]);page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
  await page.getByRole('button',{name:'Bolsas',exact:true}).click();
  await page.getByRole('button',{name:'Cadastrar bolsa',exact:true}).click();
  let form=page.getByRole('dialog');await form.getByLabel('Nome da bolsa *',{exact:false}).fill('Bolsa de desenvolvimento tecnológico');
  await form.getByLabel('Projeto (opcional)',{exact:false}).selectOption(project.id);
  await form.getByLabel('Beneficiário *',{exact:false}).selectOption('thirdParty');await form.getByLabel('Nome do bolsista *',{exact:false}).fill('Ana Larissa');
  await form.getByLabel('Valor mensal (R$) *',{exact:false}).fill('2000');await form.getByLabel('Competência inicial *',{exact:false}).fill('2026-01');await form.getByLabel('Competência final *',{exact:false}).fill('2026-03');
  for(const [name,percent]of [['Laboratório de materiais','20'],['Gestão do projeto','10']]){await form.getByRole('button',{name:'Adicionar destino',exact:true}).click();await form.getByLabel('Destino *',{exact:false}).last().fill(name);await form.getByLabel('Percentual (%) *',{exact:false}).last().fill(percent);}
  await screenshot('cadastro');
  await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('.scholarship-table tbody tr').first().getByRole('button',{name:'Lançar',exact:true}).click();form=page.getByRole('dialog');
  await form.getByLabel('Recebimento',{exact:false}).selectOption('yes');await form.getByLabel('Data do recebimento *',{exact:false}).fill('2026-02-01');await form.getByLabel('Data do repasse para Laboratório de materiais',{exact:false}).fill('2026-02-02');
  await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByText('Repasses pendentes',{exact:true}).last().waitFor();
  await page.locator('.scholarship-table tbody tr').first().locator('summary').click();await screenshot('desktop');
  await page.getByRole('tab',{name:/Atividades/}).click();await page.getByRole('button',{name:'Adicionar atividade',exact:true}).click();form=page.getByRole('dialog');
  await form.getByLabel('Atividade *',{exact:false}).fill('Entregar relatório técnico');await form.getByLabel('Descrição',{exact:false}).fill('Documentar os resultados e as próximas etapas.');await form.getByLabel('Prazo *',{exact:false}).fill('2026-01-31');await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('.scholarship-activity.overdue').waitFor();await screenshot('atividades');
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();form=page.getByRole('dialog');await form.getByLabel('Status',{exact:false}).selectOption('Concluída');await form.getByLabel('Acompanhamento / resultado',{exact:false}).fill('Relatório entregue e validado.');await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('.scholarship-activity.overdue').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Editar bolsa',exact:true}).click();form=page.getByRole('dialog');assert.equal(await form.getByLabel('Empresa *',{exact:false}).isDisabled(),true);await form.getByLabel('Percentual (%) *',{exact:false}).first().fill('99');assert.equal(await form.getByRole('button',{name:'Salvar',exact:true}).isDisabled(),true);await form.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('tab',{name:/Lançamentos/}).click();await page.locator('.scholarship-table tbody tr').first().getByRole('button',{name:'Editar',exact:true}).click();form=page.getByRole('dialog');await form.getByLabel('Data do repasse para Gestão do projeto',{exact:false}).fill('2026-02-03');await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText('Concluído',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Bolsas',exact:true}).click();await page.getByText('Concluído',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Empresas e projetos',exact:true}).click();assert.ok((await page.locator('.scholarship-total-card').innerText()).includes('6.000,00'));await page.locator('.scholarship-total-card').getByRole('button',{name:'Ver bolsas'}).click();assert.equal(await page.getByLabel(/^Empresa/).inputValue(),company.id);
  await page.getByLabel(/^Empresa/).selectOption(other.id);await page.getByRole('button',{name:'Cadastrar bolsa',exact:true}).click();form=page.getByRole('dialog');await form.getByLabel('Nome da bolsa *',{exact:false}).fill('Bolsa própria da empresa');await form.getByLabel('Valor mensal (R$) *',{exact:false}).fill('1000');await form.getByRole('button',{name:'Salvar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('.scholarship-detail h2').filter({hasText:'Bolsa própria da empresa'}).waitFor();
  const state=await call('state');assert.equal(state.scholarships[1].projectId,null);assert.equal(state.scholarships[1].companyId,other.id);assert.equal(state.scholarships[1].destinations.length,0);assert.equal(state.projects[0].executed,0);assert.equal(state.projects[0].approved,80000);
  await page.setViewportSize({width:390,height:844});await screenshot('mobile');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
  await page.getByRole('button',{name:'Editar bolsa',exact:true}).click();await screenshot('mobile-cadastro');const saveBounds=await page.getByRole('dialog').getByRole('button',{name:'Salvar',exact:true}).boundingBox();assert.ok(saveBounds&&saveBounds.y>=0&&saveBounds.y+saveBounds.height<=844);await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.deepEqual(errors,[]);
 }catch(error){if(page)await screenshot('failure').catch(()=>{});throw error;}
 finally {if(browser)await browser.close();if(server&&server.exitCode===null){await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});}rmSync(dir,{recursive:true,force:true});}
});
