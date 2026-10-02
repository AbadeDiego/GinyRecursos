"use client";

import { sourceOf, resourceSource } from "../lib/funding.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Gauge,
  HandCoins,
  IdCard,
  Landmark,
  LayoutDashboard,
  Link2,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  ExternalLink,
  UploadCloud,
  Users,
  WalletCards,
  X,
} from "lucide-react";

import { api, ApiError } from "./api-client";
import { csvRecords } from "../lib/csv.mjs";
import { Login, AccountPanel, type AppUser } from "./account-panel";

type View =
  | "overview"
  | "companies"
  | "team"
  | "schedule"
  | "entries"
  | "resources"
  | "reconciliation"
  | "remaps"
  | "documents"
  | "links"
  | "reports";

type Project = {
  version: number;
  id: string;
  companyId: string;
  name: string;
  code: string;
  agency: string;
  period: string;
  startDate?: string;
  endDate?: string;
  planningWarnings?:{source:string;planned:number;limit:number;excess:number}[];
  approved: number;
  counterpart: number;
  counterpartRealized: number;
  released: number;
  executed: number;
  executedSubvention?: number;
  executedCounterpart?: number;
  income: number;
  status?: "Em execução" | "A iniciar" | "Concluído";
  installments?: number;
  receivedInstallments?: number[];
};

type Company = {
  version: number;
  id: string;
  name: string;
  short: string;
  cnpj: string;
  city: string;
  state: string;
  responsible: string;
  email: string;
  phone: string;
};

type ProjectDraft = {
  companyId: string;
  name: string;
  code: string;
  agency: string;
  startDate: string;
  endDate: string;
  approved: number;
  counterpart: number;
  installments: number;
};

type ResourceEntryKind = "Parcela da subvenção" | "Contrapartida financeira" | "Rendimento de aplicação";

type ResourceEntryDraft = {
  kind: ResourceEntryKind;
  value: number;
  date: string;
  installment?: number;
  reference: string;
  proof?: File;
  notes: string;
};

type DocumentFile = { id: string; kind: string; name: string; mime: string; size: number };
type Expense = {
  version: number;
  id: string;
  projectId: string;
  date: string;
  supplier: string;
  description: string;
  rubric: string;
  source?: FundingSource;
  sourceInferred?: boolean;
  value: number;
  docs: number;
  requiredDocs: number;
  draft?: boolean;
  taxId?: string;
  notes?: string;
  documents?: DocumentFile[];
  status: "Conciliado" | "Pendente" | "Em análise";
};

type ProjectLink = {
  version: number;
  id: string;
  projectId: string;
  name: string;
  url: string;
  addedAt: string;
};

type TeamMember = {
  version: number;
  id: string;
  projectId: string;
  name: string;
  role: string;
  activity: string;
};

type FundingSource = "Subvenção" | "Contrapartida";
type ScheduleStatus = "Não iniciada" | "Em andamento" | "Concluída" | "Atrasada";

type ScheduleItem = {
  version: number;
  id: string;
  projectId: string;
  item: string;
  rubric: string;
  source?: FundingSource;
  sourceInferred?: boolean;
  year?: number | null;
  recurrenceId?: string;
  installment?: number;
  installments?: number;
  monthsCount?: number;
  activity: string;
  value: number;
  month: string;
  status: ScheduleStatus;
};

type CsvTeamRow = {
  nome: string;
  funcao: string;
  atividade: string;
  issues: string[];
};

type CsvScheduleRow = {
  source?: FundingSource;
  item: string;
  year?: number;
  monthsCount?: number;
  atividade: string;
  valor: number;
  mes: string;
  issues: string[];
};

type CsvBudgetRow = {
  fonte: string;
  elemento: string;
  descricao: string;
  unitario: number;
  qtd: number;
  valorTotal: number;
  issues: string[];
};

type CsvImportResult = {
  projectId: string;
  fileName: string;
  rows: CsvBudgetRow[];
};

const baseRubrics = [
  { name: "Alimentação", type: "Custeio", approved: 0, executed: 0 },
  { name: "Bolsa", type: "Custeio", approved: 0, executed: 0 },
  { name: "Consultoria", type: "Custeio", approved: 0, executed: 0 },
  { name: "Diária", type: "Custeio", approved: 0, executed: 0 },
  { name: "Hospedagem", type: "Custeio", approved: 0, executed: 0 },
  { name: "Material de Consumo", type: "Custeio", approved: 0, executed: 0 },
  { name: "Serviços de Terceiros - PF", type: "Custeio", approved: 0, executed: 0 },
  { name: "Serviços de Terceiros - PJ", type: "Custeio", approved: 0, executed: 0 },
  { name: "Passagem", type: "Custeio", approved: 0, executed: 0 },
  { name: "Transporte", type: "Custeio", approved: 0, executed: 0 },
  { name: "Locomoção", type: "Custeio", approved: 0, executed: 0 },
  { name: "Pessoal / Pró-labore", type: "Custeio", approved: 0, executed: 0 },
  { name: "Contrapartida", type: "Custeio", approved: 0, executed: 0 },
  { name: "Material Permanente", type: "Capital", approved: 0, executed: 0 },
];

const projectMonths = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const scheduleStatuses: ScheduleStatus[] = ["Não iniciada", "Em andamento", "Concluída", "Atrasada"];

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "companies", label: "Empresas e projetos", icon: Building2 },
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "schedule", label: "Cronograma", icon: CalendarDays },
  { id: "entries", label: "Lançamentos", icon: ReceiptText },
  { id: "resources", label: "Recursos e parcelas", icon: WalletCards },
  { id: "reconciliation", label: "Conciliação bancária", icon: Landmark },
  { id: "remaps", label: "Remanejamentos", icon: ArrowRightLeft },
  { id: "team", label: "Equipe técnica", icon: Users },
  { id: "documents", label: "Documentos", icon: FolderOpen },
  { id: "links", label: "Links importantes", icon: Link2 },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
];

const viewTitles: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  overview: { eyebrow: "Painel do projeto", title: "Visão geral", subtitle: "Acompanhe a execução física e financeira em um só lugar." },
  companies: { eyebrow: "Estrutura da organização", title: "Empresas e projetos", subtitle: "Cadastre empresas, organize projetos aprovados e alterne entre eles." },
  team: { eyebrow: "Gestão do projeto", title: "Equipe técnica", subtitle: "Organize funções e atividades dos membros vinculados ao projeto." },
  schedule: { eyebrow: "Planejamento da execução", title: "Cronograma", subtitle: "Acompanhe atividades, valores e meses previstos para cada etapa." },
  entries: { eyebrow: "Execução financeira", title: "Lançamentos", subtitle: "Despesas realizadas, documentos e situação da conciliação." },
  resources: { eyebrow: "Fluxo financeiro", title: "Recursos e parcelas", subtitle: "Liberações, contrapartida e rendimentos da aplicação." },
  reconciliation: { eyebrow: "Conta vinculada", title: "Conciliação bancária", subtitle: "Confira entradas, despesas e extrato da conta de subvenção." },
  remaps: { eyebrow: "Orçamento aprovado", title: "Remanejamentos", subtitle: "Registre e acompanhe transferências entre rubricas." },
  documents: { eyebrow: "Arquivo do projeto", title: "Documentos do projeto", subtitle: "Organize o projeto original, termo de outorga e outros documentos gerais." },
  links: { eyebrow: "Referências do projeto", title: "Links importantes", subtitle: "Organize acessos, portais e referências úteis vinculados a este projeto." },
  reports: { eyebrow: "Prestação de contas", title: "Relatórios", subtitle: "Consolide a documentação e prepare as entregas ao concedente." },
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(value);

const compactMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value);

const percent = (value: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((value / total) * 1000) / 10) : 0;

const monthYear = (value: string) => {
  if (!value) return "a definir";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
    .format(new Date(value + "T12:00:00"))
    .replace(". de ", "/")
    .replace(" de ", "/");
};

function StatusBadge({ status }: { status: Expense["status"] | "Aprovado" | "Aguardando aprovação" | "Recebida" | "Prevista" }) {
  const tone =
    status === "Conciliado" || status === "Aprovado" || status === "Recebida"
      ? "success"
      : status === "Pendente" || status === "Aguardando aprovação"
        ? "warning"
        : status === "Em análise"
          ? "info"
          : "neutral";
  return <span className={"status-badge " + tone}><span className="status-dot" />{status}</span>;
}

function ProgressBar({ value, tone = "green" }: { value: number; tone?: "green" | "amber" | "blue" | "gray" }) {
  return <div className={"progress-track " + tone} aria-label={String(value) + "% utilizado"}><span style={{ width: String(Math.min(100, value)) + "%" }} /></div>;
}

type Resource = ResourceEntryDraft & {version:number;id: string; projectId: string; documents: DocumentFile[]};
type RubricOption = {name:string;type:string};
type RemapDraft = {sourceScheduleId:string;to:string;activity:string;month:string;year:number;value:number;reason:string};
type Remap = {source?:FundingSource;destinationScheduleId?:string;sourceScheduleId?:string;sourceActivity?:string;activity?:string;month?:string;year?:number;id: string; projectId: string; from: string; to: string; value: number; reason: string; date: string; status: "Aprovado" | "Aguardando aprovação"; version: number; authorization?: string};
type BudgetRow = CsvBudgetRow & {id: string; projectId: string};
type ProjectDocument = {id:string;projectId:string;version:number;name:string;filename:string;mime:string;size:number;createdAt:string};
type State = {projectDocuments:ProjectDocument[];rubrics: (RubricOption & {projectId:string})[]; user: AppUser; companies: Company[]; projects: Project[]; expenses: Expense[]; team: TeamMember[]; schedule: ScheduleItem[]; links: ProjectLink[]; resources: Resource[]; budget: BudgetRow[]; remaps: Remap[]};
const emptyProject: Project = {id:"",companyId:"",name:"Cadastre seu primeiro projeto",code:"",agency:"",period:"",approved:0,counterpart:0,counterpartRealized:0,released:0,executed:0,income:0,version:1};
const emptyCompany: Company = {id:"",name:"",short:"",cnpj:"",city:"",state:"",responsible:"",email:"",phone:"",version:1};
export default function Home() {
  const [state,setState]=useState<State|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const load=async()=>{setError("");try{setState(await api("state"));}catch(e){if(!(e instanceof ApiError && e.status===401))setError((e as Error).message);setState(null);}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  if(loading)return <main className="auth-screen" role="status">Carregando seus projetos…</main>;
  if(error)return <main className="auth-screen"><div className="panel auth-card"><p role="alert">{error}</p><button className="primary-button" onClick={()=>void load()}>Tentar novamente</button></div></main>;
  if(!state)return <Login onLogin={load}/>;
  return <Workspace initial={state} onLogout={()=>setState(null)}/>;
}
function Workspace({initial,onLogout}: {initial: State;onLogout:()=>void}) {

  const [view, setView] = useState<View>("overview");
  const [companyList, setCompanyList] = useState<Company[]>(initial.companies);
  const [projectList, setProjectList] = useState<Project[]>(initial.projects);
  const [companyId, setCompanyId] = useState(initial.projects[0]?.companyId || initial.companies[0]?.id || "");
  const [projectId, setProjectId] = useState(initial.projects[0]?.id || "");
  const [profileCompanyId, setProfileCompanyId] = useState(initial.projects[0]?.companyId || initial.companies[0]?.id || "");
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectModalCompanyId, setProjectModalCompanyId] = useState(initial.projects[0]?.companyId || initial.companies[0]?.id || "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [resourceEntryOpen, setResourceEntryOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [editingLink,setEditingLink]=useState<ProjectLink|null>(null);
  const [projectDocuments,setProjectDocuments]=useState(initial.projectDocuments || []);
  const [documentModalOpen,setDocumentModalOpen]=useState(false);
  const [editingDocument,setEditingDocument]=useState<ProjectDocument|null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [budgetRows,setBudgetRows]=useState(initial.budget);
  const [teamImportOpen, setTeamImportOpen] = useState(false);
  const [scheduleImportOpen, setScheduleImportOpen] = useState(false);
  const [teamMemberCreateOpen, setTeamMemberCreateOpen] = useState(false);
  const [editingTeamMember, setEditingTeamMember] = useState<TeamMember | null>(null);
  const [teamMemberToDelete, setTeamMemberToDelete] = useState<TeamMember | null>(null);
  const [editingScheduleItem, setEditingScheduleItem] = useState<ScheduleItem | null>(null);
  const [scheduleCreateOpen,setScheduleCreateOpen]=useState(false);
  const [editingExpense,setEditingExpense]=useState<Expense|null>(null);
  const [deletingExpense,setDeletingExpense]=useState<Expense|null>(null);
  const [customRubrics,setCustomRubrics]=useState(initial.rubrics || []);
  const [rubricCreateOpen,setRubricCreateOpen]=useState(false);
  const [remapOpen, setRemapOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [entries, setEntries] = useState(initial.expenses);
  const [projectLinks, setProjectLinks] = useState(initial.links);
  const [teamMembers, setTeamMembers] = useState(initial.team);
  const [scheduleItems, setScheduleItems] = useState(initial.schedule);
  const [toast, setToast] = useState("");
  const [resources,setResources]=useState(initial.resources);
  const [remaps,setRemaps]=useState(initial.remaps);
  const [editingResource,setEditingResource]=useState<Resource|null>(null);
  const [editingRemap,setEditingRemap]=useState<Remap|null>(null);
  const [deletion,setDeletion]=useState<{entity:"schedule"|"resources"|"remaps"|"projectDocuments";id:string;version:number;title:string;description:string}|null>(null);
  const confirmDeletion=()=>deletion&&commit(()=>api(deletion.entity+"/"+deletion.id,"DELETE",{version:deletion.version}),()=>{setDeletion(null);setEditingScheduleItem(null);setEditingResource(null);setEditingRemap(null);},"Registro excluído e saldos atualizados.");
  const [busy,setBusy]=useState(false),[saveError,setSaveError]=useState("");
  const saving=useRef(false);
  const [accountOpen,setAccountOpen]=useState(false);

  const activeProject = projectList.find((project) => project.id === projectId) || projectList[0] || emptyProject;
  const activeCompany = companyList.find((company) => company.id === companyId) || companyList[0] || emptyCompany;
  const companyProjects = projectList.filter((project) => project.companyId === companyId);
  const projectEntries = entries.filter((entry) => entry.projectId === activeProject.id);
  const activeProjectLinks = projectLinks.filter((link) => link.projectId === activeProject.id);
  const activeTeamMembers = teamMembers.filter((member) => member.projectId === activeProject.id);
  const activeScheduleItems = scheduleItems.filter((item) => item.projectId === activeProject.id);
  const pendingProjectDocuments = projectEntries.filter((entry) => entry.docs < entry.requiredDocs).length;
  const projectRequiredDocuments = projectEntries.reduce((sum, entry) => sum + entry.requiredDocs, 0);
  const projectSentDocuments = projectEntries.reduce((sum, entry) => sum + entry.docs, 0);
  const projectDocumentCompletion = percent(projectSentDocuments, projectRequiredDocuments);
  const rubricOptions:RubricOption[]=Array.from(new Map([
    ...baseRubrics,...customRubrics.filter(r=>r.projectId===activeProject.id),
    ...activeScheduleItems.map(s=>({name:s.rubric || s.item,type:"Custeio"})),
    ...budgetRows.filter(b=>b.projectId===activeProject.id).map(b=>({name:b.elemento,type:b.elemento==="Material Permanente"?"Capital":"Custeio"})),
    ...projectEntries.map(e=>({name:e.rubric,type:"Custeio"})),
  ].map(r=>[r.name,r])).values()).map(r=>({...r,type:customRubrics.find(c=>c.projectId===activeProject.id&&c.name===r.name)?.type || (r.name==="Material Permanente"?"Capital":r.type)}));
  const activeRubrics = rubricOptions.filter(r=>activeScheduleItems.some(s=>(s.rubric||s.item)===r.name)).map(r=>({...r,
    approved:(activeScheduleItems.filter(s=>(s.rubric||s.item)===r.name).reduce((sum,s)=>sum+Math.round(s.value*100),0)+remaps.filter(m=>m.projectId===activeProject.id&&m.status==="Aprovado"&&!m.sourceScheduleId).reduce((sum,m)=>sum+(m.to===r.name?Math.round(m.value*100):m.from===r.name?-Math.round(m.value*100):0),0))/100,
    executed:projectEntries.filter(e=>!e.draft&&e.rubric===r.name).reduce((sum,e)=>sum+Math.round(e.value*100),0)/100,
  }));
  const refresh=async()=>{const state:State=await api("state");setCompanyList(state.companies);setProjectList(state.projects);setEntries(state.expenses);setProjectLinks(state.links);setProjectDocuments(state.projectDocuments || []);setTeamMembers(state.team);setScheduleItems(state.schedule);setResources(state.resources);setBudgetRows(state.budget);setRemaps(state.remaps);setCustomRubrics(state.rubrics || []);return state;};
  const commit=async(action:()=>Promise<unknown>, after:()=>void, message:string)=>{
    if(saving.current)return; saving.current=true;setBusy(true);setSaveError("");
    let saved=false;
    try{await action();saved=true;after();await refresh();showToast(message);}catch(error){setSaveError(saved?"Operação salva. Não foi possível atualizar a tela. Recarregue a página para ver os dados.":(error as Error).message);if(error instanceof ApiError&&error.status===401)onLogout();}finally{saving.current=false;setBusy(false);}
  };
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  const changeCompany = (nextCompanyId: string) => {
    const firstProject = projectList.find((project) => project.companyId === nextCompanyId);
    if (firstProject) {
      setCompanyId(nextCompanyId);
      setProjectId(firstProject.id);
    }
  };

  const switchProject = (nextProjectId: string) => {
    const nextProject = projectList.find((project) => project.id === nextProjectId);
    if (!nextProject) return;
    setCompanyId(nextProject.companyId);
    setProjectId(nextProject.id);
    setProfileCompanyId(nextProject.companyId);
    setProjectMenuOpen(false);
    setView("overview");
  };

  const startProjectCreation = (targetCompanyId = profileCompanyId) => {
    setProjectMenuOpen(false);
    setProjectModalCompanyId(targetCompanyId);
    setProjectModalOpen(true);
  };

  const createCompany = (company: Omit<Company,"id" | "version">) => commit(async()=>{const saved=await api("companies","POST",company);setProfileCompanyId(saved.id);setProjectModalCompanyId(saved.id);},()=>{setCompanyModalOpen(false);setProjectModalOpen(true);},"Empresa salva. Cadastre o primeiro projeto.");
  const editProject = (draft: ProjectDraft) => { if(editingProject)void commit(()=>api(`projects/${editingProject.id}`,"PATCH",{...draft,version:editingProject.version}),()=>setEditingProject(null),"Cadastro do projeto atualizado."); };
  const createProject = (draft: ProjectDraft) => commit(async()=>{const saved=await api("projects","POST",draft);setProjectId(saved.id);setCompanyId(saved.companyId);setProfileCompanyId(saved.companyId);},()=>{setProjectModalOpen(false);setView("overview");},"Projeto cadastrado.");
  const navigate = (nextView: View) => {setView(nextView);setSidebarOpen(false);window.scrollTo({top:0,behavior:"smooth"});};
  const addEntry = (entry: ExpenseDraft, draft: boolean, files:Record<string,File>) => commit(()=>api("expenses","POST",{...entry,projectId:activeProject.id,draft},files),()=>{setNewEntryOpen(false);setView("entries");},draft?"Rascunho salvo.":"Despesa registrada.");
  const addResourceEntry = (entry:ResourceEntryDraft) => { const {proof,...data}=entry; return commit(()=>api("resources","POST",{...data,projectId:activeProject.id},proof?{proof}:undefined),()=>setResourceEntryOpen(false),"Recurso financeiro registrado."); };
  const addProjectLink = (draft:{name:string;url:string}) => commit(()=>api("links","POST",{...draft,projectId:activeProject.id,url:/^https?:\/\//i.test(draft.url)?draft.url:`https://${draft.url}`}),()=>setLinkModalOpen(false),"Link adicionado.");
  const saveProjectLink=(draft:{name:string;url:string})=>commit(()=>api("links/"+editingLink!.id,"PATCH",{...draft,version:editingLink!.version,url:/^https?:\/\//i.test(draft.url)?draft.url:`https://${draft.url}`}),()=>setEditingLink(null),"Link atualizado.");
  const saveProjectDocument=(name:string,file?:File)=>commit(()=>api(editingDocument?"projectDocuments/"+editingDocument.id:"projectDocuments",editingDocument?"PATCH":"POST",{name,projectId:activeProject.id,version:editingDocument?.version},file?{project:file}:undefined),()=>{setDocumentModalOpen(false);setEditingDocument(null);},"Documento salvo.");
  const openCsvImport=()=>{setNewEntryOpen(false);setCsvImportOpen(true);};
  const finishCsvImport=(rows:CsvBudgetRow[])=>commit(()=>api("budget/import","POST",{projectId:activeProject.id,rows}),()=>{setCsvImportOpen(false);setView("overview");},"Orçamento importado e salvo.");
  const finishTeamImport=(rows:CsvTeamRow[])=>commit(()=>api("team/import","POST",{projectId:activeProject.id,rows:rows.map(r=>({name:r.nome,role:r.funcao,activity:r.atividade}))}),()=>setTeamImportOpen(false),"Membros adicionados à equipe.");
  const finishScheduleImport=(rows:CsvScheduleRow[])=>commit(()=>api("schedule/import","POST",{projectId:activeProject.id,rows:rows.map(r=>({source:r.source,rubric:r.item,activity:r.atividade,value:r.valor,month:r.mes,year:r.year,monthsCount:r.monthsCount}))}),()=>setScheduleImportOpen(false),"Cronograma importado.");
  const saveTeamMember=(updated:TeamMember)=>commit(()=>api("team/"+updated.id,"PATCH",updated),()=>setEditingTeamMember(null),"Membro atualizado.");
  const createTeamMember=(draft:Pick<TeamMember,"name"|"role"|"activity">)=>commit(()=>api("team","POST",{...draft,projectId:activeProject.id}),()=>setTeamMemberCreateOpen(false),"Membro adicionado.");
  const deleteTeamMember=(member:TeamMember)=>commit(()=>api("team/"+member.id,"DELETE",{version:member.version}),()=>setTeamMemberToDelete(null),"Membro excluído.");
  const saveScheduleItem=(updated:ScheduleItem)=>commit(()=>api("schedule/"+updated.id,"PATCH",updated),()=>setEditingScheduleItem(null),"Cronograma atualizado.");
  const createScheduleItem=(draft:ScheduleItem)=>commit(()=>api("schedule","POST",{...draft,projectId:activeProject.id}),()=>setScheduleCreateOpen(false),"Previsões adicionadas ao cronograma.");
  const createRubric=(draft:RubricOption)=>commit(()=>api("rubrics","POST",{...draft,projectId:activeProject.id}),()=>setRubricCreateOpen(false),"Rubrica cadastrada. Planeje o valor no cronograma para utilizá-la.");
  const editExpense=(draft:ExpenseDraft)=>commit(()=>api("expenses/"+editingExpense!.id,"PATCH",{...draft,action:"edit",version:editingExpense!.version}),()=>{setEditingExpense(null);setSelectedExpense(null);},"Lançamento atualizado.");
  const deleteExpense=(expense:Expense)=>commit(()=>api("expenses/"+expense.id,"DELETE",{version:expense.version}),()=>{setDeletingExpense(null);setSelectedExpense(null);},"Lançamento excluído e saldos atualizados.");
  const saveRemap=(draft:RemapDraft)=>commit(()=>api(editingRemap?"remaps/"+editingRemap.id:"remaps",editingRemap?"PATCH":"POST",{...draft,projectId:activeProject.id,...(editingRemap?{version:editingRemap.version}:{})}),()=>{setRemapOpen(false);setEditingRemap(null);},"Remanejamento aplicado e cronograma atualizado.");
  const editResourceEntry=(entry:ResourceEntryDraft)=>{const {proof,...data}=entry;return commit(()=>api("resources/"+editingResource!.id,"PATCH",{...data,version:editingResource!.version},proof?{proof}:undefined),()=>setEditingResource(null),"Recurso atualizado.");};
  const updateExpense=(expense:Expense,action:string,bankReference?:string)=>commit(()=>api("expenses/"+expense.id,"PATCH",{version:expense.version,action,bankReference}),()=>setSelectedExpense(null),"Despesa atualizada.");
  const uploadExpense=(expense:Expense,files:Record<string,File>)=>commit(()=>api("expenses/"+expense.id+"/documents","POST",{},files),()=>{},"Documentos salvos.");
  if(!projectList.length)return <main className="auth-screen"><section className="panel auth-card"><h1>Organize seus projetos</h1><p>Comece cadastrando uma empresa e seu primeiro projeto aprovado.</p><button className="primary-button" onClick={()=>companyList.length?startProjectCreation(companyList[0].id):setCompanyModalOpen(true)}>{companyList.length?"Cadastrar projeto":"Cadastrar empresa"}</button><button className="secondary-button" onClick={()=>setAccountOpen(true)}>Conta e acessos</button></section>{companyModalOpen&&<CompanyModal onClose={()=>setCompanyModalOpen(false)} onSave={createCompany}/>} {projectModalOpen&&<ProjectModal companies={companyList} initialCompanyId={projectModalCompanyId} onClose={()=>setProjectModalOpen(false)} onSave={createProject}/>} {accountOpen&&<AccountPanel user={initial.user} onClose={()=>setAccountOpen(false)} onLogout={onLogout}/>} {saveError&&<div role="alert" className="save-error">{saveError}<button onClick={()=>setSaveError("")}>Fechar</button></div>} {busy&&<div className="saving-overlay" role="status">Salvando…</div>}</main>;
  const header = viewTitles[view];

  return (
    <div className="app-shell">
      {busy&&<div className="saving-overlay" role="status">Salvando…</div>}
      {saveError&&<div role="alert" className="save-error">{saveError}<button onClick={()=>setSaveError("")}>Fechar</button></div>}
      {accountOpen&&<AccountPanel user={initial.user} onClose={()=>setAccountOpen(false)} onLogout={onLogout}/>}
      {sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={"sidebar " + (sidebarOpen ? "open" : "")}>
        <div className="brand">
          <div className="brand-mark"><HandCoins size={21} strokeWidth={2.2} /></div>
          <div><strong>Subvenção</strong><span>gestão de recursos</span></div>
          <button className="mobile-close" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-caption">GESTÃO DO PROJETO</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={18} strokeWidth={2} /><span>{item.label}</span>{item.id === "entries" && pendingProjectDocuments > 0 && <em>{pendingProjectDocuments}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={()=>setAccountOpen(true)}><Users size={18} /><span>Equipe e acessos</span></button>
          <button onClick={()=>setAccountOpen(true)}><Settings size={18} /><span>Configurações</span></button>
          <div className="help-card">
            <div className="help-icon"><ShieldCheck size={19} /></div>
            <strong>{projectEntries.length > 0 ? "Projeto organizado" : "Projeto pronto para começar"}</strong>
            <p>{projectEntries.length > 0 ? `${projectDocumentCompletion}% dos anexos do checklist já foram enviados.` : "O checklist será atualizado com o primeiro lançamento."}</p>
            <button onClick={() => navigate("entries")}>{pendingProjectDocuments > 0 ? "Ver pendências" : "Ver checklist"} <ArrowRight size={14} /></button>
          </div>
          <div className="user-card"><div className="avatar">{initial.user.name.slice(0,2).toUpperCase()}</div><div><strong>{initial.user.name}</strong><span>{initial.user.role === "viewer" ? "Consulta" : "Gestão de projetos"}</span></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
          <div className="project-switcher-wrap">
            <button className="project-switcher" onClick={() => setProjectMenuOpen((open) => !open)} aria-expanded={projectMenuOpen}>
              <div className="company-symbol"><Building2 size={18} /></div>
              <div className="project-switcher-copy"><span>{activeCompany.short} · {activeProject.code}</span><strong>{activeProject.name}</strong></div>
              <ChevronDown size={18} className={projectMenuOpen ? "rotate" : ""} />
            </button>
            {projectMenuOpen && (
              <div className="project-menu">
                <label>Empresa</label>
                <select aria-label="Empresa ativa" value={companyId} onChange={(event) => changeCompany(event.target.value)}>{companyList.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select>
                <label>Projeto</label>
                <select aria-label="Projeto ativo" value={projectId} onChange={(event) => switchProject(event.target.value)}>{companyProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select>
                <div className="project-menu-meta"><span><CalendarDays size={14} /> {activeProject.period}</span><span><ShieldCheck size={14} /> {activeProject.agency}</span></div>
                <div className="project-menu-actions">
                  <button onClick={() => { setProjectMenuOpen(false); setCompanyModalOpen(true); }}><Plus size={15} /> Nova Empresa</button>
                  <button onClick={() => startProjectCreation(companyId)}><Plus size={15} /> Novo projeto</button>
                </div>
              </div>
            )}
          </div>
          <div className="topbar-actions">


            <button className="topbar-avatar" aria-label="Minha conta" onClick={()=>setAccountOpen(true)}>{initial.user.name.slice(0,2).toUpperCase()}</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><span className="eyebrow">{header.eyebrow}</span><h1>{header.title}</h1><p>{header.subtitle}</p></div>
            <div className="heading-actions">
              {view === "reports" && <button className="secondary-button" onClick={() => window.location.assign(`/api/reports/${activeProject.id}`)}><Download size={17} /> Exportar consolidado</button>}
              {view === "overview" ? (
                <button className="primary-button" onClick={() => setEditingProject(activeProject)}><Pencil size={17} /> Editar projeto</button>
              ) : view === "companies" ? (
                <>
                  <button className="secondary-button" onClick={() => startProjectCreation(profileCompanyId)}><Rocket size={17} /> Novo projeto</button>
                  <button className="primary-button" onClick={() => setCompanyModalOpen(true)}><Plus size={18} /> Nova empresa</button>
                </>
              ) : view === "team" ? (
                <>
                  <button className="secondary-button" onClick={() => setTeamImportOpen(true)}><FileSpreadsheet size={18} /> Importar CSV</button>
                  <button className="primary-button" onClick={() => setTeamMemberCreateOpen(true)}><Plus size={18} /> Adicionar membro</button>
                </>
              ) : view === "schedule" ? (
                <><button className="secondary-button" onClick={() => setScheduleImportOpen(true)}><FileSpreadsheet size={18} /> Importar planilha</button><button className="primary-button" onClick={()=>setScheduleCreateOpen(true)}><Plus size={18}/> Adicionar previsão</button></>
              ) : view === "resources" ? (
                <button className="primary-button" onClick={() => setResourceEntryOpen(true)}><ArrowDownToLine size={18} /> Lançar recurso</button>
              ) : view === "remaps" ? (
                <button className="primary-button" onClick={() => setRemapOpen(true)}><Plus size={18} /> Novo remanejamento</button>
              ) : view === "links" ? (
                <button className="primary-button" onClick={() => setLinkModalOpen(true)}><Plus size={18} /> Adicionar link</button>
              ) : view === "documents" ? (
                <button className="primary-button" onClick={()=>setDocumentModalOpen(true)}><Plus size={18}/> Adicionar documento</button>
              ) : view === "reports" ? (
                <span className="automatic-heading-status"><ShieldCheck size={16}/> Dados atualizados do projeto</span>
              ) : view === "reconciliation" ? (
                <span className="automatic-heading-status"><RefreshCw size={16} /> Registros salvos</span>
              ) : (
                <button className="primary-button" onClick={() => setNewEntryOpen(true)}><Plus size={18} /> Novo lançamento</button>
              )}
            </div>
          </div>

          {(view==="schedule"||view==="remaps")&&activeProject.planningWarnings?.map(w=><div className="notice-banner" key={w.source}><AlertCircle size={21}/><div><strong>{w.source}: planejamento {money(w.excess)} acima do limite</strong><span>Planejado: {money(w.planned)} · Limite: {money(w.limit)}. Você pode editar e reduzir as previsões sem aumentar o excesso. Valores já executados continuam protegidos.</span></div></div>)}
          {view === "overview" && <Overview resources={resources.filter(r=>r.projectId===activeProject.id)} onEditResource={setEditingResource} project={activeProject} rubrics={activeRubrics} entries={projectEntries} navigate={navigate} openEntry={setSelectedExpense} />}
          {view === "companies" && <CompaniesView companies={companyList} projects={projectList} selectedCompanyId={profileCompanyId} activeProjectId={projectId} onSelectCompany={setProfileCompanyId} onNewCompany={() => setCompanyModalOpen(true)} onNewProject={startProjectCreation} onSwitchProject={switchProject} />}
          {view === "team" && <TeamView project={activeProject} members={activeTeamMembers} onImport={() => setTeamImportOpen(true)} onAdd={() => setTeamMemberCreateOpen(true)} onEdit={setEditingTeamMember} onDelete={setTeamMemberToDelete} />}
          {view === "schedule" && <ScheduleView onAdd={()=>setScheduleCreateOpen(true)} project={activeProject} items={activeScheduleItems} onImport={() => setScheduleImportOpen(true)} onEdit={setEditingScheduleItem} />}
          {view === "entries" && <Entries projectId={activeProject.id} entries={projectEntries} openEntry={setSelectedExpense} newEntry={() => setNewEntryOpen(true)} rubrics={rubricOptions} onEdit={setEditingExpense} onDelete={setDeletingExpense} />}
          {view === "resources" && <Resources project={activeProject} resources={resources.filter(r=>r.projectId===activeProject.id)} onAdd={()=>setResourceEntryOpen(true)} onEdit={setEditingResource} onDelete={r=>setDeletion({entity:"resources",id:r.id,version:r.version,title:"Excluir recurso?",description:`${r.kind} · ${money(r.value)}. O registro e seus comprovantes serão excluídos e os saldos serão recalculados.`})} />}
          {view === "reconciliation" && <Reconciliation project={activeProject} entries={projectEntries} resources={resources.filter(r=>r.projectId===activeProject.id)} />}
          {view === "remaps" && <Remaps project={activeProject} remaps={remaps.filter(r=>r.projectId===activeProject.id)} onEdit={setEditingRemap} onDelete={r=>setDeletion({entity:"remaps",id:r.id,version:r.version,title:"Excluir remanejamento?",description:"O valor será devolvido à origem e a previsão criada no destino será removida. A operação será bloqueada se comprometer despesas já registradas ou remanejamentos posteriores."})} openModal={() => setRemapOpen(true)} />}
          {view === "documents" && <Documents documents={projectDocuments.filter(d=>d.projectId===activeProject.id)} onAdd={()=>setDocumentModalOpen(true)} onEdit={setEditingDocument} onDelete={d=>setDeletion({entity:"projectDocuments",id:d.id,version:d.version,title:"Excluir documento?",description:`O documento “${d.name}” e seu arquivo serão excluídos do projeto.`})} />}
          {view === "links" && <ProjectLinksView onEdit={setEditingLink} project={activeProject} links={activeProjectLinks} onAdd={() => setLinkModalOpen(true)} />}
          {view === "reports" && <Reports project={activeProject} entries={projectEntries} />}
        </div>
      </main>

      {newEntryOpen && <NewEntryModal schedule={activeScheduleItems} onOpenSchedule={()=>{setNewEntryOpen(false);navigate("schedule");}} onClose={() => setNewEntryOpen(false)} onSave={addEntry} showToast={showToast} />}
      {deletion && <DeleteRecordModal title={deletion.title} description={deletion.description} onClose={()=>setDeletion(null)} onConfirm={confirmDeletion}/>}
      {editingResource && <ResourceEntryModal initial={editingResource} project={activeProject} onClose={()=>setEditingResource(null)} onSave={editResourceEntry}/>}
      {resourceEntryOpen && <ResourceEntryModal project={activeProject} onClose={() => setResourceEntryOpen(false)} onSave={addResourceEntry} />}
      {(documentModalOpen||editingDocument)&&<ProjectDocumentModal initial={editingDocument||undefined} onClose={()=>{setDocumentModalOpen(false);setEditingDocument(null);}} onSave={saveProjectDocument}/>}
      {editingLink&&<ProjectLinkModal project={activeProject} initial={editingLink} onClose={()=>setEditingLink(null)} onSave={saveProjectLink}/>}
      {linkModalOpen && <ProjectLinkModal project={activeProject} onClose={() => setLinkModalOpen(false)} onSave={addProjectLink} />}
      {companyModalOpen && <CompanyModal onClose={() => setCompanyModalOpen(false)} onSave={createCompany} />}
      {editingProject && <ProjectModal companies={companyList} initialCompanyId={editingProject.companyId} initial={editingProject} onClose={()=>setEditingProject(null)} onSave={editProject} />}
      {projectModalOpen && <ProjectModal companies={companyList} initialCompanyId={projectModalCompanyId} onClose={() => setProjectModalOpen(false)} onSave={createProject} />}
      {csvImportOpen && <CsvImportModal onClose={() => setCsvImportOpen(false)} onImport={finishCsvImport} />}
      {teamImportOpen && <TeamCsvImportModal project={activeProject} onClose={() => setTeamImportOpen(false)} onImport={finishTeamImport} />}
      {scheduleImportOpen && <ScheduleCsvImportModal project={activeProject} onClose={() => setScheduleImportOpen(false)} onImport={finishScheduleImport} />}
      {teamMemberCreateOpen && <TeamMemberCreateModal project={activeProject} onClose={() => setTeamMemberCreateOpen(false)} onSave={createTeamMember} />}
      {editingTeamMember && <TeamMemberEditModal member={editingTeamMember} onClose={() => setEditingTeamMember(null)} onSave={saveTeamMember} />}
      {teamMemberToDelete && <DeleteTeamMemberModal member={teamMemberToDelete} onClose={() => setTeamMemberToDelete(null)} onConfirm={deleteTeamMember} />}
      {rubricCreateOpen && <RubricModal onClose={()=>setRubricCreateOpen(false)} onSave={createRubric}/>}
      {editingExpense && <NewEntryModal initial={editingExpense} schedule={activeScheduleItems} onOpenSchedule={()=>{setEditingExpense(null);navigate("schedule");}} onClose={()=>setEditingExpense(null)} onSave={editExpense} showToast={showToast}/>}
      {deletingExpense && <DeleteExpenseModal expense={deletingExpense} onClose={()=>setDeletingExpense(null)} onConfirm={()=>deleteExpense(deletingExpense)}/>}
      {scheduleCreateOpen && <ScheduleItemEditModal project={activeProject} rubrics={rubricOptions} onAddRubric={()=>setRubricCreateOpen(true)} onClose={()=>setScheduleCreateOpen(false)} onSave={createScheduleItem}/>}
      {editingScheduleItem && <ScheduleItemEditModal project={activeProject} rubrics={rubricOptions} onAddRubric={()=>setRubricCreateOpen(true)} item={editingScheduleItem} onClose={() => setEditingScheduleItem(null)} onSave={saveScheduleItem} onDelete={()=>setDeletion({entity:"schedule",id:editingScheduleItem.id,version:editingScheduleItem.version,title:"Excluir previsão?",description:`${editingScheduleItem.activity} · ${money(editingScheduleItem.value)}. A exclusão recalcula o planejamento e não pode comprometer despesas já registradas.`})} />}
      {(remapOpen||editingRemap) && <RemapModal initial={editingRemap||undefined} items={activeScheduleItems} project={activeProject} rubrics={rubricOptions} onAddRubric={()=>setRubricCreateOpen(true)} onClose={() => {setRemapOpen(false);setEditingRemap(null);}} onSave={saveRemap} />}
      {selectedExpense && !editingExpense && !deletingExpense && <ExpenseModal onEdit={setEditingExpense} onDelete={setDeletingExpense} expense={entries.find(e=>e.id===selectedExpense.id)||selectedExpense} onClose={() => setSelectedExpense(null)} onUpload={uploadExpense} onUpdate={updateExpense} admin={initial.user.role==="admin"} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Fechar aviso" onClick={() => setToast("")}><X size={16} /></button></div>}
    </div>
  );
}

function CompaniesView({
  companies,
  projects,
  selectedCompanyId,
  activeProjectId,
  onSelectCompany,
  onNewCompany,
  onNewProject,
  onSwitchProject,
}: {
  companies: Company[];
  projects: Project[];
  selectedCompanyId: string;
  activeProjectId: string;
  onSelectCompany: (id: string) => void;
  onNewCompany: () => void;
  onNewProject: (companyId?: string) => void;
  onSwitchProject: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || companies[0];
  const selectedProjects = projects.filter((project) => project.companyId === selectedCompany.id);
  const filteredCompanies = companies.filter((company) => (company.name + company.short + company.cnpj).toLowerCase().includes(query.toLowerCase()));
  const totalApproved = projects.reduce((sum, project) => sum + project.approved, 0);
  const executing = projects.filter((project) => project.status !== "Concluído").length;

  return (
    <>
      <section className="organization-summary">
        <article><span className="organization-stat-icon"><Building2 size={20} /></span><div><span>Empresas cadastradas</span><strong>{companies.length}</strong><small>perfis ativos</small></div></article>
        <article><span className="organization-stat-icon blue"><Rocket size={20} /></span><div><span>Projetos aprovados</span><strong>{projects.length}</strong><small>{executing} em acompanhamento</small></div></article>
        <article><span className="organization-stat-icon amber"><CircleDollarSign size={20} /></span><div><span>Subvenção gerenciada</span><strong>{compactMoney(totalApproved)}</strong><small>em todos os projetos</small></div></article>
        <article><span className="organization-stat-icon green"><ShieldCheck size={20} /></span><div><span>Cadastros completos</span><strong>100%</strong><small>empresas com responsável</small></div></article>
      </section>

      <section className="company-workspace">
        <aside className="panel company-directory">
          <div className="company-directory-header">
            <div><h2>Minhas empresas</h2><span>{companies.length} perfis cadastrados</span></div>
            <button className="icon-button" aria-label="Nova empresa" onClick={onNewCompany}><Plus size={17} /></button>
          </div>
          <div className="company-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou CNPJ" /></div>
          <div className="company-list">
            {filteredCompanies.map((company) => {
              const count = projects.filter((project) => project.companyId === company.id).length;
              return (
                <button key={company.id} className={selectedCompany.id === company.id ? "active" : ""} onClick={() => onSelectCompany(company.id)}>
                  <span className="company-list-avatar">{company.short.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{company.short}</strong><small>{company.cnpj}</small><em>{count} {count === 1 ? "projeto" : "projetos"}</em></span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
          <button className="company-add-button" onClick={onNewCompany}><Plus size={16} /> Cadastrar nova empresa</button>
        </aside>

        <article className="panel company-profile-panel">
          <div className="company-profile-hero">
            <span className="company-profile-avatar">{selectedCompany.short.slice(0, 2).toUpperCase()}</span>
            <div><span className="company-profile-label">Perfil da empresa</span><h2>{selectedCompany.name}</h2><p>{selectedCompany.short} · CNPJ {selectedCompany.cnpj}</p></div>
            <span className="company-active-badge"><span /> Cadastro ativo</span>
          </div>

          <div className="company-profile-details">
            <div><span className="profile-detail-icon"><IdCard size={17} /></span><p><small>CNPJ</small><strong>{selectedCompany.cnpj}</strong></p></div>
            <div><span className="profile-detail-icon"><MapPin size={17} /></span><p><small>Sede</small><strong>{selectedCompany.city} · {selectedCompany.state}</strong></p></div>
            <div><span className="profile-detail-icon"><Users size={17} /></span><p><small>Responsável</small><strong>{selectedCompany.responsible}</strong></p></div>
            <div><span className="profile-detail-icon"><Mail size={17} /></span><p><small>E-mail</small><strong>{selectedCompany.email}</strong></p></div>
            <div><span className="profile-detail-icon"><Phone size={17} /></span><p><small>Telefone</small><strong>{selectedCompany.phone}</strong></p></div>
          </div>

          <div className="company-projects-header">
            <div><span>Projetos aprovados</span><h3>{selectedProjects.length} {selectedProjects.length === 1 ? "projeto vinculado" : "projetos vinculados"}</h3></div>
            <button className="primary-button small" onClick={() => onNewProject(selectedCompany.id)}><Plus size={16} /> Novo projeto</button>
          </div>

          {selectedProjects.length > 0 ? (
            <div className="company-project-grid">
              {selectedProjects.map((project) => {
                const execution = percent(project.executed, project.approved);
                const isActive = project.id === activeProjectId;
                return (
                  <article className={"company-project-card " + (isActive ? "active" : "")} key={project.id}>
                    <div className="company-project-card-top">
                      <span className={"project-status " + (project.status === "A iniciar" ? "starting" : "")}><span />{project.status || "Em execução"}</span>
                      {isActive && <span className="current-project-label">Projeto atual</span>}
                    </div>
                    <div className="company-project-name"><span><Rocket size={18} /></span><div><strong>{project.name}</strong><small>{project.agency} · {project.code}</small></div></div>
                    <div className="company-project-period"><CalendarDays size={14} /> {project.period}</div>
                    <div className="company-project-values"><div><span>Aprovado</span><strong>{money(project.approved)}</strong></div><div><span>Executado</span><strong>{execution}%</strong></div></div>
                    <ProgressBar value={execution} tone={execution === 0 ? "gray" : "green"} />
                    <button onClick={() => onSwitchProject(project.id)}>{isActive ? "Abrir painel" : "Selecionar projeto"} <ArrowRight size={15} /></button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="company-project-empty">
              <span><Rocket size={25} /></span>
              <strong>Nenhum projeto cadastrado</strong>
              <p>Cadastre o primeiro projeto aprovado desta empresa para iniciar o acompanhamento.</p>
              <button className="primary-button" onClick={() => onNewProject(selectedCompany.id)}><Plus size={17} /> Criar primeiro projeto</button>
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function CompanyModal({ onClose, onSave }: { onClose: () => void; onSave: (company: Omit<Company, "id" | "version">) => void }) {
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [responsible, setResponsible] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const valid = Boolean(name && short && cnpj && city && state && responsible && email);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal large company-modal" role="dialog" aria-modal="true" aria-labelledby="company-modal-title">
        <div className="modal-header"><div><span>Novo cadastro</span><h2 id="company-modal-title">Criar perfil da empresa</h2></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={19} /></button></div>
        <div className="creation-flow">
          <div className="active"><span>1</span><p><strong>Perfil da empresa</strong><small>Dados cadastrais</small></p></div>
          <i />
          <div><span>2</span><p><strong>Projeto aprovado</strong><small>Recursos e vigência</small></p></div>
        </div>
        <div className="modal-body">
          <div className="form-section-title"><Building2 size={17} /><div><strong>Dados da organização</strong><span>Informações utilizadas nos projetos e relatórios.</span></div></div>
          <div className="form-grid">
            <label className="field full"><span>Razão social *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome empresarial completo" /></label>
            <label className="field"><span>Nome fantasia *</span><input value={short} onChange={(event) => setShort(event.target.value)} placeholder="Como a empresa será exibida" /></label>
            <label className="field"><span>CNPJ *</span><input value={cnpj} onChange={(event) => setCnpj(event.target.value)} placeholder="00.000.000/0000-00" /></label>
            <label className="field"><span>Cidade *</span><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Município" /></label>
            <label className="field"><span>UF *</span><select value={state} onChange={(event) => setState(event.target.value)}><option value="">Selecione</option>{["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map((uf) => <option key={uf}>{uf}</option>)}</select></label>
          </div>
          <div className="form-section-title second"><Users size={17} /><div><strong>Contato responsável</strong><span>Pessoa responsável pela gestão dos projetos.</span></div></div>
          <div className="form-grid">
            <label className="field full"><span>Nome do responsável *</span><input value={responsible} onChange={(event) => setResponsible(event.target.value)} placeholder="Nome completo" /></label>
            <label className="field"><span>E-mail *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="responsavel@empresa.com.br" /></label>
            <label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 0000-0000" /></label>
          </div>
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={() => onSave({ name, short, cnpj, city, state, responsible, email, phone })}>Salvar e criar projeto <ArrowRight size={17} /></button></div>
      </div>
    </div>
  );
}

function ProjectModal({
  companies,
  initialCompanyId,
  initial,
  onClose,
  onSave,
}: {
  companies: Company[];
  initialCompanyId: string;
  initial?: Project;
  onClose: () => void;
  onSave: (project: ProjectDraft) => void;
}) {
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [name, setName] = useState(initial?.name || "");
  const [code, setCode] = useState(initial?.code || "");
  const [agency, setAgency] = useState(initial?.agency || "");
  const [startDate, setStartDate] = useState(initial?.startDate || "");
  const [endDate, setEndDate] = useState(initial?.endDate || "");
  const [approved, setApproved] = useState(initial ? String(initial.approved) : "");
  const [counterpart, setCounterpart] = useState(initial ? String(initial.counterpart) : "");
  const [installments, setInstallments] = useState(String(initial?.installments || 4));
  const valid = Boolean(companyId && name.trim() && code.trim() && agency.trim() && startDate && endDate && endDate >= startDate && Number.isFinite(Number(approved)) && Number(approved) > 0 && Number.isFinite(Number(counterpart)) && Number(counterpart) >= 0 && Number(installments) > 0);
  const company = companies.find((item) => item.id === companyId);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal large project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <div className="modal-header"><div><span>Cadastro do projeto</span><h2 id="project-modal-title">{initial ? "Editar projeto" : "Cadastrar novo projeto"}</h2></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={19} /></button></div>
        {!initial && <div className="creation-flow">
          <div className="done"><span><Check size={14} /></span><p><strong>Perfil da empresa</strong><small>{company?.short || "Empresa selecionada"}</small></p></div>
          <i />
          <div className="active"><span>2</span><p><strong>Projeto aprovado</strong><small>Recursos e vigência</small></p></div>
        </div>}
        <div className="modal-body">
          <div className="form-section-title"><Rocket size={17} /><div><strong>Identificação do projeto</strong><span>Dados do instrumento de concessão aprovado.</span></div></div>
          <div className="form-grid">
            <label className="field full"><span>Empresa beneficiária *</span><select disabled={Boolean(initial)} value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field full"><span>Nome do projeto *</span><input maxLength={500} value={name} onChange={(event) => setName(event.target.value)} placeholder="Título oficial do projeto aprovado" /></label>
            <label className="field"><span>Número do termo de outorga / convênio *</span><input maxLength={80} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ex.: SUBV-2026-001" /></label>
            <label className="field"><span>Órgão concedente *</span><input required maxLength={100} value={agency} onChange={event=>setAgency(event.target.value)} placeholder="Digite o nome do órgão concedente" /></label>
            <label className="field"><span>Início da vigência *</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span>Fim da vigência *</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
          <div className="form-section-title second"><CircleDollarSign size={17} /><div><strong>Recursos aprovados</strong><span>{initial ? "Valores totais aprovados para cada fonte de recursos." : "Valores que formarão o orçamento inicial do projeto."}</span></div></div>
          <div className="form-grid project-values-form">
            <label className="field money-field"><span>Subvenção aprovada *</span><div><b>R$</b><input type="number" min="0" step="0.01" value={approved} onChange={(event) => setApproved(event.target.value)} placeholder="0,00" /></div></label>
            <label className="field money-field"><span>Contrapartida pactuada</span><div><b>R$</b><input type="number" min="0" step="0.01" value={counterpart} onChange={(event) => setCounterpart(event.target.value)} placeholder="0,00" /></div></label>
            <label className="field full"><span>Número de parcelas *</span><select value={installments} onChange={(event) => setInstallments(event.target.value)}>{Array.from({length:48},(_,i)=>i+1).map((number) => <option key={number} value={number}>{number} {number === 1 ? "parcela" : "parcelas"}</option>)}</select></label>
          </div>
          <div className="project-create-note"><ShieldCheck size={17} /><span>{initial ? <>As alterações mantêm os lançamentos e documentos do projeto. Para reduzir os valores, ajuste antes as previsões que ultrapassem o novo limite; recursos recebidos e despesas executadas continuam protegidos.</> : <><strong>O projeto será criado como “A iniciar”.</strong> Depois você poderá importar as rubricas, registrar as parcelas e anexar o instrumento aprovado.</>}</span></div>
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={() => onSave({ companyId, name, code, agency:agency.trim(), startDate, endDate, approved: Number(approved), counterpart: Number(counterpart) || 0, installments: Number(installments) })}>{initial ? <>Salvar alterações <Check size={17} /></> : <>Criar e acessar projeto <Rocket size={17} /></>}</button></div>
      </div>
    </div>
  );
}

function Overview({
  project, resources, onEditResource,
  rubrics,
  entries,
  navigate,
  openEntry,
}: {
  project: Project; resources:Resource[]; onEditResource:(r:Resource)=>void;
  rubrics: typeof baseRubrics;
  entries: Expense[];
  navigate: (view: View) => void;
  openEntry: (expense: Expense) => void;
}) {
  const [rubricFilter, setRubricFilter] = useState("Todas");
  const subExecuted=project.executedSubvention||0,counterExecuted=project.executedCounterpart||0;
  const executedPct = percent(subExecuted, project.approved);
  const releasedPct = percent(project.released, project.approved);
  const counterpartPct = percent(project.counterpartRealized, project.counterpart);
  const balance = project.released + project.income - subExecuted;
  const filteredRubrics = rubrics.filter((rubric) => rubricFilter === "Todas" || rubric.type === rubricFilter);
  const installmentCount = project.installments || 5;
  const receivedInstallments = project.receivedInstallments?.length || 0;
  const pendingDocs = entries.filter((entry) => entry.docs < entry.requiredDocs).length;
  const pendingReview = entries.filter((entry) => !entry.draft && sourceOf(entry)==="Subvenção" && entry.status !== "Conciliado").length;
  const hasBudget = rubrics.some((rubric) => rubric.approved > 0);

  return (
    <>
      {entries.length > 0 ? (
        <section className="notice-banner">
          <div className="notice-icon"><AlertCircle size={19} /></div>
          <div><strong>{pendingDocs + pendingReview} pendências precisam da sua atenção</strong><span>Há {pendingDocs} lançamentos com documentos incompletos e {pendingReview} aguardando revisão.</span></div>
          <button onClick={() => navigate("entries")}>Revisar agora <ArrowRight size={16} /></button>
        </section>
      ) : hasBudget ? (
        <section className="notice-banner onboarding-notice">
          <div className="notice-icon"><CheckCircle2 size={19} /></div>
          <div><strong>Orçamento importado e pronto para execução</strong><span>As rubricas já estão preenchidas. Agora registre a primeira despesa deste projeto.</span></div>
          <button onClick={() => navigate("entries")}>Abrir lançamentos <ArrowRight size={16} /></button>
        </section>
      ) : (
        <section className="notice-banner onboarding-notice">
          <div className="notice-icon"><Rocket size={19} /></div>
          <div><strong>Organize o planejamento do projeto</strong><span>Cadastre as rubricas e os valores previstos no cronograma.</span></div>
          <button onClick={()=>navigate("schedule")}>Abrir cronograma <ArrowRight size={16} /></button>
        </section>
      )}

      <section className="metrics-grid source-metrics">
        <article className="metric-card featured">
          <div className="metric-card-head"><span>Subvenção aprovada</span><div className="metric-icon"><CircleDollarSign size={20} /></div></div>
          <strong>{money(project.approved)}</strong>
          <div className="metric-footer"><ShieldCheck size={14} /> {project.agency} · {project.code}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card-head"><span>Recursos liberados</span><div className="metric-icon blue"><ArrowDownToLine size={20} /></div></div>
          <strong>{money(project.released)}</strong>
          <div className="metric-progress-row"><ProgressBar value={releasedPct} tone="blue" /><b>{releasedPct}%</b></div>
          <div className="metric-footer muted">{receivedInstallments} de {installmentCount} parcelas recebidas</div>
        </article>
        <article className="metric-card">
          <div className="metric-card-head"><span>Executado · Subvenção</span><div className="metric-icon green"><Gauge size={20} /></div></div>
          <strong>{money(subExecuted)}</strong>
          <div className="metric-progress-row"><ProgressBar value={executedPct} /><b>{executedPct}%</b></div>
          <div className="metric-footer muted">{money(project.approved - subExecuted)} ainda não utilizados</div>
        </article>
        <article className="metric-card">
          <div className="metric-card-head"><span>Executado · Contrapartida</span><div className="metric-icon green"><HandCoins size={20}/></div></div>
          <strong>{money(counterExecuted)}</strong><div className="metric-progress-row"><ProgressBar value={percent(counterExecuted,project.counterpart)}/><b>{percent(counterExecuted,project.counterpart)}%</b></div>
          <div className="metric-footer muted">{money(project.counterpart-counterExecuted)} ainda não utilizados</div>
        </article>
        <article className="metric-card">
          <div className="metric-card-head"><span>Saldo · Subvenção</span><div className="metric-icon amber"><Landmark size={20} /></div></div>
          <strong>{money(balance)}</strong>
          <div className="metric-footer positive"><RefreshCw size={14} /> Atualizado com os registros salvos</div>
        </article>
        <article className="metric-card"><div className="metric-card-head"><span>Saldo · Contrapartida</span><div className="metric-icon amber"><HandCoins size={20}/></div></div><strong>{money(project.counterpartRealized-counterExecuted)}</strong><div className="metric-footer muted">Aportes próprios menos despesas da contrapartida</div></article>
      </section>

      <OverviewResources resources={resources} onEdit={onEditResource} onViewAll={()=>navigate("resources")}/>
      <section className="overview-grid">
        <article className="panel rubric-panel">
          <div className="panel-header">
            <div><h2>Execução por rubrica</h2><p>Percentual utilizado sobre os valores previstos no cronograma</p></div>
            <button className="text-button" onClick={() => navigate("entries")}>Ver lançamentos <ArrowRight size={15} /></button>
          </div>
          <div className="segmented-control">
            {["Todas", "Custeio", "Capital"].map((filter) => <button key={filter} onClick={() => setRubricFilter(filter)} className={rubricFilter === filter ? "active" : ""}>{filter}</button>)}
          </div>
          <div className="rubric-list">
            {filteredRubrics.map((rubric) => {
              const used = percent(rubric.executed, rubric.approved);
              return (
                <div className="rubric-row" key={rubric.name}>
                  <div className="rubric-topline">
                    <div><span className={"rubric-type " + (rubric.type === "Capital" ? "capital" : "")}>{rubric.type}</span><strong>{rubric.name}</strong></div>
                    <div className="rubric-values"><strong>{money(rubric.executed)}</strong><span>de {money(rubric.approved)}</span><b>{used}%</b></div>
                  </div>
                  <ProgressBar value={used} tone={used === 0 ? "gray" : used > 75 ? "amber" : "green"} />
                </div>
              );
            })}
          </div>
        </article>

        <div className="side-stack">
          <article className="panel execution-card">
            <div className="panel-header compact"><div><h2>Execução global</h2><p>Subvenção + contrapartida</p></div></div>
            <div className="donut-row">
              <div className="donut" style={{ background: "conic-gradient(#1f7a5a 0deg " + String(executedPct * 3.6) + "deg, #e7ece9 " + String(executedPct * 3.6) + "deg 360deg)" }}><div><strong>{executedPct}%</strong><span>executado</span></div></div>
              <div className="donut-legend">
                <span><i className="legend-dot subsidy" />Despesas<b>{compactMoney(project.executed)}</b></span>
                <span><i className="legend-dot counterpart" />Aportes próprios<b>{compactMoney(project.counterpartRealized)}</b></span>
                <span><i className="legend-dot remaining" />A executar<b>{compactMoney(project.approved + project.counterpart - project.executed)}</b></span>
              </div>
            </div>
            <div className="counterpart-box">
              <div><span>Contrapartida realizada</span><b>{counterpartPct}%</b></div>
              <ProgressBar value={counterpartPct} tone="amber" />
              <p>{money(project.counterpartRealized)} de {money(project.counterpart)}</p>
            </div>
          </article>

          <article className="panel installments-card">
            <div className="panel-header compact"><div><h2>Fluxo de recursos</h2><p>Parcelas previstas e recebidas</p></div><button className="text-button" onClick={() => navigate("resources")}>Detalhes</button></div>
            <div className="installment-timeline" style={{ gridTemplateColumns: `repeat(${installmentCount}, minmax(72px, 1fr))` }}>
              {Array.from({ length: installmentCount }, (_, index) => index + 1).map((installment) => (
                <div className={"installment-step " + ((project.receivedInstallments || []).includes(installment) ? "done" : "next")} key={installment}>
                  <span>{(project.receivedInstallments || []).includes(installment) ? <Check size={14} /> : installment}</span>
                  <div><strong>{installment}ª parcela</strong><small>{(project.receivedInstallments || []).includes(installment) ? "Recebida" : "Prevista"}</small></div>
                </div>
              ))}
            </div>
            <div className="income-row"><div className="income-icon"><Banknote size={18} /></div><div><span>Rendimentos acumulados</span><strong>{money(project.income)}</strong></div><ArrowRight size={17} /></div>
          </article>
        </div>
      </section>

      <section className="panel recent-panel">
        <div className="panel-header"><div><h2>Lançamentos recentes</h2><p>Últimas movimentações registradas no projeto</p></div><button className="secondary-button small" onClick={() => navigate("entries")}><ArrowRight size={16} /> Ver lançamentos</button></div>
        {entries.length > 0 ? <ExpenseTable entries={entries.slice(0, 5)} onOpen={openEntry} /> : <div className="empty-state compact"><ReceiptText size={27} /><strong>Nenhum lançamento neste projeto</strong><p>Acesse Lançamentos para registrar as despesas do projeto.</p><button className="primary-button" onClick={() => navigate("entries")}><ArrowRight size={17} /> Abrir lançamentos</button></div>}
        <button className="full-width-link" onClick={() => navigate("entries")}>Ver todos os lançamentos <ArrowRight size={16} /></button>
      </section>
    </>
  );
}

function ExpenseTable({ entries, onOpen, onEdit, onDelete }: { entries: Expense[]; onOpen: (expense: Expense) => void; onEdit?:(e:Expense)=>void; onDelete?:(e:Expense)=>void }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Data / ID</th><th>Fornecedor e descrição</th><th>Rubrica</th><th>Documentos</th><th>Valor</th><th>Situação</th><th /></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} onClick={() => onOpen(entry)}>
              <td><strong>{entry.date}</strong><span>{entry.id}</span></td>
              <td><strong>{entry.supplier}</strong><span>{entry.description}</span></td>
              <td><span className="category-pill">{entry.rubric}</span><small>{sourceOf(entry)}{entry.sourceInferred?" · conferir fonte":""}</small></td>
              <td><span className={entry.docs === entry.requiredDocs ? "docs-count complete" : "docs-count incomplete"}>{entry.docs === entry.requiredDocs ? <FileCheck2 size={15} /> : <AlertCircle size={15} />}{entry.docs}/{entry.requiredDocs} anexos</span>{entry.docs<entry.requiredDocs&&<span className="warning-text">Documentos pendentes</span>}</td>
              <td className="value-cell">{money(entry.value)}</td>
              <td><StatusBadge status={entry.status} /></td>
              <td><div className="expense-actions"><button className="row-button" aria-label={"Abrir " + entry.id}><ChevronRight size={17} /></button>{onEdit&&<button className="secondary-button small" onClick={e=>{e.stopPropagation();onEdit(entry);}}><Pencil size={14}/> Editar</button>}{onDelete&&<button className="delete-row-button" onClick={e=>{e.stopPropagation();onDelete(entry);}}><Trash2 size={14}/> Excluir</button>}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Entries({
  entries,
  openEntry,
  newEntry,
  rubrics, onEdit, onDelete,
  projectId,
}: {
  entries: Expense[];
  openEntry: (expense: Expense) => void;
  newEntry: () => void;
  rubrics:RubricOption[]; onEdit:(e:Expense)=>void; onDelete:(e:Expense)=>void;
  projectId: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos");
  const [rubricFilter,setRubricFilter]=useState("Todas as rubricas"),[start,setStart]=useState(""),[end,setEnd]=useState("");
  const filtered = entries.filter((entry) => {
    const matchesQuery = (entry.supplier + entry.description + entry.rubric + entry.id).toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "Todos" || entry.status === status) && (rubricFilter === "Todas as rubricas" || entry.rubric === rubricFilter) && (!start || entry.date >= start) && (!end || entry.date <= end);
  });
  const total = filtered.filter(e=>!e.draft).reduce((sum, entry) => sum + Math.round(entry.value*100), 0)/100;
  return (
    <>
      <section className="summary-strip">
        <div><span>Despesas no filtro (sem rascunhos)</span><strong>{money(total)}</strong></div>
        <div><span>Lançamentos conciliados</span><strong>{entries.filter((entry) => entry.status === "Conciliado").length}</strong><small>de {entries.length} registros</small></div>
        <div><span>Documentação pendente</span><strong className="warning-text">{entries.filter((entry) => entry.docs < entry.requiredDocs).length}</strong><small>itens para revisar</small></div>
        <div><span>Período</span><strong>{start || "Início"} / {end || "Atual"}</strong><small>datas selecionadas</small></div>
      </section>
      <ExpenseDocuments entries={entries} openEntry={openEntry}/>
      <section className="panel">
        <div className="toolbar">
          <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por fornecedor, ID ou rubrica" /></div>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option>Todos</option><option>Conciliado</option><option>Pendente</option><option>Em análise</option></select>
          <select aria-label="Filtrar rubrica" value={rubricFilter} onChange={e=>setRubricFilter(e.target.value)}><option>Todas as rubricas</option>{rubrics.map((rubric) => <option key={rubric.name}>{rubric.name}</option>)}</select>
          <input aria-label="Data inicial" type="date" value={start} onChange={e=>setStart(e.target.value)}/><input aria-label="Data final" type="date" value={end} onChange={e=>setEnd(e.target.value)}/>
          <a className="icon-button" aria-label="Exportar todos os lançamentos" href={"/api/reports/"+projectId}><Download size={17}/></a>
        </div>
        <ExpenseTable entries={filtered} onOpen={openEntry} onEdit={onEdit} onDelete={onDelete} />
        {filtered.length === 0 && <div className="empty-state"><Search size={28} /><strong>Nenhum lançamento encontrado</strong><p>Altere os filtros ou registre uma nova despesa.</p><button className="primary-button" onClick={newEntry}><Plus size={17} /> Novo lançamento</button></div>}
        <div className="table-pagination"><span>Exibindo {filtered.length} de {entries.length} lançamentos</span><div><button disabled><ChevronLeft size={16} /></button><button className="active">1</button><button disabled><ChevronRight size={16} /></button></div></div>
      </section>
    </>
  );
}

function OverviewResources({resources,onEdit,onViewAll}:{resources:Resource[];onEdit:(r:Resource)=>void;onViewAll:()=>void}) {
 const [source,setSource]=useState<FundingSource>("Subvenção");
 const list=resources.filter(r=>resourceSource(r)===source).sort((a,b)=>b.date.localeCompare(a.date));
 return <section className="panel overview-resources"><div className="panel-header"><div><h2>Recursos recebidos</h2><p>Consulte e edite as entradas de recursos do projeto.</p></div><button className="text-button" onClick={onViewAll}>Ver todos <ArrowRight size={15}/></button></div><div className="segmented-control">{(["Subvenção","Contrapartida"] as FundingSource[]).map(item=><button key={item} className={source===item?"active":""} onClick={()=>setSource(item)}>{item}</button>)}</div>{list.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Recurso</th><th>Referência</th><th>Valor</th><th>Ação</th></tr></thead><tbody>{list.slice(0,5).map(r=><tr key={r.id}><td>{r.date.split("-").reverse().join("/")}</td><td>{r.kind}{r.installment&&<small>{r.installment}ª parcela</small>}</td><td>{r.reference||"—"}</td><td>{money(r.value)}</td><td><button className="secondary-button small" onClick={()=>onEdit(r)} aria-label={`Editar ${r.kind} de ${money(r.value)}`}><Pencil size={14}/> Editar recurso</button></td></tr>)}</tbody></table></div>:<div className="empty-state compact"><p>Nenhum recurso de {source.toLowerCase()} lançado.</p></div>}{list.length>5&&<p className="panel-note">Exibindo os 5 recursos mais recentes de {list.length}. Use “Ver todos” para acessar os demais.</p>}</section>;
}

function Resources({project,resources,onAdd,onEdit,onDelete}:{project:Project;resources:Resource[];onAdd:()=>void;onEdit:(r:Resource)=>void;onDelete:(r:Resource)=>void}) {
  return <><section className="summary-strip"><div><span>Subvenção recebida</span><strong>{money(project.released)}</strong></div><div><span>Contrapartida financeira</span><strong>{money(project.counterpartRealized)}</strong></div><div><span>Rendimentos da subvenção</span><strong>{money(project.income)}</strong></div></section><section className="panel"><div className="panel-header"><div><h2>Entradas de recursos</h2><p>Créditos efetivamente registrados no projeto.</p></div><button className="secondary-button" onClick={onAdd}>Registrar recurso</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Tipo / Fonte</th><th>Parcela</th><th>Referência</th><th>Valor</th><th>Comprovante</th><th>Ações</th></tr></thead><tbody>{resources.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.kind}<small>{resourceSource(r)}</small></td><td>{r.installment||"—"}</td><td>{r.reference||"—"}</td><td>{money(r.value)}</td><td>{r.documents.length?r.documents.map(d=><a key={d.id} href={"/api/documents/"+d.id}>{d.name}</a>):"Sem comprovante"}</td><td><div className="expense-actions"><button className="secondary-button small" onClick={()=>onEdit(r)}><Pencil size={14}/> Editar</button><button className="delete-row-button" onClick={()=>onDelete(r)}><Trash2 size={14}/> Excluir</button></div></td></tr>)}</tbody></table></div>{!resources.length&&<div className="empty-state compact"><p>Nenhum recurso recebido foi registrado.</p></div>}</section></>;
}

function Reconciliation({project,entries,resources}:{project:Project;entries:Expense[];resources:Resource[]}) {
  const [filter,setFilter]=useState("Todos");
  const movements=[...resources.filter(r=>resourceSource(r)==="Subvenção").map(r=>({id:r.id,date:r.date,name:r.kind,reference:r.reference,value:r.value,kind:"Entrada",status:"Registrado"})),...entries.filter(e=>!e.draft&&sourceOf(e)==="Subvenção").map(e=>({id:e.id,date:e.date,name:e.supplier,reference:e.description,value:-e.value,kind:"Saída",status:e.status}))].sort((a,b)=>b.date.localeCompare(a.date));
  const executed=project.executedSubvention||0,balance=project.released+project.income-executed;
  return <><section className="summary-strip"><div><span>Entradas da subvenção e rendimentos</span><strong>{money(project.released+project.income)}</strong></div><div><span>Despesas da subvenção</span><strong>{money(executed)}</strong></div><div><span>Saldo da conta de subvenção</span><strong>{money(balance)}</strong></div></section><section className="panel"><div className="panel-header"><div><h2>Conciliação da conta de subvenção</h2><p>Compare estas movimentações com o extrato da conta vinculada à subvenção.</p></div><select aria-label="Filtrar movimentações" value={filter} onChange={e=>setFilter(e.target.value)}>{["Todos","Entrada","Saída"].map(v=><option key={v}>{v}</option>)}</select></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{movements.filter(m=>filter==="Todos"||m.kind===filter).map(m=><tr key={m.id}><td>{m.date}</td><td><strong>{m.name}</strong><span>{m.reference}</span></td><td>{m.kind}</td><td>{money(m.value)}</td><td>{m.status}</td></tr>)}</tbody></table></div><p className="panel-note">A conferência de despesas da subvenção é registrada ao abrir o lançamento. O saldo é calculado com os registros salvos; a conferência do extrato é manual.</p></section></>;
}

function Remaps({project,remaps,openModal,onEdit,onDelete}:{project:Project;remaps:Remap[];openModal:()=>void;onEdit:(r:Remap)=>void;onDelete:(r:Remap)=>void}) {
 return <><section className="summary-strip"><div><span>Subvenção aprovada</span><strong>{money(project.approved)}</strong></div><div><span>Remanejamentos aplicados</span><strong>{money(remaps.filter(r=>r.status==="Aprovado").reduce((s,r)=>s+r.value,0))}</strong></div></section><section className="panel"><div className="panel-header"><div><h2>Remanejamentos</h2><p>Os valores são transferidos no cronograma assim que você salva.</p></div><button className="primary-button" onClick={openModal}>Novo remanejamento</button></div><div className="remap-list">{remaps.map(r=><article className="remap-card" key={r.id}><div className="remap-card-top"><span className="category-pill">{r.status==="Aprovado"?"Aplicado":"Pendente anterior"} · {sourceOf(r)}</span><strong>{money(r.value)}</strong></div><div className="remap-flow"><div><small>Origem</small><strong>{r.from}</strong>{r.sourceActivity&&<p>{r.sourceActivity}</p>}</div><ArrowRight/><div><small>Destino</small><strong>{r.to}</strong>{r.activity&&<p>{r.activity} · {r.month}/{r.year}</p>}</div></div><RemapReason reason={r.reason}/><div className="remap-footer"><span>Registrado em {r.date.split("-").reverse().join("/")}</span><div className="expense-actions"><button className="secondary-button small" onClick={()=>onEdit(r)}><Pencil size={14}/> Editar</button><button className="delete-row-button" onClick={()=>onDelete(r)}><Trash2 size={14}/> Excluir</button></div></div></article>)}{!remaps.length&&<div className="empty-state compact"><p>Nenhum remanejamento registrado.</p></div>}</div></section></>;
}

function RemapReason({reason}:{reason:string}) {
 const [expanded,setExpanded]=useState(false);
 return <div className="remap-reason"><span className="detail-label">Justificativa do remanejamento</span><p className={expanded||(reason.length<=180&&reason.split("\n").length<=3)?"":"clamped"}>{reason}</p>{(reason.length>180||reason.split("\n").length>3)&&<button className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"Recolher justificativa":"Ler justificativa completa"}<ChevronDown size={15}/></button>}</div>;
}

const expenseDocumentLabels:Record<string,string>={invoice:"Nota fiscal / recibo",payment:"Comprovante",quote1:"Orçamento 1",quote2:"Orçamento 2",quote3:"Orçamento 3"};
function ExpenseDocuments({entries,openEntry}:{entries:Expense[];openEntry:(e:Expense)=>void}) {
 const [pendingOnly,setPendingOnly]=useState(false);
 const groups=Array.from(new Set(entries.map(e=>JSON.stringify([e.rubric,sourceOf(e)])))).map(key=>{
   const [rubric,source]=JSON.parse(key) as [string,string];
   const list=entries.filter(e=>e.rubric===rubric&&sourceOf(e)===source),complete=list.filter(e=>e.docs===e.requiredDocs).length;
   return {key,rubric,source,list,complete};
 });
 return <section className="panel expense-document-panel"><div className="panel-header"><div><h2>Documentos por rubrica</h2><p>Nota fiscal, comprovante e três orçamentos por lançamento. Todos os anexos são opcionais.</p></div><label className="check-filter"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/> Somente com anexos a completar</label></div>
 <div className="rubric-checklist">{groups.filter(g=>!pendingOnly||g.complete<g.list.length).map(g=><details key={g.key} className="rubric-document-group"><summary><div><strong>{g.rubric}</strong><small>{g.source} · {g.list.length} lançamento(s)</small></div><span className={g.complete===g.list.length?"checklist-status complete":"checklist-status"}>{g.complete===g.list.length?<CheckCircle2 size={17}/>:<Paperclip size={17}/>} {g.complete}/{g.list.length} com todos os anexos</span><ChevronDown size={18}/></summary><div className="rubric-document-items">{g.list.filter(e=>!pendingOnly||e.docs<e.requiredDocs).map(e=><button key={e.id} className="expense-document-row" onClick={()=>openEntry(e)}><div><strong>{e.supplier}</strong><span>{e.description}</span><small>{e.date.split("-").reverse().join("/")} · {money(e.value)}{e.draft?" · Rascunho":""}</small></div><div className="document-checks">{Object.entries(expenseDocumentLabels).map(([kind,label])=><span key={kind} className={e.documents?.some(d=>d.kind===kind)?"done":"missing"}>{e.documents?.some(d=>d.kind===kind)?<Check size={13}/>:<Clock3 size={13}/>} {label}</span>)}</div><span className="document-row-action">Ver / anexar <ChevronRight size={16}/></span></button>)}</div></details>)}</div>
 {(!groups.length||pendingOnly&&groups.every(g=>g.complete===g.list.length))&&<div className="empty-state compact"><FileCheck2 size={26}/><p>{groups.length?"Todos os lançamentos têm os cinco anexos.":"O acompanhamento aparecerá quando você cadastrar o primeiro lançamento."}</p></div>}</section>;
}

function Documents({documents,onAdd,onEdit,onDelete}:{documents:ProjectDocument[];onAdd:()=>void;onEdit:(d:ProjectDocument)=>void;onDelete:(d:ProjectDocument)=>void}) {
 const [query,setQuery]=useState("");
 const visible=documents.filter(d=>(d.name+" "+d.filename).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <section className="panel project-document-panel"><div className="panel-header"><div><h2>Arquivo do projeto <span className="count-badge">{documents.length}</span></h2><p>Documentos institucionais, versões do projeto e termos assinados.</p></div><div className="search-field"><Search size={17}/><input aria-label="Buscar documento" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar pelo nome do documento"/></div></div>
 <div className="project-document-grid">{visible.map(d=><article key={d.id} className="project-document-card"><div className="project-document-icon"><FileText size={25}/><span>{d.mime==="application/pdf"?"PDF":d.filename.toLowerCase().endsWith(".xlsx")?"XLSX":d.filename.toLowerCase().endsWith(".xls")?"XLS":"IMAGEM"}</span></div><h3>{d.name}</h3><p title={d.filename}>{d.filename}</p><small>{(d.size/1024/1024).toLocaleString("pt-BR",{maximumFractionDigits:2})} MB · {d.createdAt.slice(0,10).split("-").reverse().join("/")}</small><div className="project-document-actions"><a className="secondary-button small" href={"/api/projectDocuments/"+d.id}><Download size={15}/> Baixar</a><button className="icon-button" aria-label={"Editar "+d.name} onClick={()=>onEdit(d)}><Pencil size={16}/></button><button className="icon-button" aria-label={"Excluir "+d.name} onClick={()=>onDelete(d)}><Trash2 size={16}/></button></div></article>)}</div>
 {!visible.length&&<div className="empty-state"><FolderOpen size={32}/><strong>{query?"Nenhum documento encontrado":"Guarde os documentos do projeto aqui"}</strong><p>{query?"Tente outro nome.":"Adicione o projeto original, o termo de outorga ou outro arquivo e dê um nome para encontrá-lo facilmente."}</p>{!query&&<button className="primary-button" onClick={onAdd}><Plus size={17}/> Adicionar primeiro documento</button>}</div>}</section>;
}

function ProjectDocumentModal({initial,onClose,onSave}:{initial?:ProjectDocument;onClose:()=>void;onSave:(name:string,file?:File)=>void}) {
 const [name,setName]=useState(initial?.name||""),[file,setFile]=useState<File|undefined>();
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="project-document-title"><div className="modal-header"><div><span>Arquivo do projeto</span><h2 id="project-document-title">{initial?"Editar documento":"Adicionar documento"}</h2></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20}/></button></div><div className="modal-body"><label className="field"><span>Nome do documento *</span><input autoFocus maxLength={200} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Projeto original ou Termo de outorga"/></label><div className="upload-section"><UploadBox accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" label={initial?"Substituir arquivo (opcional)":"Arquivo do documento *"} file={file?.name} onFile={setFile}/>{initial&&<p className="panel-note">Arquivo atual: {initial.filename}. Se não selecionar outro, o arquivo será mantido.</p>}</div><p className="panel-note">PDF, JPG, PNG, XLS ou XLSX · até 10 MB por arquivo.</p></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!name.trim()||(!initial&&!file)||Boolean(file&&file.size>10*1024*1024)} onClick={()=>onSave(name,file)}>Salvar documento</button></div>{file&&file.size>10*1024*1024&&<p role="alert" className="panel-note">O arquivo deve ter no máximo 10 MB.</p>}</section></div>;
}

function ProjectLinksView({
  project,
  links,
  onAdd, onEdit,
}: {
  project: Project;
  links: ProjectLink[];
  onAdd: () => void; onEdit:(link:ProjectLink)=>void;
}) {
  return (
    <>
      <section className="project-links-intro">
        <div className="project-links-intro-icon"><Link2 size={23} /></div>
        <div>
          <span>Biblioteca de acessos</span>
          <h2>Referências de {project.name}</h2>
          <p>Guarde portais, pastas compartilhadas e páginas de consulta em um único lugar.</p>
        </div>
        <div className="project-links-count"><strong>{links.length}</strong><span>{links.length === 1 ? "link cadastrado" : "links cadastrados"}</span></div>
      </section>

      <section className="panel project-links-panel">
        <div className="panel-header">
          <div><h2>Links do projeto</h2><p>Os endereços abaixo ficam vinculados somente ao projeto selecionado.</p></div>
        </div>
        {links.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table project-links-table">
              <thead><tr><th>Nome</th><th>Endereço</th><th>Data de anexo</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td><div className="project-link-name"><span><Link2 size={17} /></span><strong>{link.name}</strong></div></td>
                    <td><a className="project-link-url" href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</a></td>
                    <td><span className="project-link-date"><CalendarDays size={15} /> {link.addedAt}</span></td>
                    <td><div className="expense-actions"><button className="secondary-button small" onClick={()=>onEdit(link)}><Pencil size={14}/> Editar</button><a className="secondary-button small project-link-open" href={link.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${link.name}`}>Abrir link <ExternalLink size={14} /></a></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state compact"><Link2 size={29} /><strong>Nenhum link cadastrado</strong><p>Adicione o primeiro endereço importante deste projeto.</p><button className="primary-button small" onClick={onAdd}><Plus size={15} /> Adicionar link</button></div>
        )}
      </section>
    </>
  );
}

function TeamView({
  project,
  members,
  onImport,
  onAdd,
  onEdit,
  onDelete,
}: {
  project: Project;
  members: TeamMember[];
  onImport: () => void;
  onAdd: () => void;
  onEdit: (member: TeamMember) => void;
  onDelete: (member: TeamMember) => void;
}) {
  const roles = new Set(members.map((member) => normalizeCsvText(member.role))).size;
  const activities = members.filter((member) => member.activity.trim()).length;

  return (
    <>
      <section className="management-summary-grid">
        <article><span className="management-summary-icon"><Users size={20} /></span><div><span>Membros vinculados</span><strong>{members.length}</strong><small>neste projeto</small></div></article>
        <article><span className="management-summary-icon amber"><IdCard size={20} /></span><div><span>Funções cadastradas</span><strong>{roles}</strong><small>responsabilidades definidas</small></div></article>
        <article><span className="management-summary-icon blue"><ClipboardCheck size={20} /></span><div><span>Atividades descritas</span><strong>{activities}</strong><small>registros completos</small></div></article>
      </section>

      <section className="panel management-table-panel">
        <div className="panel-header management-panel-header">
          <div><h2>Equipe de {project.name}</h2><p>Os membros abaixo ficam vinculados somente ao projeto selecionado.</p></div>
          <button className="secondary-button small" onClick={onImport}><FileSpreadsheet size={15} /> Importar outro CSV</button>
        </div>
        {members.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table management-table team-table">
              <thead><tr><th>Nome</th><th>Função</th><th>Atividade no projeto</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {members.map((member) => {
                  const initials = member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
                  return (
                    <tr key={member.id}>
                      <td><div className="member-name-cell"><span>{initials}</span><strong>{member.name}</strong></div></td>
                      <td><span className="management-role-pill">{member.role}</span></td>
                      <td><p className="management-activity">{member.activity}</p></td>
                      <td><div className="team-row-actions"><button className="secondary-button small" onClick={() => onEdit(member)}><Pencil size={14} /> Editar</button><button className="delete-row-button" onClick={() => onDelete(member)} aria-label={`Excluir ${member.name}`}><Trash2 size={15} /> Excluir</button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state management-empty"><Users size={31} /><strong>Nenhum membro cadastrado</strong><p>Adicione um membro manualmente ou importe um CSV com nome, função e atividade.</p><div className="empty-state-actions"><button className="primary-button small" onClick={onAdd}><Plus size={15} /> Adicionar membro</button><button className="secondary-button small" onClick={onImport}><FileSpreadsheet size={15} /> Importar equipe</button></div></div>
        )}
      </section>
    </>
  );
}

function ScheduleView({
  project,
  items,
  onImport,
  onAdd,
  onEdit,
}: {
  project: Project;
  items: ScheduleItem[];
  onImport: () => void;
  onAdd: () => void;
  onEdit: (item: ScheduleItem) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"Todas" | ScheduleStatus>("Todas");
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const statusCounts: Record<ScheduleStatus, number> = {
    "Não iniciada": items.filter((item) => item.status === "Não iniciada").length,
    "Em andamento": items.filter((item) => item.status === "Em andamento").length,
    "Concluída": items.filter((item) => item.status === "Concluída").length,
    "Atrasada": items.filter((item) => item.status === "Atrasada").length,
  };
  const tasksToDo = items.length - statusCounts["Concluída"];
  const completion = percent(statusCounts["Concluída"], items.length);
  const statusPriority: Record<ScheduleStatus, number> = { "Atrasada": 0, "Em andamento": 1, "Não iniciada": 2, "Concluída": 3 };
  const visibleItems = [...items]
    .filter((item) => statusFilter === "Todas" || item.status === statusFilter)
    .sort((left, right) => statusPriority[left.status] - statusPriority[right.status] || ((left.year||0)*12+projectMonths.indexOf(left.month)) - ((right.year||0)*12+projectMonths.indexOf(right.month)));
  const filterOptions: Array<"Todas" | ScheduleStatus> = ["Todas", "Atrasada", "Em andamento", "Não iniciada", "Concluída"];

  return (
    <>
      <section className="management-summary-grid schedule-management-summary">
        <article><span className="management-summary-icon"><CalendarDays size={20} /></span><div><span>Itens planejados</span><strong>{items.length}</strong><small>etapas do projeto</small></div></article>
        <article><span className="management-summary-icon amber"><Clock3 size={20} /></span><div><span>Tarefas a fazer</span><strong>{tasksToDo}</strong><small>{statusCounts["Atrasada"] > 0 ? `${statusCounts["Atrasada"]} em atraso` : "nenhuma em atraso"}</small></div></article>
        <article className="schedule-progress-card"><span className="management-summary-icon blue"><Gauge size={20} /></span><div><span>Execução do cronograma</span><strong>{completion}%</strong><div className="schedule-mini-progress" aria-label={`${completion}% do cronograma concluído`}><span style={{ width: `${completion}%` }} /></div></div></article>
        <article><span className="management-summary-icon"><CircleDollarSign size={20} /></span><div><span>Valor programado</span><strong className="management-money">{money(total)}</strong><small>soma do cronograma</small></div></article>
      </section>

      <section className="panel management-table-panel">
        <div className="panel-header management-panel-header">
          <div><h2>Cronograma de {project.name}</h2><p>Atividades, valores e meses previstos para a execução do projeto.</p></div>
          <button className="secondary-button small" onClick={onImport}><FileSpreadsheet size={15} /> Importar planilha</button>
        </div>
        {items.length > 0 ? (
          <>
            <div className="schedule-smart-toolbar">
              <div className="schedule-priority-note"><Gauge size={16} /><span><strong>Ordem inteligente</strong>Atrasadas e em andamento aparecem primeiro.</span></div>
              <div className="schedule-status-filters" aria-label="Filtrar cronograma por status">
                {filterOptions.map((filter) => {
                  const count = filter === "Todas" ? items.length : statusCounts[filter];
                  return <button key={filter} className={statusFilter === filter ? "active" : ""} onClick={() => setStatusFilter(filter)}>{filter}<b>{count}</b></button>;
                })}
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table management-table schedule-table">
                <thead><tr><th>Rubrica</th><th>Fonte</th><th>Atividade</th><th>Valor</th><th>Mês</th><th>Status</th><th aria-label="Ações" /></tr></thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id} className={`schedule-row status-${normalizeCsvText(item.status).replace(/\s+/g, "-")}`}>
                      <td><strong className="schedule-item-title">{item.rubric||item.item}</strong>{item.recurrenceId&&<span>Mensal · parcela {item.installment}/{item.installments}</span>}</td>
                      <td><span className="category-pill">{sourceOf(item)}</span>{item.sourceInferred&&<small>Conferir fonte</small>}</td><td><p className="management-activity schedule-activity">{item.activity}</p></td>
                      <td><strong className="schedule-value">{money(item.value)}</strong></td>
                      <td><span className="schedule-month"><CalendarDays size={14} /> {item.month}{item.year?` / ${item.year}`:""}</span></td>
                      <td><ScheduleStatusBadge status={item.status} /></td>
                      <td><button className="secondary-button small edit-row-button" onClick={() => onEdit(item)}><Pencil size={14} /> Editar</button></td>
                    </tr>
                  ))}
                  {visibleItems.length === 0 && <tr className="schedule-filter-empty"><td colSpan={7}><span>Nenhuma tarefa possui este status.</span><button onClick={() => setStatusFilter("Todas")}>Mostrar todas</button></td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={3}>Total programado</td><td>{money(total)}</td><td colSpan={3}>{visibleItems.length} de {items.length} {items.length === 1 ? "item" : "itens"}</td></tr></tfoot>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state management-empty"><CalendarDays size={31} /><strong>Nenhum item no cronograma</strong><p>Adicione uma previsão ou importe um CSV com rubrica, atividade, valor e mês.</p><button className="primary-button small" onClick={onAdd}><Plus size={15} /> Adicionar previsão</button></div>
        )}
      </section>
    </>
  );
}

function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const tone = status === "Concluída" ? "completed" : status === "Em andamento" ? "progress" : status === "Atrasada" ? "late" : "not-started";
  return <span className={`schedule-status-badge ${tone}`}><span />{status}</span>;
}

function Reports({project,entries}:{project:Project;entries:Expense[]}) {
 const pending=entries.filter(e=>e.docs<e.requiredDocs).length;
 return <div className="reports-hub"><section className="panel report-primary"><div className="report-primary-copy"><span className="report-eyebrow"><FileText size={18}/> RELATÓRIO GERENCIAL</span><h2>Uma visão completa do seu projeto</h2><p>Reúna o planejamento, a execução financeira e os registros do projeto em um documento pronto para compartilhar.</p><div className="report-project-name"><strong>{project.name}</strong><span>{project.code} · {project.agency}</span></div><a className="primary-button" href={"/api/reports/"+project.id+"?format=html"} target="_blank" rel="noreferrer"><ExternalLink size={18}/> Visualizar relatório</a><small className="report-pdf-hint">Na visualização, use “Imprimir / Salvar em PDF” para baixar uma cópia.</small></div><div className="report-contents"><h3>O que você encontrará</h3>{[{icon:CircleDollarSign,title:"Finanças e execução",text:"Resumo por fonte, rubricas, recursos e parcelas."},{icon:CalendarDays,title:"Planejamento do projeto",text:"Cronograma, remanejamentos e equipe técnica."},{icon:ClipboardCheck,title:"Prestação de contas",text:"Despesas, checklist de anexos e conciliação da subvenção."},{icon:FolderOpen,title:"Documentos e referências",text:"Relação de documentos gerais e links do projeto."}].map(({icon:Icon,title,text})=><div key={title}><Icon size={20}/><span><strong>{title}</strong><small>{text}</small></span></div>)}</div></section>
 <section className="summary-strip"><div><span>Executado · Subvenção</span><strong>{money(project.executedSubvention||0)}</strong></div><div><span>Executado · Contrapartida</span><strong>{money(project.executedCounterpart||0)}</strong></div><div><span>Lançamentos</span><strong>{entries.length}</strong><small>{pending} com anexos a completar</small></div></section>
 <section className="panel report-export"><div className="report-export-icon"><FileSpreadsheet size={26}/></div><div><h3>Trabalhar com os lançamentos em planilha</h3><p>Exporte as despesas do projeto para analisar no Excel ou Google Sheets.</p></div><a className="secondary-button" href={"/api/reports/"+project.id}><Download size={17}/> Baixar CSV</a></section>
 <details className="panel report-advanced"><summary>Exportação de dados para uso técnico <ChevronDown size={17}/></summary><div><p>Baixe os registros estruturados do projeto em JSON. Os arquivos anexados não são incluídos; baixe-os em Lançamentos ou Documentos.</p><a className="secondary-button small" href={"/api/reports/"+project.id+"?format=json"}><Download size={16}/> Baixar dados JSON</a></div></details></div>;
}

function normalizeCsvText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeCsvHeader(value: string) {
  return normalizeCsvText(value).replace(/[^a-z0-9]/g, "");
}

function parseBrazilianNumber(value: string) {
  const cleaned = value.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!cleaned) return Number.NaN;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (cleaned.includes(",")) return Number(cleaned.replace(",", "."));
  return Number(cleaned);
}

function parseBudgetCsv(text: string): { rows: CsvBudgetRow[]; error: string } {
  const lines: string[][] = csvRecords(text);
  if (lines.length < 2) return { rows: [], error: "O arquivo precisa ter um cabeçalho e pelo menos uma linha de dados." };

  const headers = lines[0].map(normalizeCsvHeader);
  const required = [
    { key: "fonte", label: "fonte" },
    { key: "elemento", label: "elemento" },
    { key: "descricao", label: "descrição" },
    { key: "unitario", label: "unitário" },
    { key: "qtd", label: "qtd" },
    { key: "valortotal", label: "valor total" },
  ];
  const missing = required.filter((column) => !headers.includes(column.key));
  if (missing.length) {
    return { rows: [], error: "Colunas ausentes: " + missing.map((column) => column.label).join(", ") + "." };
  }

  const indexOf = (key: string) => headers.indexOf(key);
  const rows = lines.slice(1).map((line) => {
    const cells = line;
    const rawElement = cells[indexOf("elemento")] || "";
    const knownRubric = baseRubrics.find((rubric) => normalizeCsvText(rubric.name) === normalizeCsvText(rawElement));
    const row: CsvBudgetRow = {
      fonte: cells[indexOf("fonte")] || "",
      elemento: knownRubric?.name || rawElement,
      descricao: cells[indexOf("descricao")] || "",
      unitario: parseBrazilianNumber(cells[indexOf("unitario")] || ""),
      qtd: parseBrazilianNumber(cells[indexOf("qtd")] || ""),
      valorTotal: parseBrazilianNumber(cells[indexOf("valortotal")] || ""),
      issues: [],
    };
    if (!row.fonte) row.issues.push("Fonte não informada");
    if (!knownRubric) row.issues.push("Elemento não reconhecido");
    if (!row.descricao) row.issues.push("Descrição não informada");
    if (!Number.isFinite(row.unitario) || row.unitario <= 0) row.issues.push("Valor unitário inválido");
    if (!Number.isFinite(row.qtd) || row.qtd <= 0) row.issues.push("Quantidade inválida");
    if (!Number.isFinite(row.valorTotal) || row.valorTotal <= 0) row.issues.push("Valor total inválido");
    return row;
  });

  return { rows, error: "" };
}

function parseProjectCsv(text: string, kind: "team"): { rows: CsvTeamRow[]; error: string };
function parseProjectCsv(text: string, kind: "schedule"): { rows: CsvScheduleRow[]; error: string };
function parseProjectCsv(text: string, kind: "team" | "schedule") {
  const lines: string[][] = csvRecords(text);
  if (lines.length < 2) return { rows: [], error: "O arquivo precisa ter um cabeçalho e pelo menos uma linha de dados." };

  const headers = lines[0].map(normalizeCsvHeader).map(h=>kind==="schedule"&&h==="item"?"rubrica":h);
  const required = kind === "team"
    ? [{ key: "nome", label: "nome" }, { key: "funcao", label: "função" }, { key: "atividade", label: "atividade" }]
    : [{ key: "rubrica", label: "rubrica" }, { key: "atividade", label: "atividade" }, { key: "valor", label: "valor" }, { key: "mes", label: "mês" }];
  const missing = required.filter((column) => !headers.includes(column.key));
  if (missing.length) return { rows: [], error: "Colunas ausentes: " + missing.map((column) => column.label).join(", ") + "." };

  const indexOf = (key: string) => headers.indexOf(key);
  if (kind === "team") {
    const rows: CsvTeamRow[] = lines.slice(1).map((line) => {
      const cells = line;
      const row: CsvTeamRow = {
        nome: cells[indexOf("nome")] || "",
        funcao: cells[indexOf("funcao")] || "",
        atividade: cells[indexOf("atividade")] || "",
        issues: [],
      };
      if (!row.nome) row.issues.push("Nome não informado");
      if (!row.funcao) row.issues.push("Função não informada");
      if (!row.atividade) row.issues.push("Atividade não informada");
      return row;
    });
    return { rows, error: "" };
  }

  const rows: CsvScheduleRow[] = lines.slice(1).map((line) => {
    const cells = line;
    const rawMonth = cells[indexOf("mes")] || "";
    const recognizedMonth = projectMonths.find((month) => normalizeCsvText(month) === normalizeCsvText(rawMonth));
    const row: CsvScheduleRow = {
      item: cells[indexOf("rubrica")] || "",
      source: (headers.includes("fonte") ? ({subvencao:"Subvenção",contrapartida:"Contrapartida"} as Record<string,string>)[normalizeCsvText(cells[indexOf("fonte")]||"")] : undefined) as FundingSource | undefined,
      year:headers.includes("ano")&&cells[indexOf("ano")]?Number(cells[indexOf("ano")]):undefined,
      monthsCount:headers.includes("meses")&&cells[indexOf("meses")]?Number(cells[indexOf("meses")]):1,
      atividade: cells[indexOf("atividade")] || "",
      valor: parseBrazilianNumber(cells[indexOf("valor")] || ""),
      mes: recognizedMonth || rawMonth,
      issues: [],
    };
    if(["pro-labore","pro labore","prolabore"].includes(normalizeCsvText(row.item)))row.item="Pessoal / Pró-labore";
    if(headers.includes("fonte")&&!row.source)row.issues.push("Fonte deve ser Subvenção ou Contrapartida");
    if(!headers.includes("fonte"))row.source=row.item==="Contrapartida"?"Contrapartida":"Subvenção";
    if (!row.item) row.issues.push("Rubrica não informada");
    if(row.year!==undefined&&(!Number.isInteger(row.year)||row.year<2000||row.year>2200))row.issues.push("Ano inválido");
    if(!Number.isInteger(row.monthsCount)||row.monthsCount!<1||row.monthsCount!>60)row.issues.push("Quantidade de meses inválida");
    if(row.monthsCount!>1&&normalizeCsvText(row.item)!==normalizeCsvText("Pessoal / Pró-labore"))row.issues.push("Use meses apenas para Pessoal / Pró-labore");
    if (!row.atividade) row.issues.push("Atividade não informada");
    if (!Number.isFinite(row.valor) || row.valor <= 0) row.issues.push("Valor inválido");
    if (!row.mes) row.issues.push("Mês não informado");
    else if (!recognizedMonth) row.issues.push("Informe um mês de janeiro a dezembro");
    return row;
  });
  return { rows, error: "" };
}

const sampleTeamRows: CsvTeamRow[] = [
  { nome: "Marina Alves", funcao: "Coordenadora do projeto", atividade: "Gestão técnica, acompanhamento das metas e articulação com a financiadora.", issues: [] },
  { nome: "Rafael Moura", funcao: "Pesquisador de materiais", atividade: "Formulação, testes laboratoriais e validação dos protótipos.", issues: [] },
  { nome: "Camila Nunes", funcao: "Analista financeira", atividade: "Controle das rubricas, documentos fiscais e prestação de contas.", issues: [] },
];

const sampleScheduleRows: CsvScheduleRow[] = [
  { item: "Consultoria", atividade: "Levantar os requisitos, definir as especificações técnicas e consolidar o plano de execução do projeto.", valor: 42000, mes: "Janeiro", issues: [] },
  { item: "Material de Consumo", atividade: "Selecionar fornecedores, realizar as compras previstas e organizar os materiais necessários para os testes.", valor: 86500, mes: "Fevereiro", issues: [] },
  { item: "Serviços de Terceiros - PJ", atividade: "Projetar, programar e testar os módulos da plataforma previstos no escopo aprovado.", valor: 148000, mes: "Março", issues: [] },
];

const sampleCsvRows: CsvBudgetRow[] = [
  { fonte: "Subvenção", elemento: "Material de Consumo", descricao: "Resina biodegradável para protótipos", unitario: 85, qtd: 120, valorTotal: 10200, issues: [] },
  { fonte: "Subvenção", elemento: "Material Permanente", descricao: "Extrusora de bancada", unitario: 45000, qtd: 1, valorTotal: 45000, issues: [] },
  { fonte: "Subvenção", elemento: "Consultoria", descricao: "Modelagem de processo industrial", unitario: 8500, qtd: 2, valorTotal: 17000, issues: [] },
  { fonte: "Subvenção", elemento: "Bolsa", descricao: "Bolsa de desenvolvimento tecnológico", unitario: 3200, qtd: 6, valorTotal: 19200, issues: [] },
  { fonte: "Contrapartida", elemento: "Passagem", descricao: "Visitas técnicas aos fornecedores", unitario: 1800, qtd: 4, valorTotal: 7200, issues: [] },
  { fonte: "Subvenção", elemento: "Serviços de Terceiros - PF", descricao: "Parecer técnico especializado", unitario: 6000, qtd: 1, valorTotal: 6000, issues: [] },
];

function TeamCsvImportModal({
  project,
  onClose,
  onImport,
}: {
  project: Project;
  onClose: () => void;
  onImport: (rows: CsvTeamRow[]) => void;
}) {
  return <OperationalCsvImportModal kind="team" project={project} onClose={onClose} onImport={(rows) => onImport(rows as CsvTeamRow[])} />;
}

function ScheduleCsvImportModal({
  project,
  onClose,
  onImport,
}: {
  project: Project;
  onClose: () => void;
  onImport: (rows: CsvScheduleRow[]) => void;
}) {
  return <OperationalCsvImportModal kind="schedule" project={project} onClose={onClose} onImport={(rows) => onImport(rows as CsvScheduleRow[])} />;
}

function OperationalCsvImportModal({
  kind,
  project,
  onClose,
  onImport,
}: {
  kind: "team" | "schedule";
  project: Project;
  onClose: () => void;
  onImport: (rows: Array<CsvTeamRow | CsvScheduleRow>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readSequence=useRef(0);
  const [reading,setReading]=useState(false);
  const [sheetName,setSheetName]=useState("");
  const [rows, setRows] = useState<Array<CsvTeamRow | CsvScheduleRow>>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const isTeam = kind === "team";
  const labels = isTeam
    ? { eyebrow: "Equipe técnica", title: "Importar equipe por CSV", action: "Importar e preencher equipe" }
    : { eyebrow: "Cronograma do projeto", title: "Importar cronograma", action: "Importar e preencher cronograma" };

  const readFile = async (file?: File) => {
    if (!file) return;
    const sequence=++readSequence.current;
    setRows([]);setError("");setSheetName("");setFileName(file.name);setReading(false);
    if (file.size > 5 * 1024 * 1024) {setError("O arquivo ultrapassa o limite de 5 MB.");return;}
    if (!(isTeam?/\.csv$/i:/\.(csv|xlsx?)$/i).test(file.name)) {setError(isTeam?"Selecione um arquivo CSV.":"Selecione um arquivo CSV, XLS ou XLSX.");return;}
    setReading(true);
    try {
      let text:string,tab="";
      if(/\.xlsx?$/i.test(file.name)) {
        const {spreadsheetCsv}=await import("../lib/spreadsheets.mjs");
        const result=spreadsheetCsv(new Uint8Array(await file.arrayBuffer()),file.name);text=result.csv;tab=result.sheetName;
      } else text=await file.text();
      const parsed = isTeam?parseProjectCsv(text,"team"):parseProjectCsv(text,"schedule");
      if(sequence!==readSequence.current)return;
      setRows(parsed.rows);setSheetName(tab);setError(parsed.error);
    } catch(error) {
      if(sequence!==readSequence.current)return;
      setRows([]);setError((error as Error).message||"Não foi possível ler o arquivo.");
    } finally {if(sequence===readSequence.current)setReading(false);}
  };

  const useExample = () => {
    ++readSequence.current;setReading(false);setSheetName("");
    setRows(isTeam ? sampleTeamRows : sampleScheduleRows);
    setFileName(isTeam ? "modelo_equipe_tecnica.csv" : "modelo_cronograma.csv");
    setError("");
  };

  const downloadTemplate = () => {
    const content = isTeam
      ? [
          "nome;função;atividade",
          "Marina Alves;Coordenadora do projeto;Gestão técnica e acompanhamento das metas",
          "Rafael Moura;Pesquisador;Execução dos testes e validação dos resultados",
        ].join("\n")
      : [
          "rubrica;fonte;atividade;valor;mês;ano;meses",
          "Consultoria;Subvenção;Levantar os requisitos e consolidar as especificações técnicas;2.000,00;Janeiro;2026;1",
          "Pessoal / Pró-labore;Contrapartida;Coordenação mensal do projeto;1.500,00;Março;2026;6",
        ].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = isTeam ? "modelo_equipe_tecnica.csv" : "modelo_cronograma.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const issueCount = rows.reduce((sum, row) => sum + row.issues.length, 0);
  const teamRows = rows as CsvTeamRow[];
  const scheduleRows = rows as CsvScheduleRow[];
  const roleCount = isTeam ? new Set(teamRows.map((row) => normalizeCsvText(row.funcao))).size : 0;
  const scheduleTotal = !isTeam ? scheduleRows.reduce((sum, row) => sum + (Number.isFinite(row.valor) ? row.valor * (row.monthsCount || 1) : 0), 0) : 0;
  const columns = isTeam ? ["nome", "função", "atividade"] : ["rubrica", "fonte", "atividade (descrição completa)", "valor", "mês"];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal csv-modal operational-csv-modal" role="dialog" aria-modal="true" aria-labelledby={`${kind}-csv-title`}>
        <input ref={fileInputRef} className="csv-hidden-input" type="file" accept={isTeam?".csv,text/csv":".csv,.xls,.xlsx"} onChange={(event) => readFile(event.target.files?.[0])} />
        <div className="modal-header">
          <div><span>{labels.eyebrow}</span><h2 id={`${kind}-csv-title`}>{labels.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </div>

        {rows.length === 0 ? (
          <div className="modal-body csv-modal-body">
            <div className="csv-intro">
              <div className="csv-intro-icon">{isTeam ? <Users size={24} /> : <CalendarDays size={24} />}</div>
              <div><strong>{isTeam ? "Cadastre toda a equipe de uma só vez" : "Preencha o planejamento em poucos passos"}</strong><p>{isTeam ? "O sistema valida as colunas e mostra uma prévia antes de preencher a equipe do projeto." : "Excel: coloque os dados na primeira aba e converta fórmulas em valores. Use rubrica, fonte (Subvenção ou Contrapartida), atividade, valor e mês por extenso. Arquivos anteriores sem fonte assumem Subvenção, exceto a rubrica Contrapartida. As colunas opcionais ano e meses definem o início e a quantidade de parcelas do pró-labore. Valor é o valor de cada mês; sem meses, uma linha representa uma única previsão."}</p></div>
            </div>
            <button
              className={`csv-dropzone ${dragActive ? "dragging" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => { event.preventDefault(); setDragActive(false); readFile(event.dataTransfer.files?.[0]); }}
            >
              <span><UploadCloud size={25} /></span>
              <strong>{reading?"Lendo arquivo…":isTeam?"Arraste o CSV para cá ou clique para selecionar":"Arraste o CSV, XLS ou XLSX para cá"}</strong>
              <small>{isTeam?"Arquivo CSV de até 5 MB · separador vírgula ou ponto e vírgula":"Até 5 MB · Excel: primeira aba com cabeçalhos na primeira linha"}</small>
            </button>
            {error && <div className="csv-error"><AlertCircle size={17} /><span><strong>Arquivo não reconhecido</strong>{error}</span></div>}
            <div className="csv-schema operational-schema">
              <div className="csv-schema-title"><span>Colunas obrigatórias</span><b>A ordem pode variar</b></div>
              <div>{columns.map((column, index) => <span key={column}><b>{index + 1}</b> {column}</span>)}</div>
            </div>
            <button className="csv-example-button" onClick={useExample}>{isTeam ? <Users size={17} /> : <CalendarDays size={17} />}<span><strong>Ver com dados de exemplo</strong><small>Carrega uma prévia pronta para testar a importação</small></span><ArrowRight size={16} /></button>
          </div>
        ) : (
          <div className="modal-body csv-preview-body">
            <div className="csv-file-summary operational-file-summary">
              <div className="csv-file-name"><span><FileSpreadsheet size={21} /></span><div><strong>{fileName}</strong><small>Vinculado a {project.code}{sheetName?` · Aba: ${sheetName}`:""}</small></div></div>
              <div><span>{isTeam ? "Membros" : "Itens"}</span><strong>{rows.length}</strong></div>
              <div><span>{isTeam ? "Funções" : "Valor total"}</span><strong>{isTeam ? roleCount : money(scheduleTotal)}</strong></div>
            </div>
            {issueCount > 0 ? (
              <div className="csv-error"><AlertCircle size={17} /><span><strong>{issueCount} inconsistências encontradas</strong>Corrija as linhas sinalizadas no arquivo e importe novamente.</span></div>
            ) : (
              <div className="csv-valid"><CheckCircle2 size={17} /><span><strong>Estrutura validada</strong>Todos os campos obrigatórios foram reconhecidos.</span></div>
            )}
            <div className="csv-preview-wrap">
              {isTeam ? (
                <table className="csv-preview-table operational-preview-table">
                  <thead><tr><th>#</th><th>Nome</th><th>Função</th><th>Atividade</th><th /></tr></thead>
                  <tbody>{teamRows.map((row, index) => <tr key={`${row.nome}-${index}`} className={row.issues.length ? "has-issue" : ""}><td>{index + 1}</td><td><strong>{row.nome || "—"}</strong></td><td>{row.funcao || "—"}</td><td><span className="csv-description">{row.atividade || "—"}</span></td><td>{row.issues.length ? <span className="csv-row-issue" title={row.issues.join(", ")}><AlertCircle size={15} /></span> : <CheckCircle2 className="csv-row-valid" size={15} />}</td></tr>)}</tbody>
                </table>
              ) : (
                <table className="csv-preview-table operational-preview-table">
                  <thead><tr><th>#</th><th>Rubrica</th><th>Fonte</th><th>Atividade</th><th>Valor</th><th>Mês</th><th /></tr></thead>
                  <tbody>{scheduleRows.map((row, index) => <tr key={`${row.item}-${index}`} className={row.issues.length ? "has-issue" : ""}><td>{index + 1}</td><td><strong>{row.item || "—"}</strong></td><td>{row.source||sourceOf({rubric:row.item})}</td><td><span className="csv-description">{row.atividade || "—"}</span></td><td><strong>{Number.isFinite(row.valor) ? money(row.valor) : "—"}</strong></td><td>{row.mes || "—"}{row.year?` / ${row.year}`:""}{(row.monthsCount||1)>1&&<small>{row.monthsCount} parcelas mensais</small>}</td><td>{row.issues.length ? <span className="csv-row-issue" title={row.issues.join(", ")}><AlertCircle size={15} /></span> : <CheckCircle2 className="csv-row-valid" size={15} />}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <p className="csv-preview-note"><ShieldCheck size={15} /> Ao confirmar, os itens serão adicionados a este projeto. Os registros existentes serão preservados. Depois, cada linha poderá ser editada.</p>
          </div>
        )}

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancelar</button>
          <div>
            <button className="text-button csv-template-button" onClick={downloadTemplate}><Download size={15} /> Baixar modelo CSV</button>
            {rows.length > 0 && <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><RefreshCw size={15} /> Escolher outro</button>}
            {rows.length > 0 && <button className="primary-button" disabled={reading||issueCount > 0} onClick={() => onImport(rows)}><Check size={17} /> {labels.action}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamMemberCreateModal({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (member: Pick<TeamMember, "name" | "role" | "activity">) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [activity, setActivity] = useState("");

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal edit-management-modal" role="dialog" aria-modal="true" aria-labelledby="create-member-title" onSubmit={(event) => { event.preventDefault(); onSave({ name, role, activity }); }}>
        <div className="modal-header"><div><span>Equipe de {project.code}</span><h2 id="create-member-title">Adicionar membro</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <div className="modal-body form-grid management-edit-form">
          <label className="field full"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" required /></label>
          <label className="field full"><span>Função</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Ex.: Desenvolvedora frontend" required /></label>
          <label className="field full"><span>Atividade no projeto</span><textarea rows={4} value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="Descreva as responsabilidades e atividades deste membro." required /></label>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button"><Plus size={17} /> Adicionar à equipe</button></div>
      </form>
    </div>
  );
}

function DeleteTeamMemberModal({
  member,
  onClose,
  onConfirm,
}: {
  member: TeamMember;
  onClose: () => void;
  onConfirm: (member: TeamMember) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-member-title" aria-describedby="delete-member-description">
        <div className="modal-header"><div><span>Equipe técnica</span><h2 id="delete-member-title">Excluir membro</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <div className="modal-body confirm-delete-body"><span className="confirm-delete-icon"><Trash2 size={23} /></span><div><strong>Remover {member.name} da equipe?</strong><p id="delete-member-description">O membro e suas informações deixarão de aparecer neste projeto.</p></div></div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="danger-button" onClick={() => onConfirm(member)}><Trash2 size={16} /> Excluir membro</button></div>
      </div>
    </div>
  );
}

function TeamMemberEditModal({
  member,
  onClose,
  onSave,
}: {
  member: TeamMember;
  onClose: () => void;
  onSave: (member: TeamMember) => void;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [activity, setActivity] = useState(member.activity);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal edit-management-modal" role="dialog" aria-modal="true" aria-labelledby="edit-member-title" onSubmit={(event) => { event.preventDefault(); onSave({ ...member, name: name.trim(), role: role.trim(), activity: activity.trim() }); }}>
        <div className="modal-header"><div><span>Equipe técnica</span><h2 id="edit-member-title">Editar membro</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <div className="modal-body form-grid management-edit-form">
          <label className="field full"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label className="field full"><span>Função</span><input value={role} onChange={(event) => setRole(event.target.value)} required /></label>
          <label className="field full"><span>Atividade no projeto</span><textarea rows={4} value={activity} onChange={(event) => setActivity(event.target.value)} required /></label>
        </div>
        <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button"><Check size={17} /> Salvar alterações</button></div>
      </form>
    </div>
  );
}

function RubricPicker({value,onChange,rubrics,onAdd}:{value:string;onChange:(value:string)=>void;rubrics:RubricOption[];onAdd:()=>void}) {
  return <div className="rubric-picker"><select aria-label="Rubrica" required value={value} onChange={e=>onChange(e.target.value)}><option value="">Selecione uma rubrica</option>{rubrics.map(r=><option key={r.name} value={r.name}>{r.name}</option>)}</select><button type="button" className="text-button" onClick={onAdd}><Plus size={14}/> Adicionar nova rubrica</button></div>;
}
function RubricModal({onClose,onSave}:{onClose:()=>void;onSave:(r:RubricOption)=>void}) {
  const [name,setName]=useState(""),[type,setType]=useState("Custeio");
  return <div className="modal-backdrop" style={{zIndex:2500}}><form className="modal" role="dialog" aria-modal="true" aria-label="Adicionar rubrica" onSubmit={e=>{e.preventDefault();onSave({name:name.trim(),type});}}><div className="modal-header"><h2>Adicionar rubrica</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X/></button></div><div className="modal-body form-grid"><label className="field full"><span>Nome da rubrica</span><input autoFocus required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label className="field full"><span>Tipo</span><select value={type} onChange={e=>setType(e.target.value)}><option>Custeio</option><option>Capital</option></select></label><p className="full">A rubrica ficará disponível neste projeto. Cadastre uma previsão no cronograma para definir seu saldo.</p></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!name.trim()}>Cadastrar rubrica</button></div></form></div>;
}
function ScheduleItemEditModal({item,project,rubrics,onAddRubric,onClose,onSave,onDelete}:{onDelete?:()=>void;item?:ScheduleItem;project:Project;rubrics:RubricOption[];onAddRubric:()=>void;onClose:()=>void;onSave:(item:ScheduleItem)=>void}) {
  const start=project.startDate ? new Date(project.startDate+"T12:00:00") : new Date();
  const [rubric,setRubric]=useState(item?.rubric || item?.item || "");
  const [source,setSource]=useState<FundingSource>(item?sourceOf(item):"Subvenção");
  const [activity,setActivity]=useState(item?.activity || ""),[value,setValue]=useState(item?String(item.value):"");
  const [month,setMonth]=useState(item?.month || projectMonths[start.getMonth()]),[year,setYear]=useState(item?.year || start.getFullYear());
  const [count,setCount]=useState(1),[status,setStatus]=useState<ScheduleStatus>(item?.status || "Não iniciada");
  const monthly=rubric==="Pessoal / Pró-labore"&&!item;
  return <div className="modal-backdrop"><form className="modal edit-management-modal" role="dialog" aria-modal="true" aria-label={item?"Editar previsão":"Adicionar previsão"} onSubmit={e=>{e.preventDefault();onSave({...item,id:item?.id||"",version:item?.version||1,projectId:project.id,item:rubric,rubric,source,activity:activity.trim(),value:Number(value),month,year,status,monthsCount:monthly?count:1});}}>
    <div className="modal-header"><div><span>Cronograma do projeto</span><h2>{item?"Editar previsão":"Adicionar previsão"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19}/></button></div>
    <div className="modal-body form-grid management-edit-form">
      <div className="field full"><span>Rubrica</span><RubricPicker value={rubric} onChange={setRubric} rubrics={rubrics} onAdd={onAddRubric}/></div>
      <SourceField value={source} onChange={setSource}/>{item?.sourceInferred&&<p className="full monthly-note">Confira a fonte deste registro anterior antes de salvar.</p>}
      <label className="field full"><span>Descrição completa da atividade</span><textarea required rows={3} value={activity} onChange={e=>setActivity(e.target.value)}/></label>
      <label className="field"><span>{monthly?"Mês inicial":"Mês"}</span><select value={month} onChange={e=>setMonth(e.target.value)}>{projectMonths.map(m=><option key={m}>{m}</option>)}</select></label>
      <label className="field"><span>Ano</span><input required type="number" min="2000" max="2200" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
      <label className="field"><span>{monthly?"Valor mensal (R$)":"Valor previsto (R$)"}</span><input required type="number" min="0" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/></label>
      {monthly?<label className="field"><span>Quantidade de meses</span><input required type="number" min="1" max="60" step="1" value={count} onChange={e=>setCount(Number(e.target.value))}/></label>:<label className="field"><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value as ScheduleStatus)}>{scheduleStatuses.map(s=><option key={s}>{s}</option>)}</select></label>}
      {monthly&&<p className="monthly-note full"><strong>{count} parcelas de {money(Number(value)||0)} · Total {money(Math.round((Number(value)||0)*100)*count/100)}</strong><br/>Será criada uma previsão para cada mês, inclusive na mudança de ano. Registre o pagamento em Lançamentos quando ele ocorrer.</p>}
      {item?.recurrenceId&&<p className="monthly-note full">Parcela {item.installment}/{item.installments}. A edição altera somente esta previsão mensal.</p>}
    </div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><>{item&&onDelete&&<button type="button" className="delete-row-button" onClick={onDelete}><Trash2 size={16}/> Excluir previsão</button>}</><button className="primary-button" disabled={!rubric}>Salvar {monthly?"previsões":"previsão"}</button></div>
  </form></div>;
}

function CsvImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (rows: CsvBudgetRow[], fileName: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvBudgetRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setRows([]);
      setError("O arquivo ultrapassa o limite de 5 MB.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setRows([]);
      setError("Selecione um arquivo no formato CSV.");
      return;
    }
    try {
      const parsed = parseBudgetCsv(await file.text());
      setRows(parsed.rows);
      setFileName(file.name);
      setError(parsed.error);
    } catch {
      setRows([]);
      setError("Não foi possível ler o arquivo. Verifique a codificação e tente novamente.");
    }
  };

  const useExample = () => {
    setRows(sampleCsvRows);
    setFileName("modelo_rubricas.csv");
    setError("");
  };

  const downloadTemplate = () => {
    const content = [
      "fonte;elemento;descrição;unitário;qtd;valor total",
      "Subvenção;Material de Consumo;Resina biodegradável;85,00;120;10.200,00",
      "Contrapartida;Consultoria;Modelagem de processo;8.500,00;2;17.000,00",
    ].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "modelo_importacao_rubricas.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.valorTotal) ? row.valorTotal : 0), 0);
  const elements = new Set(rows.map((row) => row.elemento).filter(Boolean)).size;
  const issueCount = rows.reduce((sum, row) => sum + row.issues.length, 0);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal csv-modal" role="dialog" aria-modal="true" aria-labelledby="csv-modal-title">
        <input
          ref={fileInputRef}
          className="csv-hidden-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => readFile(event.target.files?.[0])}
        />
        <div className="modal-header">
          <div><span>Cadastro de rubricas</span><h2 id="csv-modal-title">Importar arquivo CSV</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </div>

        {rows.length === 0 ? (
          <div className="modal-body csv-modal-body">
            <div className="csv-intro">
              <div className="csv-intro-icon"><FileSpreadsheet size={24} /></div>
              <div><strong>Preencha várias rubricas de uma só vez</strong><p>O sistema confere a estrutura, reconhece os elementos e calcula o resumo antes da importação.</p></div>
            </div>
            <button
              className={"csv-dropzone " + (dragActive ? "dragging" : "")}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                readFile(event.dataTransfer.files?.[0]);
              }}
            >
              <span><UploadCloud size={25} /></span>
              <strong>Arraste o CSV para cá ou clique para selecionar</strong>
              <small>Arquivo CSV de até 5 MB · separador vírgula ou ponto e vírgula</small>
            </button>
            {error && <div className="csv-error"><AlertCircle size={17} /><span><strong>Arquivo não reconhecido</strong>{error}</span></div>}
            <div className="csv-schema">
              <div className="csv-schema-title"><span>Colunas obrigatórias</span><b>A ordem pode variar</b></div>
              <div>
                <span><b>1</b> fonte</span>
                <span><b>2</b> elemento</span>
                <span><b>3</b> descrição</span>
                <span><b>4</b> unitário</span>
                <span><b>5</b> qtd</span>
                <span><b>6</b> valor total</span>
              </div>
            </div>
            <button className="csv-example-button" onClick={useExample}><FileSpreadsheet size={17} /><span><strong>Ver com dados de exemplo</strong><small>Carrega 6 itens para demonstrar a importação</small></span><ArrowRight size={16} /></button>
          </div>
        ) : (
          <div className="modal-body csv-preview-body">
            <div className="csv-file-summary">
              <div className="csv-file-name"><span><FileSpreadsheet size={21} /></span><div><strong>{fileName}</strong><small>Arquivo lido e estruturado automaticamente</small></div></div>
              <div><span>Itens</span><strong>{rows.length}</strong></div>
              <div><span>Rubricas</span><strong>{elements}</strong></div>
              <div><span>Valor total</span><strong>{money(total)}</strong></div>
            </div>
            {issueCount > 0 ? (
              <div className="csv-error"><AlertCircle size={17} /><span><strong>{issueCount} inconsistências encontradas</strong>Corrija as linhas sinalizadas no arquivo e importe novamente.</span></div>
            ) : (
              <div className="csv-valid"><CheckCircle2 size={17} /><span><strong>Estrutura validada</strong>Todas as colunas e valores obrigatórios foram reconhecidos.</span></div>
            )}
            <div className="csv-preview-wrap">
              <table className="csv-preview-table">
                <thead><tr><th>#</th><th>Fonte</th><th>Elemento</th><th>Descrição</th><th>Unitário</th><th>Qtd</th><th>Valor total</th><th /></tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(index) + row.descricao} className={row.issues.length ? "has-issue" : ""}>
                      <td>{index + 1}</td>
                      <td><span className={"source-pill " + (normalizeCsvText(row.fonte).includes("contrapartida") ? "counterpart" : "")}>{row.fonte}</span></td>
                      <td><strong>{row.elemento || "—"}</strong></td>
                      <td><span className="csv-description">{row.descricao || "—"}</span></td>
                      <td>{Number.isFinite(row.unitario) ? money(row.unitario) : "—"}</td>
                      <td>{Number.isFinite(row.qtd) ? row.qtd : "—"}</td>
                      <td><strong>{Number.isFinite(row.valorTotal) ? money(row.valorTotal) : "—"}</strong></td>
                      <td>{row.issues.length ? <span className="csv-row-issue" title={row.issues.join(", ")}><AlertCircle size={15} /></span> : <CheckCircle2 className="csv-row-valid" size={15} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="csv-preview-note"><ShieldCheck size={15} /> Esta importação substituirá todo o orçamento deste projeto. Valores abaixo do que já foi executado ou remanejado serão recusados.</p>
          </div>
        )}

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancelar</button>
          <div>
            <button className="text-button csv-template-button" onClick={downloadTemplate}><Download size={15} /> Baixar modelo CSV</button>
            {rows.length > 0 && <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><RefreshCw size={15} /> Escolher outro</button>}
            {rows.length > 0 && <button className="primary-button" disabled={issueCount > 0} onClick={() => onImport(rows, fileName)}><Check size={17} /> Importar e preencher</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourceEntryModal({project,initial,onClose,onSave}:{project:Project;initial?:Resource;onClose:()=>void;onSave:(entry:ResourceEntryDraft)=>void}) {
 const installmentCount=project.installments||1;
 const [kind,setKind]=useState<ResourceEntryKind>(initial?.kind||"Parcela da subvenção");
 const [value,setValue]=useState(String(initial?.value??Math.round(project.approved/installmentCount*100)/100));
 const [date,setDate]=useState(initial?.date||new Date().toLocaleDateString("en-CA"));
 const [installment,setInstallment]=useState(String(initial?.installment||Array.from({length:installmentCount},(_,i)=>i+1).find(n=>!project.receivedInstallments?.includes(n))||1));
 const [reference,setReference]=useState(initial?.reference||""),[notes,setNotes]=useState(initial?.notes||"");
 const [proof,setProof]=useState<File>();
 const restore=initial?.kind===kind?initial.value:0;
 const available=kind==="Parcela da subvenção"?Math.max(0,project.approved-project.released+restore):kind==="Contrapartida financeira"?Math.max(0,project.counterpart-project.counterpartRealized+restore):Infinity;
 const valid=Boolean(date&&Number(value)>0&&Number(value)<=available&&Number.isInteger(Number(installment)));
 return <div className="modal-backdrop"><form className="modal large resource-entry-modal" role="dialog" aria-modal="true" aria-label={initial?"Editar recurso":"Registrar recurso"} onSubmit={e=>{e.preventDefault();if(valid)onSave({kind,value:Number(value),date,installment:kind==="Parcela da subvenção"?Number(installment):undefined,reference,notes,proof});}}><div className="modal-header"><h2>{initial?"Editar recurso financeiro":"Registrar recurso financeiro"}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19}/></button></div><div className="modal-body form-grid">
 <label className="field full"><span>Tipo de entrada</span><select value={kind} onChange={e=>setKind(e.target.value as ResourceEntryKind)}>{["Parcela da subvenção","Contrapartida financeira","Rendimento de aplicação"].map(k=><option key={k}>{k}</option>)}</select><small>Fonte: {resourceSource({kind})}. Rendimentos são registrados na conta de subvenção.</small></label>
 {kind==="Parcela da subvenção"&&<label className="field"><span>Parcela recebida</span><select value={installment} onChange={e=>setInstallment(e.target.value)}>{Array.from({length:installmentCount},(_,i)=>i+1).map(n=><option key={n} value={n} disabled={project.receivedInstallments?.includes(n)&&!(initial?.kind==="Parcela da subvenção"&&initial.installment===n)}>{n}ª parcela</option>)}</select></label>}
 <label className="field"><span>Data do crédito</span><input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label className="field"><span>Valor recebido (R$)</span><input required type="number" min="0.01" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/><small>{Number.isFinite(available)?`Disponível para este registro: ${money(available)}`:"Informe o rendimento do extrato."}</small></label>
 <label className="field full"><span>Referência bancária</span><input value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <label className="upload-inline full"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setProof(e.target.files?.[0])}/><Paperclip size={19}/><span><strong>{initial?"Substituir comprovante (opcional)":"Comprovante (opcional)"}</strong><small>{proof?.name||initial?.documents.map(d=>d.name).join(", ")||"PDF, JPG ou PNG"}</small></span></label>
 <label className="field full"><span>Observações</span><textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 {Number(value)>available&&<p className="document-pending-alert full">O valor ultrapassa o total previsto para esta entrada.</p>}
 </div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid}>{initial?"Salvar alterações":"Registrar recurso"}</button></div></form></div>;
}

function ProjectLinkModal({
  project, initial,
  onClose,
  onSave,
}: {
  project: Project; initial?:ProjectLink;
  onClose: () => void;
  onSave: (draft: { name: string; url: string }) => void;
}) {
  const [name, setName] = useState(initial?.name||"");
  const [url, setUrl] = useState(initial?.url||"");
  const normalizedPreview = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  const valid = Boolean(name.trim() && url.trim() && normalizedPreview.includes("."));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal project-link-modal" role="dialog" aria-modal="true" aria-labelledby="project-link-modal-title">
        <div className="modal-header"><div><span>Referência do projeto</span><h2 id="project-link-modal-title">{initial?"Editar link importante":"Adicionar link importante"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <div className="modal-body">
          <div className="project-link-project-note"><span><Link2 size={18} /></span><div><small>Projeto selecionado</small><strong>{project.name}</strong></div></div>
          <div className="form-grid project-link-form">
            <label className="field full"><span>Nome do link *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Pasta de documentos no Drive" /></label>
            <label className="field full"><span>Endereço (URL) *</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://exemplo.com.br/pasta" /><small>Você pode colar o endereço com ou sem https://</small></label>
          </div>
          <div className="project-link-privacy"><ShieldCheck size={16} /><span>Este link ficará organizado somente no projeto selecionado.</span></div>
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={() => onSave({ name, url })}><Check size={17} /> {initial?"Salvar alterações":"Adicionar link"}</button></div>
      </div>
    </div>
  );
}

type ExpenseDraft = Pick<Expense,"source"|"supplier"|"description"|"rubric"|"value"|"date"|"taxId"|"notes">;
function NewEntryModal({
  onClose,
  onSave,
  initial, schedule, onOpenSchedule,
  showToast,
}: {
  onClose: () => void;
  onSave: (entry: ExpenseDraft, draft: boolean, files: Record<string,File>) => void;
  initial?:Expense; schedule:ScheduleItem[]; onOpenSchedule:()=>void;
  showToast: (message: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [rubric, setRubric] = useState(initial?.rubric || "");
  const [source,setSource]=useState<FundingSource>(initial?sourceOf(initial):schedule.some(s=>sourceOf(s)==="Subvenção")?"Subvenção":schedule.length?sourceOf(schedule[0]):"Subvenção");
  const [supplier, setSupplier] = useState(initial?.supplier || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [value, setValue] = useState(initial?String(initial.value):"");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [date,setDate]=useState(initial?.date || new Date().toLocaleDateString("en-CA")),[taxId,setTaxId]=useState(initial?.taxId||""),[notes,setNotes]=useState(initial?.notes||"");
  const requiredKeys = ["quote1", "quote2", "quote3", "invoice", "payment"];
  const scheduledRubrics=Array.from(new Set(schedule.filter(item=>sourceOf(item)===source).map(item=>item.rubric||item.item)));
  const legacyRubric=initial && source===sourceOf(initial) && !scheduledRubrics.includes(initial.rubric) ? initial.rubric : "";
  const allowedRubric=scheduledRubrics.includes(rubric)||Boolean(legacyRubric && rubric===legacyRubric);
  const firstStepComplete = Boolean(supplier.trim() && description.trim() && allowedRubric && date && Number(value) > 0);

  const setFile = (key: string, file?: File) => {
    if (file) setFiles((current) => ({ ...current, [key]: file }));
  };
  const save = (draft: boolean) => {
    if (!firstStepComplete) {
      showToast("Preencha os dados básicos antes de salvar.");
      return;
    }
    onSave({ supplier, description, rubric, source, value: Number(value),date,taxId,notes }, draft, Object.fromEntries(Object.entries(files).filter(([key])=>requiredKeys.includes(key))));
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal large" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title">
        <div className="modal-header"><div><span>{initial?"Editar lançamento":"Novo lançamento"}</span><h2 id="entry-modal-title">{step === 1 ? "Dados da despesa" : "Documentos comprobatórios"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>
        <div className="stepper">
          <div className="active"><span>{step > 1 ? <Check size={14} /> : 1}</span><div><strong>Dados da despesa</strong><small>Identificação e valor</small></div></div>
          <i /><div className={step === 2 ? "active" : ""}><span>2</span><div><strong>Documentos</strong><small>Todos opcionais</small></div></div>
        </div>
        {step === 1 ? (
          <div className="modal-body form-grid">
            <SourceField value={source} onChange={next=>{setSource(next);setRubric("");}}/>
            <label className="field full"><span>Rubrica *</span><select required value={rubric} onChange={event=>setRubric(event.target.value)}><option value="">Selecione uma rubrica do Cronograma</option>{scheduledRubrics.map(name=><option key={name} value={name}>{name}</option>)}{legacyRubric&&<option value={legacyRubric}>{legacyRubric} — lançamento existente</option>}</select><small>Rubricas previstas no Cronograma para {source}. O saldo considera esta fonte de recursos.</small></label>
            {!scheduledRubrics.length&&<div className="document-pending-alert full"><AlertCircle size={18}/><div><strong>Nenhuma rubrica prevista para {source}.</strong><p>Cadastre uma previsão no Cronograma antes de criar um lançamento com esta fonte.</p><button type="button" className="secondary-button small" onClick={onOpenSchedule}>Abrir Cronograma</button></div></div>}
            {legacyRubric&&<p className="panel-note full">A rubrica deste lançamento antigo foi preservada. Para trocar a rubrica ou registrar novas despesas, cadastre a previsão no Cronograma.</p>}
            {initial?.status==="Conciliado"&&<p className="document-pending-alert full">Ao editar, a despesa voltará para Em análise e precisará de nova conferência bancária.</p>}
            <label className="field"><span>Fornecedor / favorecido *</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Nome ou razão social" /></label>
            <label className="field"><span>CPF / CNPJ</span><input value={taxId} onChange={e=>setTaxId(e.target.value)} placeholder="00.000.000/0000-00" /></label>
            <label className="field full"><span>Descrição da despesa *</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Informe o objeto da contratação ou aquisição" /></label>
            <label className="field"><span>Data do documento *</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
            <label className="field money-field"><span>Valor *</span><div><b>R$</b><input value={value} onChange={(event) => setValue(event.target.value)} type="number" min="0" step="0.01" placeholder="0,00" /></div></label>
            <label className="field full"><span>Observações</span><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Inclua informações que facilitem a análise deste lançamento." rows={3} /></label>
          </div>
        ) : (
          <div className="modal-body">
            <div className="document-pending-alert"><AlertCircle size={18}/><span>Todos os documentos são opcionais. Você pode salvar sem anexos e acompanhar o checklist por rubrica em Lançamentos.</span></div>
            {(
              <div className="upload-section">
                <div className="upload-section-title"><span>Pesquisa de preços</span><b>3 orçamentos · opcionais</b></div>
                <div className="upload-grid">{["quote1", "quote2", "quote3"].map((key, index) => <UploadBox key={key} label={"Orçamento " + String(index + 1)} file={files[key]?.name} onFile={(file) => setFile(key, file)} />)}</div>
              </div>
            )}
            <div className="upload-section">
              <div className="upload-section-title"><span>Comprovação da despesa</span><b>Envio opcional</b></div>
              <div className="upload-grid two"><UploadBox label="Nota fiscal / recibo" file={files.invoice?.name} onFile={(file) => setFile("invoice", file)} /><UploadBox label="Comprovante de pagamento" file={files.payment?.name} onFile={(file) => setFile("payment", file)} /></div>
            </div>
            <div className="document-tip"><ShieldCheck size={18} /><span>Formatos aceitos: PDF, JPG ou PNG · tamanho máximo de 10 MB por arquivo.</span></div>
          </div>
        )}
        <div className="modal-footer">
          <button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep(1)}>{step === 1 ? "Cancelar" : "Voltar"}</button>
          <div>
            {!initial&&<button className="text-button draft-button" disabled={!firstStepComplete} onClick={() => save(true)}>Salvar rascunho</button>}
            {initial ? <button className="primary-button" disabled={!firstStepComplete} onClick={()=>save(Boolean(initial.draft))}>Salvar alterações</button> : step === 1 ? <button className="primary-button" disabled={!firstStepComplete} onClick={() => setStep(2)}>Continuar <ArrowRight size={17} /></button> : <button className="primary-button" disabled={!firstStepComplete} onClick={() => save(false)}><Check size={17} /> Registrar despesa</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadBox({ label, file, onFile, accept=".pdf,.jpg,.jpeg,.png" }: { label: string; file?: string; onFile: (file?: File) => void; accept?:string }) {
  return (
    <label className={"upload-box " + (file ? "has-file" : "")}>
      <input type="file" accept={accept} onChange={(event) => onFile(event.target.files?.[0])} />
      <span className="upload-box-icon">{file ? <FileCheck2 size={21} /> : <UploadCloud size={21} />}</span>
      <strong>{label}</strong><small>{file || "Clique para selecionar o arquivo"}</small>
      {file && <b><Check size={13} /> anexado</b>}
    </label>
  );
}

function SourceField({value,onChange}:{value:FundingSource;onChange:(v:FundingSource)=>void}) {
 return <label className="field full"><span>Fonte do recurso</span><select required value={value} onChange={e=>onChange(e.target.value as FundingSource)}><option>Subvenção</option><option>Contrapartida</option></select></label>;
}
function DeleteRecordModal({title,description,onClose,onConfirm}:{title:string;description:string;onClose:()=>void;onConfirm:()=>void}) {
 return <div className="modal-backdrop" style={{zIndex:2500}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2></div><div className="modal-body"><p>{description}</p></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="delete-row-button" onClick={onConfirm}><Trash2 size={16}/> Confirmar exclusão</button></div></section></div>;
}
function RemapModal({items,project,rubrics,onAddRubric,onClose,onSave,initial}:{items:ScheduleItem[];project:Project;rubrics:RubricOption[];onAddRubric:()=>void;onClose:()=>void;onSave:(draft:RemapDraft)=>void;initial?:Remap}) {
  const [sourceId,setSourceId]=useState(initial?.sourceScheduleId||""),[to,setTo]=useState(initial?.to||""),[activity,setActivity]=useState(initial?.activity||""),[value,setValue]=useState(initial?String(initial.value):""),[reason,setReason]=useState(initial?.reason||"");
  const [month,setMonth]=useState(initial?.month||projectMonths[0]),[year,setYear]=useState(initial?.year||Number(project.startDate?.slice(0,4))||new Date().getFullYear());
  const options=items.filter(s=>s.id!==initial?.destinationScheduleId).map(s=>({...s,value:s.value+(initial?.status==="Aprovado"&&s.id===initial.sourceScheduleId?initial.value:0)}));
  const source=options.find(s=>s.id===sourceId);
  return <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label={initial?"Editar remanejamento":"Novo remanejamento"} onSubmit={e=>{e.preventDefault();onSave({sourceScheduleId:sourceId,to,activity,month,year,value:Number(value),reason});}}><div className="modal-header"><h2>{initial?"Editar remanejamento":"Novo remanejamento"}</h2><button type="button" className="secondary-button" onClick={onClose}>Fechar</button></div><div className="modal-body form-grid">
    <label className="field full"><span>Item de origem no cronograma</span><select required value={sourceId} onChange={e=>{setSourceId(e.target.value);const s=items.find(i=>i.id===e.target.value);if(s){setMonth(s.month);setYear(s.year||year);}}}><option value="">Selecione o item</option>{options.filter(s=>s.value>0).map(s=><option key={s.id} value={s.id}>{sourceOf(s)} · {s.rubric||s.item} · {s.activity} · {s.month}/{s.year||"—"} · {money(s.value)}</option>)}</select></label>
    {source&&<p className="full monthly-note">Fonte: <strong>{sourceOf(source)}</strong>. O destino usa a mesma fonte do item de origem.</p>}
    {!items.length&&<p className="document-pending-alert full">Cadastre primeiro uma previsão no cronograma.</p>}
    <div className="field full"><span>Rubrica do novo item</span><RubricPicker value={to} onChange={setTo} rubrics={rubrics} onAdd={onAddRubric}/></div>
    <label className="field full"><span>Descrição da nova atividade</span><textarea required value={activity} onChange={e=>setActivity(e.target.value)}/></label>
    <label className="field"><span>Mês previsto</span><select value={month} onChange={e=>setMonth(e.target.value)}>{projectMonths.map(m=><option key={m}>{m}</option>)}</select></label>
    <label className="field"><span>Ano</span><input required type="number" min="2000" max="2200" value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
    <label className="field full"><span>Valor a transferir (R$)</span><input type="number" min="0.01" max={source?.value} step="0.01" required value={value} onChange={e=>setValue(e.target.value)}/><small>Limitado ao valor do item e ao saldo da rubrica de origem.</small></label>
    <label className="field full"><span>Justificativa</span><textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <p className="full">Ao salvar, o valor será transferido imediatamente. Na edição, a transferência anterior será recalculada.</p>
    </div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!sourceId||!to}>Salvar e aplicar</button></div></form></div>;
}
function DeleteExpenseModal({expense,onClose,onConfirm}:{expense:Expense;onClose:()=>void;onConfirm:()=>void}) {
  return <div className="modal-backdrop" style={{zIndex:2500}}><section className="modal" role="dialog" aria-modal="true" aria-label="Excluir lançamento"><div className="modal-header"><h2>Excluir lançamento?</h2></div><div className="modal-body"><p><strong>{expense.supplier}</strong> · {money(expense.value)}</p><p>{expense.description}</p><p>O lançamento e seus anexos serão excluídos. Os saldos serão recalculados e a exclusão ficará registrada no histórico de auditoria.</p></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="delete-row-button" onClick={onConfirm}><Trash2 size={16}/> Confirmar exclusão</button></div></section></div>;
}

function ExpenseModal({expense,onClose,onUpload,onUpdate,admin,onEdit,onDelete}:{onEdit:(e:Expense)=>void;onDelete:(e:Expense)=>void;expense:Expense;onClose:()=>void;onUpload:(e:Expense,files:Record<string,File>)=>void;onUpdate:(e:Expense,action:string,reference?:string)=>void;admin:boolean}) {
 const [files,setFiles]=useState<Record<string,File>>({}),[reference,setReference]=useState("");
 const keys=["invoice","payment","quote1","quote2","quote3"];
 const labels:Record<string,string>={invoice:"Nota fiscal / recibo",payment:"Comprovante de pagamento",quote1:"Orçamento 1",quote2:"Orçamento 2",quote3:"Orçamento 3"};
 const pending=Object.fromEntries(Object.entries(files).filter(([kind])=>!expense.documents?.some(d=>d.kind===kind)));
 return <div className="modal-backdrop"><section className="modal expense-modal" role="dialog" aria-modal="true" aria-label="Detalhes da despesa"><div className="modal-header"><div><span>{expense.date}</span><h2>{expense.supplier}</h2></div><button className="secondary-button" onClick={onClose}>Fechar</button></div><div className="expense-detail-hero"><strong>{money(expense.value)}</strong><StatusBadge status={expense.status}/></div><div className="modal-body"><p>{expense.description}</p><p>{expense.rubric} · {sourceOf(expense)}</p>{expense.notes&&<p>{expense.notes}</p>}<div className="expense-actions"><button className="secondary-button" onClick={()=>onEdit(expense)}><Pencil size={16}/> Editar lançamento</button><button className="delete-row-button" onClick={()=>onDelete(expense)}><Trash2 size={16}/> Excluir lançamento</button></div>{expense.docs<expense.requiredDocs&&<div className="document-pending-alert"><AlertCircle size={18}/><strong>Documentos pendentes: faltam {expense.requiredDocs-expense.docs} anexos.</strong></div>}<h3>Documentos do lançamento</h3><p className="panel-note">Todos os anexos são opcionais. O checklist ajuda a acompanhar a documentação.</p><div className="file-checklist">{keys.map(kind=>{const doc=expense.documents?.find(d=>d.kind===kind);return doc?<a className="complete file-document-download" key={kind} href={"/api/documents/"+doc.id}><FileCheck2 size={18}/><span><strong>{labels[kind]}</strong><small>{doc.name}</small></span><Download size={18}/></a>:<UploadBox key={kind} label={labels[kind]} file={files[kind]?.name} onFile={file=>{if(file)setFiles({...files,[kind]:file});}}/>;})}</div>{Object.keys(pending).length>0&&<button className="secondary-button" onClick={()=>onUpload(expense,pending)}>Salvar anexos selecionados</button>}{!expense.draft&&sourceOf(expense)==="Subvenção"&&admin&&expense.status!=="Conciliado"&&<label className="field"><span>Referência do extrato conferido</span><input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Identificador bancário da transação"/></label>}</div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>Fechar</button>{expense.draft?<button className="primary-button" onClick={()=>onUpdate(expense,"submit")}>Registrar despesa</button>:sourceOf(expense)==="Subvenção"&&admin&&expense.status!=="Conciliado"?<button className="primary-button" disabled={!reference.trim()} onClick={()=>onUpdate(expense,"reconcile",reference)}>Confirmar conferência do extrato</button>:null}</div></section></div>;
}
