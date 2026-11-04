export type ScholarshipDestination = {id:string;name:string;percent:number};
export type Scholarship = {id:string;version:number;companyId:string;projectId:string|null;name:string;beneficiaryType:'self'|'thirdParty';beneficiaryName:string;ownerUserId:string;monthlyValue:number;startMonth:string;endMonth:string;destinations:ScholarshipDestination[];notes:string};
export type ScholarshipPaymentDestination = {id:string;name:string;value:number;paidDate:string|null};
export type ScholarshipEntry = {id:string;version:number;scholarshipId:string;competence:string;value:number;receivedDate:string|null;beneficiaryName:string;beneficiaryValue:number;destinations:ScholarshipPaymentDestination[];notes:string};
export type ScholarshipActivity = {id:string;version:number;scholarshipId:string;title:string;description:string;responsible:string;dueDate:string;status:'Não iniciada'|'Em andamento'|'Concluída';notes:string};
export type ScholarshipData = {scholarships:Scholarship[];scholarshipEntries:ScholarshipEntry[];scholarshipActivities:ScholarshipActivity[]};
