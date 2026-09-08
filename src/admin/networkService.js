import { checkHotspotReadiness,requestMikrotik,getMikrotikRestUrl } from '../services/mikrotikService.js';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { fail } from './common.js';
let cached=null,expires=0,pending=null;
export async function connections() {
  if(!env.mikrotik.syncEnabled) fail(503,'Integração MikroTik desativada.');
  if(cached && Date.now()<expires) return cached;
  if(pending) return pending;
  pending=(async()=>{
    const result=await requestMikrotik(getMikrotikRestUrl('/ip/hotspot/active'),{method:'GET'});
    if(!result.ok||!Array.isArray(result.data)) fail(503,'Não foi possível consultar as conexões MikroTik.');
    cached={data:result.data.map(v=>({id:v['.id'],username:v.user,ip:v.address,mac:v['mac-address'],uptime:v.uptime,profile:v.profile||null})),checkedAt:new Date().toISOString()};expires=Date.now()+30000;return cached;
  })();
  try{return await pending;}finally{pending=null;}
}
export async function disconnect(id) {
  if(!/^\*[A-Fa-f0-9]+$/.test(id)) fail(422,'Sessão MikroTik inválida.');
  if(!env.mikrotik.syncEnabled) fail(503,'Integração MikroTik desativada.');
  const result=await requestMikrotik(getMikrotikRestUrl('/ip/hotspot/active/'+encodeURIComponent(id)),{method:'DELETE'});
  if(!result.ok) fail(502,'MikroTik não confirmou a desconexão.');cached=null;return {ok:true};
}
let healthCache=null,healthExpires=0;
export async function health() {
  if(healthCache&&Date.now()<healthExpires)return healthCache;
  let mysql=false,stock=null;
  try{await pool.query('SELECT 1');mysql=true;const [[row]]=await pool.query("SELECT MAX(mikrotik_sync_em) AS lastSync,SUM(mikrotik_sync_status='pendente') AS pending,SUM(mikrotik_sync_status='erro') AS errors FROM vouchers");stock=row;}catch{}
  const ready=await checkHotspotReadiness();
  healthCache={backend:'online',mysql:mysql?'online':'offline',mikrotik:ready.ok?'online':'indisponível',mpesa:env.payment.mode==='mock'?'modo de teste':env.payment.mpesa.apiUrl?'configurado; disponibilidade não verificada':'não configurado',stock,checkedAt:new Date().toISOString()};healthExpires=Date.now()+30000;return healthCache;
}
