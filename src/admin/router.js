import { Router } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { authRouter,requireAuth,requirePermission } from './auth.js';
import { wrap,audit,fail,transaction,paginated,idSchema } from './common.js';
import { dashboard,payments,paymentDetail,report } from './reportService.js';
import { connections,disconnect,health } from './networkService.js';
import { managementRouter } from './managementRoutes.js';
import { generateVoucherBatch } from '../services/voucherGenerator.js';
import { syncPendingVouchers } from '../services/voucherSyncService.js';
import { exportReport,receiptPdf } from './exportService.js';

export const adminRouter=Router();
const r=adminRouter;
r.use(helmet(),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
r.use(rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Limite de pedidos atingido.'}}));
r.use('/auth',authRouter);
r.use(requireAuth);
r.get('/dashboard/summary',requirePermission('dashboard.view'),wrap(async(req,res)=>res.json(await dashboard())));
r.get('/payments',requirePermission('payments.view'),wrap(async(req,res)=>res.json(await payments(req.query))));
r.get('/payments/:id',requirePermission('payments.view'),wrap(async(req,res)=>{const id=idSchema.parse(req.params.id);const result=await paymentDetail(id);await audit(req,'VIEW_PAYMENT','payments',id);res.json(result);}));
r.get('/receipts',requirePermission('receipts.view'),wrap(async(req,res)=>res.json(await payments(req.query,true))));
r.get('/receipts/:id/pdf',requirePermission('receipts.download'),wrap(receiptPdf));
r.get('/receipts/:id',requirePermission('receipts.view'),wrap(async(req,res)=>res.json(await paymentDetail(idSchema.parse(req.params.id),true))));
r.get('/reports/export/:format',requirePermission('reports.export'),wrap(exportReport));
for(const type of ['summary','payments','packages','vouchers'])r.get('/reports/'+type,requirePermission('reports.view'),wrap(async(req,res)=>res.json(await report(req.query))));
r.get('/packages',requirePermission('packages.view'),wrap(async(req,res)=>{
  const [data]=await pool.query(`SELECT p.*,COALESCE(s.available,0) AS available,COALESCE(s.waiting,0) AS waiting FROM pacotes p LEFT JOIN (SELECT pacote_id,SUM(status='disponivel' AND mikrotik_sync_status='sincronizado') AS available,SUM(status='disponivel' AND mikrotik_sync_status<>'sincronizado') AS waiting FROM vouchers GROUP BY pacote_id) s ON s.pacote_id=p.id ORDER BY p.ordem,p.id`);
  res.json({data,autoStockEnabled:env.voucherStock.enabled});
}));
r.patch('/packages/:id',requirePermission('packages.edit'),wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id);
  const body=z.object({nome:z.string().min(2).max(80),ativo:z.number().int().min(0).max(1),stock_minimo:z.number().int().min(0).max(10000),stock_alvo:z.number().int().min(1).max(10000),auto_stock_enabled:z.number().int().min(0).max(1)}).strict().refine(v=>v.stock_alvo>=v.stock_minimo,'Alvo deve ser igual ou maior ao mínimo').parse(req.body);
  await transaction(async c=>{
    const [[old]]=await c.execute('SELECT * FROM pacotes WHERE id=? FOR UPDATE',[id]);if(!old)fail(404,'Pacote não encontrado.');
    await c.execute('UPDATE pacotes SET nome=?,ativo=?,stock_minimo=?,stock_alvo=?,auto_stock_enabled=? WHERE id=?',[body.nome,body.ativo,body.stock_minimo,body.stock_alvo,body.auto_stock_enabled,id]);await audit(req,'UPDATE_PACKAGE','packages',id,old,body,c);
  });res.json({ok:true});
}));
const voucherFields='v.id,v.codigo_voucher,v.status,v.mikrotik_sync_status,v.mikrotik_sync_erro,v.data_criacao,v.pago_em,v.usado_em,p.nome AS pacote_nome';
r.get('/vouchers',requirePermission('vouchers.view'),wrap(async(req,res)=>{
  const where=[],args=[];
  for(const [q,col]of Object.entries({package:'v.pacote_id',status:'v.status',sync:'v.mikrotik_sync_status'}))if(req.query[q]){where.push(col+'=?');args.push(String(req.query[q]).slice(0,80));}
  if(req.query.search){where.push('v.codigo_voucher LIKE ?');args.push('%'+String(req.query.search).slice(0,80)+'%');}
  res.json(await paginated(pool,'SELECT '+voucherFields,'FROM vouchers v JOIN pacotes p ON p.id=v.pacote_id'+(where.length?' WHERE '+where.join(' AND '):''),args,req.query,'v.id DESC'));
}));
r.get('/vouchers/:id',requirePermission('vouchers.view'),wrap(async(req,res)=>{
  const [rows]=await pool.execute('SELECT '+voucherFields+' FROM vouchers v JOIN pacotes p ON p.id=v.pacote_id WHERE v.id=?',[idSchema.parse(req.params.id)]);if(!rows.length)fail(404,'Voucher não encontrado.');res.json(rows[0]);
}));
const operations=rateLimit({windowMs:60000,limit:5,standardHeaders:'draft-7',legacyHeaders:false});
r.post('/vouchers/generate',requirePermission('vouchers.generate'),operations,wrap(async(req,res)=>{
  const body=z.object({pacoteId:idSchema,quantity:z.number().int().min(1).max(100),prefix:z.string().regex(/^[A-Z0-9]{1,8}$/).default('VCH')}).strict().parse(req.body);
  await audit(req,'GENERATE_VOUCHERS_REQUEST','vouchers',null,null,body);
  const result=await generateVoucherBatch(body);
  await audit(req,'GENERATE_VOUCHERS','vouchers',null,null,{requested:result.requested,created:result.created,failed:result.failed});
  res.status(201).json({requested:result.requested,created:result.created,failed:result.failed});
}));
r.post('/vouchers/:id/sync',requirePermission('vouchers.sync'),operations,wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id);await audit(req,'SYNC_VOUCHER_REQUEST','vouchers',id);
  const result=await syncPendingVouchers({limit:1,voucherId:id});await audit(req,'SYNC_VOUCHER','vouchers',id,null,result);res.json(result);
}));
r.get('/connections',requirePermission('connections.view'),wrap(async(req,res)=>res.json(await connections())));
r.post('/connections/:id/disconnect',requirePermission('connections.disconnect'),operations,wrap(async(req,res)=>{
  await audit(req,'DISCONNECT_CLIENT_REQUEST','connections',req.params.id);const result=await disconnect(req.params.id);await audit(req,'DISCONNECT_CLIENT','connections',req.params.id);res.json(result);
}));
r.get('/system/health',requirePermission('system.view'),wrap(async(req,res)=>res.json(await health())));
r.get('/settings',requirePermission('settings.view'),(req,res)=>res.json({timeZone:'Africa/Maputo',autoStock:env.voucherStock.enabled,autoSync:env.voucherSync.enabled,paymentMode:env.payment.mode,trialMinutes:env.freeTrial.minutes,trialMaxDays:env.freeTrial.maxDays,message:'Configurações operacionais são geridas no ambiente do backend.'}));
r.use(managementRouter);
r.use((req,res)=>res.status(404).json({message:'Rota administrativa não encontrada.'}));
r.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  console.error('[ADMIN]', error?.message || error);
  if(error instanceof z.ZodError)return res.status(422).json({message:'Dados inválidos. Verifique os campos e limites.'});
  if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Registo já existe.'});
  const status=error.status>=400&&error.status<500?error.status:503;
  res.status(status).json({message:!env.production&&error.message?error.message:'Serviço administrativo indisponível. Verifique a migration e a ligação MySQL.'});
});
