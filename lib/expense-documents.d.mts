type Expense = {rubric?:string};
export function isProLabore(expense:Expense):boolean;
export function expenseDocumentLabels(expense:Expense):Record<string,string>;
export function expenseDocumentKeys(expense:Expense):string[];
