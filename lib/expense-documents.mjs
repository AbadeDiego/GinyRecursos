const rubricName=expense=>String(expense.rubric||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function isProLabore(expense) {
  const name=rubricName(expense);
  return name==='prolabore'||name==='pessoalprolabore';
}
export function expenseDocumentLabels(expense) {
  if(['diaria','diarias'].includes(rubricName(expense)))return {invoice:'Recibo de diária',payment:'Comprovante de pagamento'};
  return isProLabore(expense)
    ? {inss:'Guia do INSS',invoice:'Recibo Pró-labore',payment:'Comprovante de pagamento'}
    : {invoice:'Nota fiscal / recibo',payment:'Comprovante de pagamento',quote1:'Orçamento 1',quote2:'Orçamento 2',quote3:'Orçamento 3'};
}
export const expenseDocumentKeys=expense=>Object.keys(expenseDocumentLabels(expense));
