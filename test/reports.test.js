import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';

// Never use the application's DB_URL for fixture writes. Integration checks use
// a separate, explicitly selected loopback connection and TEMPORARY tables only.
process.env.ADMIN_DB_TIME_ZONE = '+00:00';
const { pool } = await import('../src/config/db.js');
const { env } = await import('../src/config/env.js');
const { report, payments, paymentDetail, dashboard } = await import('../src/admin/reportService.js');
const { buildReportExport, csvCell } = await import('../src/admin/exportService.js');

const example = {
  range: {from:'2026-09-01',to:'2026-09-24'},
  summary: {payments:25,approved:14,pending:0,canceled:0,revenue:80,average:80/14},
  packages: [{name:'Matinal',payments:12,approved:12,revenue:60},{name:'Expediente',payments:2,approved:2,revenue:20}],
  coverage:'Valores calculados com o preço atual do pacote: ADMIN_DB_TIME_ZONE.'
};
const rows = [{reference:'ISP123',phone:'850000000',package_name:'Matinal',amount:5,method:'mpesa',status:'expirado',voucher:'TESTE'}];

test('exports translate summaries and preserve numeric spreadsheet amounts without coverage', async () => {
  const xlsx=await buildReportExport(example,rows,'xlsx');
  const book=new ExcelJS.Workbook();await book.xlsx.load(xlsx.buffer);
  const summary=book.getWorksheet('Resumo');
  assert.equal(summary.getCell('B1').value,'01/09/2026 a 24/09/2026');
  assert.equal(summary.getCell('A2').value,'Pagamentos');
  assert.equal(summary.getCell('A6').value,'Receita');
  assert.equal(summary.getCell('B6').value,80);
  assert.equal(summary.getCell('A7').value,'Valor médio por pagamento');
  assert.equal(summary.getCell('B7').numFmt,'#,##0.00" MTn"');
  assert.equal(book.getWorksheet('Pagamentos').getCell('D2').value,5);
  assert.equal(book.getWorksheet('Pagamentos').getCell('E2').value,'M-Pesa');
  assert.equal(book.getWorksheet('Pagamentos').getCell('F2').value,'Expirado');
  for(const sheet of book.worksheets) assert.doesNotMatch(JSON.stringify(sheet.getSheetValues()),/ADMIN_DB_TIME_ZONE|Valores calculados|Cobertura/);
  const csv=await buildReportExport(example,rows,'csv');
  assert.match(csv.buffer.toString(),/"5,00","M-Pesa","Expirado"/);
  assert.doesNotMatch(csv.buffer.toString(),/Valores calculados|ADMIN_DB_TIME_ZONE/);
  assert.equal(csvCell('=1+1'),'"\'=1+1"');
  const pdf=await buildReportExport(example,rows,'pdf');
  assert.equal(pdf.buffer.subarray(0,4).toString(),'%PDF');
  await assert.rejects(buildReportExport(example,rows,'html'),/Formato inválido/);
});

test('financial SQL retains expired sales, confirmation dates, receipts and dashboard totals', {
  skip: !process.env.ADMIN_TEST_MYSQL_URL && 'Set ADMIN_TEST_MYSQL_URL to a local MySQL database to run SQL regression checks'
}, async t => {
  const url=new URL(process.env.ADMIN_TEST_MYSQL_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Fixtures require a local database');
  const db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),decimalNumbers:true,dateStrings:true});
  const originalExecute=pool.execute, originalSync=env.mikrotik.syncEnabled;
  t.after(async()=>{pool.execute=originalExecute;env.mikrotik.syncEnabled=originalSync;await db.end();});
  env.mikrotik.syncEnabled=false;
  pool.execute=(...args)=>db.execute(...args);
  await db.query('CREATE TEMPORARY TABLE pacotes (id INT PRIMARY KEY,nome VARCHAR(80),preco DECIMAL(10,2))');
  await db.query(`CREATE TEMPORARY TABLE vouchers (
    id INT PRIMARY KEY,pacote_id INT,transacao_id VARCHAR(80),telefone_cliente VARCHAR(20),
    payment_provider VARCHAR(30),status VARCHAR(30),codigo_voucher VARCHAR(80),
    reservado_em DATETIME,pago_em DATETIME,usado_em DATETIME,mikrotik_login_at DATETIME,
    ip_cliente VARCHAR(80),mac_cliente VARCHAR(80),mikrotik_sync_status VARCHAR(30),
    mikrotik_sync_erro TEXT,mikrotik_login_message VARCHAR(255),data_criacao DATETIME)`);
  await db.query('CREATE TEMPORARY TABLE free_trials (status VARCHAR(30),trial_date DATE)');
  await db.query('CREATE TEMPORARY TABLE payment_events (id INT,provider VARCHAR(30),reference VARCHAR(80),status VARCHAR(80),payload JSON,created_at DATETIME)');
  await db.query("INSERT INTO pacotes VALUES (1,'Matinal',5),(2,'Expediente',10)");
  const add=async(id,status,reserved,paid,packageId=1,reference='ISP'+id)=>db.execute(
    `INSERT INTO vouchers(id,pacote_id,transacao_id,status,codigo_voucher,reservado_em,pago_em,data_criacao,payment_provider,mikrotik_sync_status)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,packageId,reference,status,'VCH'+id,reserved,paid,reserved,'mpesa','sincronizado']);
  await add(1,'pago','2026-09-23 09:00:00','2026-09-23 09:01:00');
  await add(2,'usado','2026-09-23 10:00:00','2026-09-23 10:01:00',2);
  await add(3,'expirado','2026-09-23 11:00:00','2026-09-23 11:01:00');
  await add(4,'pendente','2026-09-23 12:00:00',null);
  await add(5,'cancelado','2026-09-23 13:00:00',null);
  await add(6,'usado','2026-09-23 14:00:00',null,1,null); // no financial reference
  await add(7,'disponivel','2026-09-23 15:00:00',null,1,null);
  await add(8,'expirado','2026-09-22 21:00:00','2026-09-22 22:00:00'); // midnight Maputo, confirmed next day
  await add(9,'expirado','2026-09-23 20:00:00','2026-09-23 22:00:00'); // next day, excluded
  await add(10,'expirado','2026-09-23 16:00:00',null); // legacy timestamp fallback
  await db.query("INSERT INTO payment_events VALUES (1,'mpesa','ISP3','paid','{}',NOW()),(2,'mpesa','ISP3','paid','{}',NOW())");
  const query={from:'2026-09-23',to:'2026-09-23'};
  const before=await report(query);
  assert.equal(Number(before.summary.revenue),30);
  assert.equal(Number(before.summary.approved),5);
  assert.equal(Number(before.summary.payments),7);
  assert.equal(Number(before.summary.pending),1);
  assert.equal(Number(before.summary.canceled),1);
  assert.equal(before.summary.average,6);
  assert.equal(before.daily.length,1);
  assert.equal(before.daily[0].day,'2026-09-23');
  assert.equal(Number(before.daily[0].revenue),30);
  assert.equal(before.packages.reduce((sum,p)=>sum+Number(p.revenue),0),30);
  assert.equal(before.hours.reduce((sum,p)=>sum+Number(p.sales),0),5);
  assert.equal(before.coverage,undefined);
  await db.query("UPDATE vouchers SET status='expirado' WHERE id IN (1,2)");
  assert.deepEqual((await report(query)).summary,before.summary,'expiration must not change financial totals');
  const receipts=await payments({...query,limit:100},true);
  assert.deepEqual(receipts.data.map(p=>p.id).sort((a,b)=>a-b),[1,2,3,8,10]);
  assert.equal(receipts.data.find(p=>p.id===8).payment_date,'2026-09-23 00:00:00');
  const detail=await paymentDetail(3,true);
  assert.equal(detail.receiptNumber,'EY-00000003');
  assert.equal(detail.events.length,2,'duplicate events must not double count revenue');
  await assert.rejects(paymentDetail(4,true),/não encontrado/);
  const next=await report({from:'2026-09-24',to:'2026-09-24'});
  assert.equal(Number(next.summary.revenue),5);
  const empty=await report({from:'2026-08-01',to:'2026-08-01'});
  assert.equal(Number(empty.summary.revenue),0);
  assert.equal(Number(empty.summary.average),0);
  const overview=await dashboard();
  assert.equal(Number(overview.total.revenue),35);
});
