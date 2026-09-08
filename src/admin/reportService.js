import { pool } from '../config/db.js';
import { paginated, fail } from './common.js';
import { dateRange,maputoColumn } from './dates.js';
import { connections } from './networkService.js';

export const coverage='Valores calculados com o preço atual do pacote: o sistema antigo não guardava o valor da venda. Tentativas devolvidas ao stock podem existir apenas em payment_events. Cancelado não equivale a todas as falhas. Datas interpretadas com ADMIN_DB_TIME_ZONE.';
const fields=`v.id,v.transacao_id AS reference,v.telefone_cliente AS phone,p.nome AS package_name,p.preco AS amount,v.payment_provider AS method,v.status,v.codigo_voucher AS voucher,v.reservado_em AS created_at,v.pago_em AS confirmed_at,v.usado_em AS used_at,v.mikrotik_login_at AS activated_at,v.ip_cliente AS ip,v.mac_cliente AS mac,v.mikrotik_sync_status,v.mikrotik_sync_erro,v.mikrotik_login_message`;
export function paymentFilter(query={},receipts=false) {
  const where=['v.transacao_id IS NOT NULL'], args=[];
  if(receipts) where.push("v.status IN ('pago','usado')");
  if(query.from||query.to||query.period) {const r=dateRange(query);where.push(`${maputoColumn('v.reservado_em')}>=? AND ${maputoColumn('v.reservado_em')}<?`);args.push(r.start,r.end);}
  for(const [key,col] of Object.entries({status:'v.status',package:'v.pacote_id',method:'v.payment_provider',phone:'v.telefone_cliente',reference:'v.transacao_id',voucher:'v.codigo_voucher'})) {
    if(query[key]) {if(typeof query[key]!=='string'||query[key].length>190) fail(422,'Filtro inválido.');where.push(`${col}=?`);args.push(query[key]);}
  }
  if(query.search) {if(typeof query.search!=='string'||query.search.length>190) fail(422,'Pesquisa inválida.');where.push('(v.transacao_id LIKE ? OR v.telefone_cliente LIKE ? OR v.codigo_voucher LIKE ?)');args.push(...Array(3).fill('%'+query.search+'%'));}
  return {from:`FROM vouchers v JOIN pacotes p ON p.id=v.pacote_id WHERE ${where.join(' AND ')}`,args};
}
export async function payments(query,receipts=false) {
  const {from,args}=paymentFilter(query,receipts);
  const column={date:'v.reservado_em',amount:'p.preco',status:'v.status'}[query.sort||'date'];
  if(!column||!['asc','desc'].includes(query.direction||'desc')) fail(422,'Ordenação inválida.');
  return {...await paginated(pool,`SELECT ${fields}`,from,args,query,`${column} ${(query.direction||'desc').toUpperCase()},v.id DESC`),coverage};
}
export async function paymentDetail(id,receipt=false) {
  const [rows]=await pool.execute(`SELECT ${fields} FROM vouchers v JOIN pacotes p ON p.id=v.pacote_id WHERE v.id=? AND v.transacao_id IS NOT NULL ${receipt?"AND v.status IN ('pago','usado')":''}`,[id]);
  if(!rows.length) fail(404,'Pagamento confirmado ou registo não encontrado.');
  const payment=rows[0];
  // Explicit event fields avoid leaking arbitrary gateway payloads/secrets.
  const [events]=await pool.execute('SELECT id,provider,reference,status,created_at FROM payment_events WHERE reference=? ORDER BY created_at,id',[payment.reference]);
  const [refs]=await pool.execute(`SELECT JSON_UNQUOTE(COALESCE(JSON_EXTRACT(payload,'$.output_TransactionID'),JSON_EXTRACT(payload,'$.raw.output_TransactionID'))) AS provider_reference FROM payment_events WHERE reference=? ORDER BY id DESC LIMIT 1`,[payment.reference]);
  return {payment:{...payment,provider_reference:refs[0]?.provider_reference||null},events,coverage,receiptNumber:receipt?`EY-${String(payment.id).padStart(8,'0')}`:undefined};
}
export async function report(query={}) {
  const range=dateRange(query), {from,args}=paymentFilter({...query,from:range.from,to:range.to});
  const [[summary]]=await pool.execute(`SELECT COUNT(*) AS payments,COALESCE(SUM(v.status IN ('pago','usado')),0) AS approved,COALESCE(SUM(v.status='pendente'),0) AS pending,COALESCE(SUM(v.status='cancelado'),0) AS canceled,COALESCE(SUM(IF(v.status IN ('pago','usado'),p.preco,0)),0) AS revenue,COALESCE(AVG(IF(v.status IN ('pago','usado'),p.preco,NULL)),0) AS average ${from}`,args);
  const [packages]=await pool.execute(`SELECT p.nome AS name,COUNT(*) AS payments, SUM(v.status IN ('pago','usado')) AS approved, SUM(IF(v.status IN ('pago','usado'),p.preco,0)) AS revenue ${from} GROUP BY p.id,p.nome ORDER BY revenue DESC`,args);
  const [daily]=await pool.execute(`SELECT DATE(${maputoColumn('v.reservado_em')}) AS day, COUNT(*) AS payments,SUM(IF(v.status IN ('pago','usado'),p.preco,0)) AS revenue ${from} GROUP BY day ORDER BY day`,args);
  const [states]=await pool.execute(`SELECT v.status AS name,COUNT(*) AS value ${from} GROUP BY v.status`,args);
  const [methods]=await pool.execute(`SELECT v.payment_provider AS name,COUNT(*) AS value ${from} GROUP BY v.payment_provider`,args);
  const [hours]=await pool.execute(`SELECT HOUR(${maputoColumn('v.reservado_em')}) AS hour,COUNT(*) AS sales ${from} AND v.status IN ('pago','usado') GROUP BY hour ORDER BY hour`,args);
  const [vouchers]=await pool.execute(`SELECT status AS name,COUNT(*) AS value FROM vouchers WHERE ${maputoColumn('data_criacao')}>=? AND ${maputoColumn('data_criacao')}<? GROUP BY status`,[range.start,range.end]);
  const [[trials]]=await pool.execute('SELECT COUNT(*) AS total,COALESCE(SUM(status<>\'erro\'),0) AS used FROM free_trials WHERE trial_date>=? AND trial_date<=?',[range.from,range.to]);
  return {range,summary,packages,daily,states,methods,hours,vouchers,trials,coverage};
}
export async function dashboard() {
  const today=await report({period:'today'}),week=await report({period:'week'}),month=await report({period:'month'});
  const [[total]]=await pool.execute("SELECT COALESCE(SUM(p.preco),0) AS revenue FROM vouchers v JOIN pacotes p ON p.id=v.pacote_id WHERE v.status IN ('pago','usado')");
  const [[stock]]=await pool.execute("SELECT SUM(status='disponivel') AS available,SUM(status='pendente') AS pending,SUM(status='usado') AS used,SUM(mikrotik_sync_status='sincronizado') AS synced FROM vouchers");
  const [[trials]]=await pool.execute("SELECT COUNT(*) AS used FROM free_trials WHERE status<>'erro'");
  const [reconciliation]=await pool.execute(`SELECT id,codigo_voucher AS voucher,transacao_id AS reference,CASE WHEN status='usado' AND transacao_id IS NULL THEN 'Utilizado sem referência de pagamento' WHEN mikrotik_sync_status<>'sincronizado' THEN 'Pago sem sincronização confirmada' ELSE 'Ativação REST sem confirmação; verificar login pelo navegador' END AS issue FROM vouchers WHERE (status IN ('pago','usado') AND mikrotik_sync_status<>'sincronizado') OR (status='usado' AND transacao_id IS NULL) OR (status IN ('pago','usado') AND mikrotik_login_at IS NULL AND mikrotik_login_message IS NOT NULL) ORDER BY id DESC LIMIT 100`);
  const local=new Date(Date.now()+7200000),to=local.toISOString().slice(0,10),from=new Date(+local-29*86400000).toISOString().slice(0,10);
  let activeClients=null;
  try { activeClients=(await connections()).data.length; } catch { /* financial dashboard remains available if RB is offline */ }
  return {today:today.summary,week:week.summary,month:month.summary,total,stock,trials,charts:await report({from,to}),reconciliation,activeClients,coverage};
}
