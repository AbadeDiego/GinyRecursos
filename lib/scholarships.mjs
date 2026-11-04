// Shared display and allocation arithmetic. Monetary sums use integer cents.
export function scholarshipMonths(start, end) {
  const index = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const first = index(start), last = index(end);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 119) return [];
  return Array.from({length:last-first+1}, (_, i) => `${Math.floor((first+i)/12)}-${String((first+i)%12+1).padStart(2,'0')}`);
}
export function scholarshipTotal(item) { return Math.round(item.monthlyValue * 100) * scholarshipMonths(item.startMonth,item.endMonth).length / 100; }
export function scholarshipSplit(value, destinations) {
  const total = Math.round(value * 100), weights = destinations.map(d => Math.round(d.percent * 100));
  weights.unshift(10000 - weights.reduce((a,b)=>a+b,0));
  const amounts = weights.map(w => Math.floor(total/10000)*w+Math.floor((total%10000)*w/10000));
  const order = weights.map((w,i)=>({i,remainder:(total%10000)*w%10000})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  const remaining = total - amounts.reduce((a,b)=>a+b,0);
  for(let i=0;i<remaining;i++)amounts[order[i].i]++;
  return {beneficiaryValue:amounts[0]/100,destinations:destinations.map((d,i)=>({id:d.id,name:d.name,value:amounts[i+1]/100,paidDate:null}))};
}
export function scholarshipSummary(scholarships, entries) {
  const ids = new Set(scholarships.map(s=>s.id)), relevant=entries.filter(e=>ids.has(e.scholarshipId));
  const sum = values => values.reduce((n,v)=>n+Math.round(v*100),0)/100;
  const received=relevant.filter(e=>e.receivedDate);
  return {planned:sum(scholarships.map(scholarshipTotal)),received:sum(received.map(e=>e.value)),beneficiary:sum(received.map(e=>e.beneficiaryValue)),transferred:sum(received.flatMap(e=>e.destinations.filter(d=>d.paidDate).map(d=>d.value))),pendingTransfers:sum(received.flatMap(e=>e.destinations.filter(d=>!d.paidDate).map(d=>d.value)))};
}
export function scholarshipEntryStatus(entry) {
  return !entry.receivedDate ? 'A receber' : entry.destinations.some(d=>d.value>0&&!d.paidDate) ? 'Repasses pendentes' : 'Concluído';
}
export function scholarshipActivityStatus(activity, today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})) {
  return activity.status!=='Concluída'&&activity.dueDate<today ? 'Atrasada' : activity.status;
}
