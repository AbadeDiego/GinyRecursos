import { sourceOf, fundingSources } from '../lib/funding.mjs';
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const check = (ok, message, status = 422) => { if (!ok) throw new HttpError(status, message); };
export const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const statuses = ['Não iniciada','Em andamento','Concluída','Atrasada'];
export const rubrics = ['Alimentação','Bolsa','Consultoria','Diária','Hospedagem','Material de Consumo','Serviços de Terceiros - PF','Serviços de Terceiros - PJ','Passagem','Transporte','Locomoção','Pessoal / Pró-labore','Material Permanente','Contrapartida'];
export const kinds = ['Parcela da subvenção','Contrapartida financeira','Rendimento de aplicação'];
export function text(value, label, max = 500, optional = false) { check(typeof value === 'string' && value.trim().length <= max && (optional || value.trim().length > 0), `${label} inválido.`); return value.trim(); }
export function cents(value, label = 'Valor', zero = false) { check(typeof value === 'number' && Number.isFinite(value) && value >= (zero ? 0 : 0.01) && value <= 1e10 && Math.abs(value*100-Math.round(value*100)) < 0.001, `${label} deve ter até duas casas decimais e ser ${zero ? 'não negativo' : 'positivo'}.`); return Math.round(value*100); }
export function date(value) { check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, 'Data inválida.'); return value; }
export function choice(value, values, label) { check(values.includes(value), `${label} inválido.`); return value; }
export function integer(value, min, max, label) { check(Number.isInteger(value) && value >= min && value <= max, `${label} inválido.`); return value; }
export function validate(entity, input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Dados inválidos.');
  const s = (key, max = 500, optional = false) => text(input[key] ?? (optional ? '' : undefined), key, max, optional);
  if (entity === 'companies') return {name:s('name'),short:s('short',80),cnpj:s('cnpj',30),city:s('city',100),state:s('state',2),responsible:s('responsible'),email:s('email',254),phone:s('phone',40)};
  if (entity === 'projects') {
    const startDate=date(input.startDate), endDate=date(input.endDate); check(endDate>=startDate,'O término deve ocorrer após o início.');
    return {companyId:s('companyId',80),name:s('name'),code:s('code',80),agency:s('agency',100),startDate,endDate,period:`${startDate} — ${endDate}`,approved:cents(input.approved)/100,counterpart:cents(input.counterpart,'Contrapartida',true)/100,installments:integer(input.installments,1,48,'Parcelas'),status:choice(input.status || 'A iniciar',['Em execução','A iniciar','Concluído'],'Situação')};
  }
  if (entity === 'team') return {name:s('name'),role:s('role'),activity:s('activity',10000)};
  if (entity === 'rubrics') return {name:s('name',120),type:choice(input.type || 'Custeio',['Custeio','Capital'],'Tipo')};
  if (entity === 'schedule') {
    const rubric=text(input.rubric ?? input.item,'Rubrica',500);
    return {source:choice(input.source ?? sourceOf({rubric}),fundingSources,'Fonte'),rubric,item:rubric,activity:s('activity',10000),value:cents(input.value,'Valor',true)/100,month:choice(input.month,months,'Mês'),year:input.year == null ? null : integer(input.year,2000,2200,'Ano'),status:choice(input.status || 'Não iniciada',statuses,'Status')};
  }
  if (entity === 'links') { const url=s('url',2000); let parsed; try {parsed=new URL(url);} catch {} check(parsed && ['https:','http:'].includes(parsed.protocol),'Use um endereço HTTP ou HTTPS válido.'); return {name:s('name'),url,addedAt:new Date().toISOString().slice(0,10)}; }
  if (entity === 'expenses') return {source:choice(input.source ?? sourceOf(input),fundingSources,'Fonte'),supplier:s('supplier'),description:s('description',10000),rubric:s('rubric',500),value:cents(input.value)/100,date:date(input.date),taxId:s('taxId',30,true),notes:s('notes',10000,true),draft:input.draft === true,status: input.draft === true ? 'Pendente' : 'Em análise'};
  if (entity === 'resources') return {kind:choice(input.kind,kinds,'Tipo de recurso'),value:cents(input.value)/100,date:date(input.date),installment:input.kind===kinds[0] ? integer(input.installment,1,48,'Parcela') : null,reference:s('reference',200,true),notes:s('notes',10000,true)};
  if (entity === 'budget') { const unitario=cents(input.unitario,'Valor unitário',true)/100, qtd=input.qtd; check(typeof qtd==='number' && Number.isFinite(qtd) && qtd>0 && qtd<=1e8,'Quantidade inválida.'); const total=cents(input.valorTotal,'Valor total',true); check(Math.abs(Math.round(unitario*100*qtd)-total)<=1,'Total incompatível com quantidade e valor unitário.'); return {fonte:s('fonte'),elemento:s('elemento',500),descricao:s('descricao',10000),unitario,qtd,valorTotal:total/100,issues:[]}; }
  if (entity === 'remaps') return {sourceScheduleId:s('sourceScheduleId',80),to:s('to',500),activity:s('activity',10000),month:choice(input.month,months,'Mês'),year:integer(input.year,2000,2200,'Ano'),value:cents(input.value)/100,reason:s('reason',10000),date:new Date().toISOString().slice(0,10),status:'Aprovado',authorization:''};
  throw new HttpError(404,'Recurso não encontrado.');
}
