import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { wrap, fail, audit, transaction, passwordSchema } from './common.js';

const issuer = 'eyazs-admin';
function secret() {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value || value.length < 32) fail(503, 'Autenticação administrativa não configurada.');
  return value;
}
function refreshSecret() {
  const value = process.env.JWT_REFRESH_SECRET;
  if (!value || value.length < 32) fail(503, 'Autenticação administrativa não configurada.');
  return value;
}
const digest = token => crypto.createHmac('sha256', refreshSecret()).update(token).digest('hex');
const freshRefresh = () => crypto.randomBytes(48).toString('base64url');
function refreshDays() {
  const value=String(process.env.JWT_REFRESH_EXPIRES_IN||'7d');
  const match=value.match(/^([1-9]\d*)d$/);
  if(!match||Number(match[1])>90) fail(503,'JWT_REFRESH_EXPIRES_IN inválido.');
  return Number(match[1]);
}
export async function readUser(id, db = pool) {
  const [rows] = await db.execute(`SELECT u.id,u.name,u.username,u.email,u.status,u.role_id,r.name AS role,u.last_login_at FROM admin_users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`,[id]);
  const user = rows[0];
  if (!user || user.status !== 'ativo') fail(401,'Sessão inválida.');
  const [grants] = await db.execute('SELECT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?',[user.role_id]);
  user.permissions = grants.map(p=>p.name);
  return user;
}
function access(user, sid) {
  const expiresIn=String(process.env.JWT_ACCESS_EXPIRES_IN||'15m');
  if(!/^(?:[1-9]\d*[smhd]|\d+)$/.test(expiresIn)) fail(503,'JWT_ACCESS_EXPIRES_IN inválido.');
  return jwt.sign({sid},secret(),{algorithm:'HS256',issuer,audience:'eyazs-admin-web',subject:String(user.id),expiresIn});
}
export const requireAuth = wrap(async (req,res,next) => {
  let token;
  try { token = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /i,''), secret(), {algorithms:['HS256'],issuer,audience:'eyazs-admin-web'}); }
  catch(e) { if(e.status===503) throw e; fail(401,'Sessão expirada ou inválida.'); }
  const [sessions] = await pool.execute('SELECT id FROM admin_sessions WHERE id=? AND admin_user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()',[token.sid,token.sub]);
  if(!sessions.length) fail(401,'Sessão terminada.');
  req.admin = await readUser(token.sub); req.sessionId = token.sid; next();
});
export const requirePermission = permission => (req,res,next) => {
  if (!req.admin?.permissions.includes(permission)) return res.status(403).json({message:'Sem permissão para esta operação.'});
  next();
};
export const authRouter = Router();
const limiter = rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Demasiadas tentativas. Tente mais tarde.'}});
authRouter.post('/login',limiter,wrap(async(req,res)=>{
  secret();
  const body = z.object({username:z.string().min(1).max(190),password:z.string().min(1).max(72)}).parse(req.body);
  const result = await transaction(async c => {
    const [rows] = await c.execute('SELECT * FROM admin_users WHERE username=? OR email=? LIMIT 1 FOR UPDATE',[body.username,body.username]);
    const row = rows[0];
    const valid = await bcrypt.compare(body.password,row?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5SrZNWJaPeOwvpEmcqLD12bfMIHBK9K');
    if(!row || row.status!=='ativo' || (row.locked_until && new Date(row.locked_until)>new Date()) || !valid) {
      if(row) await c.execute('UPDATE admin_users SET failed_attempts=failed_attempts+1, locked_until=IF(failed_attempts>=5,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),locked_until) WHERE id=?',[row.id]);
      await audit(req,'LOGIN_FAILED','auth',null,null,null,c);
      return null;
    }
    const user = await readUser(row.id,c), sid=crypto.randomUUID(), refreshToken=freshRefresh(), days=refreshDays();
    await c.execute(`INSERT INTO admin_sessions(id,admin_user_id,ip_address,user_agent,expires_at) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ${days} DAY))`,[sid,row.id,req.ip,String(req.headers['user-agent']||'').slice(0,255)]);
    await c.execute('INSERT INTO refresh_tokens(session_id,token_hash) VALUES (?,?)',[sid,digest(refreshToken)]);
    await c.execute('UPDATE admin_users SET failed_attempts=0,locked_until=NULL,last_login_at=UTC_TIMESTAMP() WHERE id=?',[row.id]);
    await audit({...req,admin:user},'LOGIN_SUCCESS','auth',sid,null,null,c);
    return {accessToken:access(user,sid),refreshToken,user};
  });
  if(!result) fail(401,'Credenciais inválidas ou conta indisponível.');
  res.json(result);
}));
authRouter.post('/refresh',limiter,wrap(async(req,res)=>{
  const {refreshToken}=z.object({refreshToken:z.string().min(32).max(200)}).parse(req.body);
  const result = await transaction(async c=>{
    const [rows]=await c.execute('SELECT t.id,t.used_at,s.id AS sid,s.admin_user_id,s.revoked_at,s.expires_at FROM refresh_tokens t JOIN admin_sessions s ON s.id=t.session_id WHERE token_hash=? FOR UPDATE',[digest(refreshToken)]);
    const row=rows[0];
    if(!row) return null;
    if(row.used_at || row.revoked_at || new Date(row.expires_at)<=new Date()) {
      await c.execute('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()) WHERE id=?',[row.sid]); return null;
    }
    const user=await readUser(row.admin_user_id,c), nextToken=freshRefresh();
    await c.execute('UPDATE refresh_tokens SET used_at=UTC_TIMESTAMP() WHERE id=?',[row.id]);
    await c.execute('INSERT INTO refresh_tokens(session_id,token_hash) VALUES (?,?)',[row.sid,digest(nextToken)]);
    return {accessToken:access(user,row.sid),refreshToken:nextToken,user};
  });
  if(!result) fail(401,'Sessão expirada. Inicie sessão novamente.');
  res.json(result);
}));
authRouter.use(requireAuth);
authRouter.get('/me',(req,res)=>res.json({user:req.admin}));
authRouter.post('/logout',wrap(async(req,res)=>{
  await transaction(async c=>{await c.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[req.sessionId]);await audit(req,'LOGOUT','auth',req.sessionId,null,null,c);});res.sendStatus(204);
}));
authRouter.get('/sessions',wrap(async(req,res)=>{
  const [data]=await pool.execute('SELECT id,ip_address,user_agent,created_at,expires_at FROM admin_sessions WHERE admin_user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()',[req.admin.id]);res.json({data,current:req.sessionId});
}));
authRouter.delete('/sessions/:id',wrap(async(req,res)=>{
  await transaction(async c=>{await c.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=? AND admin_user_id=?',[req.params.id,req.admin.id]);await audit(req,'REVOKE_SESSION','auth',req.params.id,null,null,c);});res.sendStatus(204);
}));
authRouter.post('/change-password',wrap(async(req,res)=>{
  const body=z.object({currentPassword:z.string().max(72),password:passwordSchema}).parse(req.body);
  await transaction(async c=>{
    const [[user]]=await c.execute('SELECT password_hash FROM admin_users WHERE id=? FOR UPDATE',[req.admin.id]);
    if(!await bcrypt.compare(body.currentPassword,user.password_hash)) fail(400,'Password atual incorreta.');
    await c.execute('UPDATE admin_users SET password_hash=? WHERE id=?',[await bcrypt.hash(body.password,12),req.admin.id]);
    await c.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP() WHERE admin_user_id=?',[req.admin.id]);
    await audit(req,'CHANGE_PASSWORD','users',req.admin.id,null,null,c);
  });res.json({message:'Password alterada. Inicie sessão novamente.'});
}));
