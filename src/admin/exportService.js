import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { pool } from '../config/db.js';
import { audit,fail,idSchema } from './common.js';
import { report,payments,paymentDetail } from './reportService.js';
import { renderCommercialReport } from './reportPdf.js';

export function csvCell(value) {
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function pdfBuffer(write) {
  return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:48});const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);try{write(doc);doc.end();}catch(e){reject(e);}});
}
function heading(doc,title,subtitle) {doc.fillColor('#123044').fontSize(21).text('EYAZS IMPERIUM LDA').moveDown(.6).fontSize(15).text(title).fontSize(10).fillColor('#475569').text(subtitle).moveDown(1.5);}
const summaryLabels = {
  payments: 'Pagamentos', approved: 'Aprovados', pending: 'Pendentes',
  canceled: 'Cancelados', revenue: 'Receita', average: 'Valor médio por pagamento'
};
const decimal = value => Number(value || 0).toLocaleString('pt-MZ', {minimumFractionDigits:2,maximumFractionDigits:2});
const dateLabel = value => String(value).slice(0,10).split('-').reverse().join('/');
const methodLabel = value => ({mpesa:'M-Pesa',emola:'e-Mola',mock:'Teste'})[value] || value || 'Não registado';
const statusLabel = value => ({pago:'Pago',usado:'Usado',expirado:'Expirado',pendente:'Pendente',cancelado:'Cancelado',disponivel:'Disponível'})[value] || value || 'Não registado';

// Rendering is independent of database access so all export formats can be
// checked against the same report, including empty periods and expired vouchers.
export async function buildReportExport(data, rows, format) {
  const period = dateLabel(data.range.from)+' a '+dateLabel(data.range.to);
  const columns=['Referência','Telefone','Pacote','Valor (MTn)','Método','Estado do voucher','Voucher'];
  const values=rows.map(p=>[p.reference,p.phone,p.package_name,Number(p.amount),methodLabel(p.method),statusLabel(p.status),p.voucher]);
  if(format==='csv') {
    const formatted=values.map(row=>row.map((value,index)=>index===3?decimal(value):value));
    return {buffer:Buffer.from('\uFEFF'+[columns,...formatted].map(r=>r.map(csvCell).join(',')).join('\r\n')),type:'text/csv; charset=utf-8'};
  }
  if(format==='xlsx') {
    const book=new ExcelJS.Workbook();
    const summary=book.addWorksheet('Resumo');
    summary.addRow(['Período',period]);
    for(const [key,label]of Object.entries(summaryLabels)) {
      const row=summary.addRow([label,Number(data.summary[key]||0)]);
      if(['revenue','average'].includes(key))row.getCell(2).numFmt='#,##0.00" MTn"';
    }
    const packages=book.addWorksheet('Pacotes');
    packages.addRow(['Pacote','Pagamentos','Aprovados','Receita (MTn)']);
    for(const p of data.packages)packages.addRow([p.name,Number(p.payments),Number(p.approved),Number(p.revenue)]);
    packages.getColumn(4).numFmt='#,##0.00" MTn"';
    const sheet=book.addWorksheet('Pagamentos');
    sheet.addRow(columns);sheet.addRows(values);sheet.getColumn(4).numFmt='#,##0.00" MTn"';
    for(const sheet of book.worksheets){sheet.columns.forEach(c=>c.width=28);sheet.getRow(1).font={bold:true};}
    return {buffer:await book.xlsx.writeBuffer(),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  }
  if(format==='pdf') {
    return {buffer:await renderCommercialReport(data),type:'application/pdf'};
  }
  fail(422,'Formato inválido.');
}
export async function receiptPdf(req,res) {
  const id=idSchema.parse(req.params.id),detail=await paymentDetail(id,true),p=detail.payment;
  const buffer=await pdfBuffer(doc=>{
    heading(doc,'Comprovativo eletrónico '+detail.receiptNumber,'Pagamento confirmado • Hotspot Eyazs');
    for(const [label,value]of Object.entries({'Referência interna':p.reference,'Referência M-Pesa':p.provider_reference||'Não registada','Data de confirmação':String(p.confirmed_at||'Não registada'),'Telefone':p.phone,'Pacote':p.package_name,'Valor (MZN)':Number(p.amount).toFixed(2),'Método':p.method,'Voucher':p.voucher,'Estado':p.status}))doc.fontSize(11).fillColor('#123044').text(label+': '+value).moveDown(.65);
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
  const {buffer,type}=await buildReportExport(data,rows,format);
  await pool.execute('INSERT INTO report_exports(admin_user_id,format,filters,row_count) VALUES (?,?,?,?)',[req.admin.id,format,JSON.stringify(data.range),rows.length]);
  await audit(req,'EXPORT_REPORT','reports',null,null,{format,...data.range,rows:rows.length});res.type(type).attachment(`eyazs-${data.range.from}-${data.range.to}.${format}`).send(buffer);
}
