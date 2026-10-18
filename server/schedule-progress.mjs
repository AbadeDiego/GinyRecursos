import { activityExecution } from '../lib/activity-execution.mjs';
// Called inside the financial transaction (and migration), so status and money
// commit together. Drafts do not start activities. Once automatic, zero spend
// returns to Não iniciada rather than restoring an outdated manual status.
export function syncScheduleProgress(db,projectId,onChange=()=>{}) {
  const decode=row=>({...JSON.parse(row.data),id:row.id,projectId:row.project_id,...('schedule_id' in row?{scheduleId:row.schedule_id}:{})});
  const schedule=db.prepare('SELECT * FROM schedule WHERE project_id=?').all(projectId).map(decode);
  const expenses=db.prepare('SELECT * FROM expenses WHERE project_id=?').all(projectId).map(decode);
  for(const item of activityExecution(schedule,expenses).activities) {
    if(!item.statusAutomatic&&!item.expenseCount)continue;
    const status=item.executed<=0?'Não iniciada':item.planned>0&&Math.round(item.executed*100)>=Math.round(item.planned*100)?'Concluída':'Em andamento';
    if(item.status===status&&item.statusAutomatic===true)continue;
    db.prepare("UPDATE schedule SET data=json_set(data,'$.status',?,'$.statusAutomatic',json('true')),version=version+1 WHERE id=?").run(status,item.id);
    onChange(item.id,{previousStatus:item.status,status,executed:item.executed,planned:item.planned});
  }
}
