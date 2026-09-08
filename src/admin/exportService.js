import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { pool } from '../config/db.js';
import { audit,fail,idSchema } from './common.js';
import { report,payments,paymentDetail } from './reportService.js';

export function csvCell(value) {
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function pdfBuffer(write) {
  return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:48});const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);try{write(doc);doc.end();}catch(e){reject(e);}});
}
function heading(doc,title,subtitle) {doc.fillColor('#123044').fontSize(21).text('EYAZS IMPERIUM LDA').moveDown(.6).fontSize(15).text(title).fontSize(10).fillColor('#475569').text(subtitle).moveDown(1.5);}
export async function receiptPdf(req,res) {
  const id=idSchema.parse(req.params.id),detail=await paymentDetail(id,true),p=detail.payment;
  const buffer=await pdfBuffer(doc=>{
    heading(doc,'Comprovativo eletrónico '+detail.receiptNumber,'Pagamento confirmado • Hotspot Eyazs');
    for(const [label,value]of Object.entries({'Referência interna':p.reference,'Referência M-Pesa':p.provider_reference||'Não registada','Data de confirmação':String(p.confirmed_at||'Não registada'),'Telefone':p.phone,'Pacote':p.package_name,'Valor (MZN)':Number(p.amount).toFixed(2),'Método':p.method,'Voucher':p.voucher,'Estado':p.status}))doc.fontSize(11).fillColor('#123044').text(label+': '+value).moveDown(.65);
    doc.moveDown().fontSize(9).fillColor('#64748b').text(detail.coverage);
  });
  await audit(req,'DOWNLOAD_RECEIPT','payments',id);
  res.type('application/pdf').attachment(detail.receiptNumber+'.pdf').send(buffer);
}
export async function exportReport(req,res) {
  const format=req.params.format;if(!['csv','xlsx','pdf'].includes(format))fail(422,'Formato inválido.');
  const data=await report(req.query);
  const first=await payments({...req.query,from:data.range.from,to:data.range.to,page:1,limit:100});
  if(first.pagination.total>10000)fail(422,'Reduza o período para exportar até 10 000 pagamentos.');
  const rows=[...first.data];
  for(let page=2;page<=first.pagination.pages;page++)rows.push(...(await payments({...req.query,from:data.range.from,to:data.range.to,page,limit:100})).data);
  const columns=['Referência','Telefone','Pacote','Valor MZN','Método','Estado','Voucher'];
  const values=rows.map(p=>[p.reference,p.phone,p.package_name,p.amount,p.method,p.status,p.voucher]);
  let buffer,type;
  if(format==='csv'){buffer=Buffer.from('\uFEFF'+[columns,...values].map(r=>r.map(csvCell).join(',')).join('\r\n'));type='text/csv; charset=utf-8';}
  if(format==='xlsx') {
    const book=new ExcelJS.Workbook();const summary=book.addWorksheet('Resumo');summary.addRow(['Período',data.range.from+' a '+data.range.to]);summary.addRow(['Cobertura',data.coverage]);for(const [k,v]of Object.entries(data.summary))summary.addRow([k,v]);
    const packages=book.addWorksheet('Pacotes');packages.addRow(['Pacote','Pagamentos','Aprovados','Receita']);for(const p of data.packages)packages.addRow([p.name,p.payments,p.approved,p.revenue]);
    const sheet=book.addWorksheet('Pagamentos');sheet.addRow(columns);sheet.addRows(values);sheet.columns.forEach(c=>c.width=24);sheet.getRow(1).font={bold:true};buffer=await book.xlsx.writeBuffer();type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if(format==='pdf') {buffer=await pdfBuffer(doc=>{
    heading(doc,'Relatório comercial',data.range.from+' a '+data.range.to+' • Africa/Maputo');
    for(const [k,v]of Object.entries(data.summary))doc.fontSize(11).text(k+': '+v).moveDown(.4);
    doc.moveDown().text('Vendas por pacote').moveDown();
    for(const p of data.packages)doc.text(p.name+' — '+p.approved+' aprovados — '+Number(p.revenue).toFixed(2)+' MZN').moveDown(.4);
    doc.moveDown().fontSize(9).text(data.coverage);
  });type='application/pdf';}
  await pool.execute('INSERT INTO report_exports(admin_user_id,format,filters,row_count) VALUES (?,?,?,?)',[req.admin.id,format,JSON.stringify(data.range),rows.length]);
  await audit(req,'EXPORT_REPORT','reports',null,null,{format,...data.range,rows:rows.length});res.type(type).attachment(`eyazs-${data.range.from}-${data.range.to}.${format}`).send(buffer);
}
