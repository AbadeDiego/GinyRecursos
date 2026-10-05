import { csvRecords } from './csv.mjs';
export const scheduleMonths=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const norm=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const validYear=year=>Number.isInteger(year)&&year>=2000&&year<=2200;
export function schedulePeriod(input,projectStart) {
  const month=input.month, startIndex=scheduleMonths.indexOf(month);
  requireValue(startIndex>=0,'Mês inicial inválido. Use janeiro a dezembro.');
  const projectDate=String(projectStart||'').slice(0,7).split('-').map(Number);
  const year=input.year ?? (projectDate[0]+(startIndex<projectDate[1]-1?1:0));
  requireValue(validYear(year),'Ano inicial inválido. Informe um ano de 2000 a 2200.');
  const endMonth=input.endMonth || month, endIndex=scheduleMonths.indexOf(endMonth);
  requireValue(endIndex>=0,'Mês final inválido. Use janeiro a dezembro.');
  const endYear=input.endYear ?? (year+(endIndex<startIndex?1:0));
  requireValue(validYear(endYear),'Ano final inválido. Informe um ano de 2000 a 2200.');
  const duration=(endYear-year)*12+endIndex-startIndex+1;
  requireValue(duration>=1,'O período final não pode ser anterior ao inicial.');
  return {month,year,endMonth,endYear,duration};
}
export function scheduleStatus(item,projectStart,now=new Date()) {
  if(item.status==='Concluída'||item.status==='Atrasada')return item.status;
  try {
    const p=schedulePeriod(item,projectStart);
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric'}).formatToParts(now);
    const currentYear=Number(parts.find(p=>p.type==='year').value),currentMonth=Number(parts.find(p=>p.type==='month').value)-1;
    if(p.endYear*12+scheduleMonths.indexOf(p.endMonth)<currentYear*12+currentMonth)return 'Atrasada';
  } catch { /* Undated legacy records retain their saved status. */ }
  return item.status || 'Não iniciada';
}
export function schedulePeriodLabel(item,projectStart,compact=true) {
  try {
    const p=schedulePeriod(item,projectStart),label=m=>compact?m.slice(0,3):m;
    if(p.month===p.endMonth&&p.year===p.endYear)return `${label(p.month)}/${p.year}`;
    if(p.year===p.endYear)return `${label(p.month)}–${label(p.endMonth)}/${p.year}`;
    return `${label(p.month)}/${p.year}–${label(p.endMonth)}/${p.endYear}`;
  } catch {return item.month || '—';}
}
export function scheduleImportData(row) {
  return {source:row.source,rubric:row.item,activity:row.atividade,value:row.valor,month:row.mes,year:row.year,endMonth:row.endMonth,endYear:row.endYear,monthsCount:row.monthsCount};
}
export function parseScheduleCsv(text,projectStart) {
  const lines=csvRecords(text);
  if(lines.length<2)return {rows:[],error:'O arquivo precisa ter um cabeçalho e pelo menos uma linha de dados.'};
  const headers=lines[0].map(v=>norm(v).replace(/[^a-z0-9]/g,'')).map(h=>h==='item'?'rubrica':h);
  const required=['rubrica','atividade','valor'];
  const missing=required.filter(h=>!headers.includes(h));
  if(!headers.includes('mesinicial')&&!headers.includes('mes'))missing.push('mês inicial (ou mês)');
  if(missing.length)return {rows:[],error:'Colunas ausentes: '+missing.join(', ')+'.'};
  const rows=lines.slice(1).map(cells=>{
    const cell=h=>String(cells[headers.indexOf(h)]||'').trim();
    const month=v=>scheduleMonths.find(m=>norm(m)===norm(v))||v;
    const rawValue=cell('valor').replace(/R\$/gi,'').replace(/\s/g,'');
    const amount=rawValue.includes(',')?rawValue.replace(/\./g,'').replace(',','.'):rawValue;
    const row={item:cell('rubrica'),atividade:cell('atividade'),valor:amount?Number(amount):NaN,mes:month(cell('mesinicial')||cell('mes')),year:(cell('anoinicial')||cell('ano'))?Number(cell('anoinicial')||cell('ano')):undefined,endMonth:cell('mesfinal')?month(cell('mesfinal')):undefined,endYear:cell('anofinal')?Number(cell('anofinal')):undefined,monthsCount:cell('meses')?Number(cell('meses')):undefined,source:undefined,issues:[]};
    if(['pro-labore','pro labore','prolabore'].includes(norm(row.item)))row.item='Pessoal / Pró-labore';
    row.source=headers.includes('fonte')?({subvencao:'Subvenção',contrapartida:'Contrapartida'})[norm(cell('fonte'))]:row.item==='Contrapartida'?'Contrapartida':'Subvenção';
    if(!row.source)row.issues.push('Fonte deve ser Subvenção ou Contrapartida');
    if(!row.item)row.issues.push('Rubrica não informada');
    if(!row.atividade)row.issues.push('Atividade não informada');
    if(!Number.isFinite(row.valor)||row.valor<=0||Math.abs(row.valor*100-Math.round(row.valor*100))>0.001)row.issues.push('Valor inválido: use até duas casas decimais');
    if(row.monthsCount!==undefined&&(!Number.isInteger(row.monthsCount)||row.monthsCount<1||row.monthsCount>60))row.issues.push('Quantidade de meses inválida');
    const monthly=row.item==='Pessoal / Pró-labore';
    if(row.monthsCount>1&&!monthly)row.issues.push('Use meses apenas para Pessoal / Pró-labore');
    try {
      const p=schedulePeriod(scheduleImportData(row),projectStart);
      if(monthly) {
        const hasEnd=Boolean(row.endMonth||row.endYear),count=hasEnd?p.duration:row.monthsCount||1;
        requireValue(count<=60,'Pró-labore limitado a 60 parcelas mensais.');
        requireValue(!hasEnd||row.monthsCount===undefined||row.monthsCount===count,'Meses e período final devem indicar a mesma quantidade de parcelas.');
        const last=p.year*12+scheduleMonths.indexOf(p.month)+count-1;
        requireValue(Math.floor(last/12)<=2200,'Ano final fora do intervalo permitido.');
        row.monthsCount=count;row.endMonth=scheduleMonths[last%12];row.endYear=Math.floor(last/12);
      } else {row.endMonth=p.endMonth;row.endYear=p.endYear;}
      row.year=p.year;
    } catch(error){row.issues.push(error.message);}
    return row;
  });
  return {rows,error:''};
}
