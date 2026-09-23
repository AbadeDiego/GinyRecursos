// RFC 4180-style fields, with comma or Brazilian semicolon delimiters.
export function csvRecords(source) {
  const input=source.replace(/^\uFEFF/,'');
  const delimiter=input.split(/\r?\n/,1)[0].includes(';')?';':',';
  const records=[]; let row=[],cell='',quoted=false,closed=false;
  const field=()=>{row.push(cell.trim());cell='';closed=false;};
  const record=()=>{field();if(row.some(Boolean))records.push(row);row=[];};
  for(let i=0;i<input.length;i++) {
    const ch=input[i];
    if(quoted) {if(ch==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=false;closed=true;}else cell+=ch;continue;}
    if(ch==='"'){if(cell.trim()||closed)throw new Error('Aspas inválidas no CSV.');quoted=true;}
    else if(ch===delimiter)field();
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&input[i+1]==='\n')i++;record();}
    else {if(closed&&ch.trim())throw new Error('Conteúdo após fechamento de aspas.');cell+=ch;}
  }
  if(quoted)throw new Error('Aspas não fechadas no CSV.');
  if(cell||row.length)record();
  if(records.length>2001)throw new Error('O limite é de 2.000 linhas por importação.');
  if(records.length&&records.some(row=>row.length!==records[0].length))throw new Error('Número de colunas inconsistente no CSV.');
  return records;
}
