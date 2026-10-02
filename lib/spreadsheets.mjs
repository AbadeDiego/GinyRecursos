import { read, utils } from 'xlsx';

export const spreadsheetMime = name => /\.xlsx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.xls$/i.test(name) ? 'application/vnd.ms-excel' : null;

// Check the container before parsing: SheetJS also accepts text and HTML, which
// must not be accepted merely because a file was renamed to .xls/.xlsx.
export function readExcel(bytes, name, metadataOnly=false) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const mime=spreadsheetMime(name);
  const signature=mime==='application/vnd.ms-excel'
    ? [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]
    : [0x50,0x4b,0x03,0x04];
  if(!mime||!signature.every((value,index)=>data[index]===value))throw new Error('Arquivo Excel inválido. Envie uma planilha XLS ou XLSX original.');
  try {
    const book=read(data,{type:'array',bookSheets:metadataOnly,bookProps:metadataOnly,sheetRows:metadataOnly?0:2002,cellFormula:true,cellHTML:false,cellStyles:false});
    if(!book.SheetNames?.length)throw new Error('no worksheets');
    return book;
  } catch {throw new Error('Não foi possível abrir a planilha. Confira se o arquivo está íntegro e sem senha.');}
}

export function spreadsheetCsv(bytes,name) {
  const book=readExcel(bytes,name),sheetName=book.SheetNames[0],sheet=book.Sheets[sheetName];
  if(!sheet?.['!ref'])throw new Error('A primeira aba da planilha está vazia.');
  const range=utils.decode_range(sheet['!fullref']||sheet['!ref']);
  if(range.e.r-range.s.r>2000)throw new Error('O limite é de 2.000 linhas de dados na primeira aba.');
  if(range.e.c-range.s.c>99)throw new Error('A planilha tem mais de 100 colunas. Remova as colunas que não serão importadas.');
  for(const [address,cell] of Object.entries(sheet)) {
    if(address.startsWith('!'))continue;
    if(cell.f)throw new Error('A planilha contém fórmulas. Copie e cole os resultados como valores antes de importar.');
    if(cell.t==='e')throw new Error('A planilha contém células com erro. Corrija-as antes de importar.');
  }
  // Read the underlying number, not its formatted currency display. This keeps
  // numeric cells such as 1500.25 correct regardless of the Excel locale.
  const records=utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false});
  const csv=records.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(';')).join('\n');
  return {csv,sheetName};
}
