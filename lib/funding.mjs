export const fundingSources = ['Subvenção', 'Contrapartida'];
export function sourceOf(item) {
  return item.source || ((item.rubric || item.item) === 'Contrapartida' ? 'Contrapartida' : 'Subvenção');
}
export function budgetSource(item) {
  const name = String(item.fonte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return name.includes('contrapartida') || name.includes('propri') ? 'Contrapartida' : 'Subvenção';
}
export function resourceSource(item) {
  return item.kind === 'Contrapartida financeira' ? 'Contrapartida' : 'Subvenção';
}
