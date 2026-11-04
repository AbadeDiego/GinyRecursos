import type {Scholarship,ScholarshipDestination,ScholarshipEntry,ScholarshipActivity,ScholarshipPaymentDestination} from './scholarship-types';
export function scholarshipMonths(start:string,end:string):string[];
export function scholarshipTotal(item:Pick<Scholarship,'startMonth'|'endMonth'|'monthlyValue'>):number;
export function scholarshipSplit(value:number,destinations:ScholarshipDestination[]):{beneficiaryValue:number;destinations:ScholarshipPaymentDestination[]};
export function scholarshipSummary(scholarships:Scholarship[],entries:ScholarshipEntry[]):{planned:number;received:number;beneficiary:number;transferred:number;pendingTransfers:number};
export function scholarshipEntryStatus(entry:ScholarshipEntry):string;
export function scholarshipActivityStatus(activity:ScholarshipActivity,today?:string):string;
