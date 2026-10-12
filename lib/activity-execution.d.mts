type Activity = { id:string; projectId:string; value:number; rubric?:string; item?:string; source?:string };
type Entry = { id:string; projectId:string; value:number; rubric:string; source?:string; scheduleId?:string|null; draft?:boolean };
export function activityExecution<T extends Activity>(schedule:T[],expenses:Entry[]): {
  activities: Array<T & {planned:number;executed:number;available:number;executionPercent:number;expenseCount:number}>;
  unallocated:{count:number;value:number};
};
