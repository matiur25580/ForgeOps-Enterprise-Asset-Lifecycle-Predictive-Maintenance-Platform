export function csvCell(value:unknown):string{
 let s=value instanceof Date?value.toISOString():value===null||value===undefined?'':String(value);
 if(/^[\s]*[=+@\-]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
export function toCsv(headers:string[],rows:unknown[][]):string{
 return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
