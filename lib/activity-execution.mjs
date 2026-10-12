import { sourceOf } from './funding.mjs';
const amount=value=>Math.round(Number(value||0)*100);
// Only recorded expenses contribute to financial execution; never infer a link.
export function activityExecution(schedule,expenses) {
  const recorded=expenses.filter(e=>!e.draft),assigned=new Set();
  const activities=schedule.map(item=>{
    const linked=recorded.filter(e=>e.scheduleId===item.id&&e.projectId===item.projectId&&e.rubric===(item.rubric||item.item)&&sourceOf(e)===sourceOf(item));
    linked.forEach(e=>assigned.add(e.id));
    const planned=amount(item.value),executed=linked.reduce((sum,e)=>sum+amount(e.value),0);
    return {...item,planned:planned/100,executed:executed/100,available:(planned-executed)/100,executionPercent:planned?Math.round(executed/planned*10000)/100:0,expenseCount:linked.length};
  });
  const unallocated=recorded.filter(e=>!assigned.has(e.id));
  return {activities,unallocated:{count:unallocated.length,value:unallocated.reduce((sum,e)=>sum+amount(e.value),0)/100}};
}
