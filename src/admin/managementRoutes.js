import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { requirePermission } from './auth.js';
import { audit,wrap,fail,transaction,idSchema,passwordSchema,paginated } from './common.js';
import { permissions } from './permissions.js';

export const managementRouter=Router();
const r=managementRouter;
const userSchema=z.object({name:z.string().min(2).max(100),username:z.string().regex(/^[a-zA-Z0-9_.-]{3,60}$/),email:z.string().email().max(190),role_id:idSchema});
const userSelect='SELECT u.id,u.name,u.username,u.email,u.status,u.role_id,r.name AS role,u.last_login_at,u.created_at';
r.get('/users',requirePermission('users.view'),wrap(async(req,res)=>res.json(await paginated(pool,userSelect,'FROM admin_users u JOIN roles r ON r.id=u.role_id',[],req.query,'u.id DESC'))));
r.post('/users',requirePermission('users.create'),wrap(async(req,res)=>{
  const body=userSchema.extend({password:passwordSchema}).strict().parse(req.body);
  const result=await transaction(async c=>{
    await assertRoleAssignment(req,c,body.role_id);
    const [result]=await c.execute('INSERT INTO admin_users(name,username,email,password_hash,role_id) VALUES (?,?,?,?,?)',[body.name,body.username,body.email,await bcrypt.hash(body.password,12),body.role_id]);
    const {password,...safe}=body;await audit(req,'CREATE_ADMIN','users',result.insertId,null,safe,c);return {id:result.insertId};
  });res.status(201).json(result);
}));
async function assertRoleAssignment(req,c,roleId) {
  const [[role]]=await c.execute('SELECT name FROM roles WHERE id=?',[roleId]);
  if(!role) fail(422,'Role inválido.');
  // Assigning privileges is itself privilege management, not merely user editing.
  if(req.admin.role!=='SUPER_ADMIN') {
    const [grants]=await c.execute('SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?',[roleId]);
    if(role.name==='SUPER_ADMIN'||grants.some(p=>!req.admin.permissions.includes(p.name))) fail(403,'Não pode atribuir privilégios superiores aos seus.');
  }
}
r.patch('/users/:id',requirePermission('users.edit'),wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id),body=userSchema.strict().parse(req.body);
  await transaction(async c=>{
    const [[old]]=await c.execute(`${userSelect} FROM admin_users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE`,[id]);
    if(!old)fail(404,'Utilizador não encontrado.');
    if(old.role==='SUPER_ADMIN'||id===req.admin.id)fail(409,'Use o perfil para dados próprios. Contas Super Admin são protegidas.');
    await assertRoleAssignment(req,c,body.role_id);
    await c.execute('UPDATE admin_users SET name=?,username=?,email=?,role_id=? WHERE id=?',[body.name,body.username,body.email,body.role_id,id]);
    await c.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP() WHERE admin_user_id=?',[id]);
    await audit(req,'UPDATE_ADMIN','users',id,old,body,c);
  });res.json({ok:true});
}));
r.post('/users/:id/disable',requirePermission('users.disable'),wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id);
  await transaction(async c=>{
    const [[old]]=await c.execute(`${userSelect} FROM admin_users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE`,[id]);
    if(!old)fail(404,'Utilizador não encontrado.');
    if(old.role==='SUPER_ADMIN'||id===req.admin.id)fail(409,'Não pode desativar esta conta.');
    await c.execute("UPDATE admin_users SET status='desativado' WHERE id=?",[id]);
    await c.execute('UPDATE admin_sessions SET revoked_at=UTC_TIMESTAMP() WHERE admin_user_id=?',[id]);await audit(req,'DISABLE_ADMIN','users',id,{status:old.status},{status:'desativado'},c);
  });res.json({ok:true});
}));
r.get('/roles',requirePermission('roles.view'),wrap(async(req,res)=>{
  const [roles]=await pool.query('SELECT id,name FROM roles ORDER BY id');
  const [grants]=await pool.query('SELECT rp.role_id,p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id');
  res.json({data:roles.map(r=>({...r,permissions:grants.filter(p=>p.role_id===r.id).map(p=>p.name)})),permissions});
}));
r.put('/roles/:id/permissions',requirePermission('roles.manage'),wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id),body=z.object({permissions:z.array(z.enum(permissions)).max(permissions.length)}).strict().parse(req.body);
  if(req.admin.role!=='SUPER_ADMIN')fail(403,'Só Super Admin pode alterar a matriz de acesso.');
  await transaction(async c=>{
    const [[role]]=await c.execute('SELECT * FROM roles WHERE id=? FOR UPDATE',[id]);
    if(!role)fail(404,'Role não encontrado.');if(role.name==='SUPER_ADMIN')fail(409,'Role Super Admin protegido.');
    if(role.name==='AUDITOR'&&body.permissions.some(p=>!p.endsWith('.view')))fail(422,'Auditor permite apenas leitura.');
    const [old]=await c.execute('SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE role_id=?',[id]);
    await c.execute('DELETE FROM role_permissions WHERE role_id=?',[id]);
    for(const p of new Set(body.permissions))await c.execute('INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?',[id,p]);
    await audit(req,'UPDATE_ROLE','roles',id,old.map(p=>p.name),body.permissions,c);
  });res.json({ok:true});
}));
r.get('/audit-logs',requirePermission('audit.view'),wrap(async(req,res)=>{
  const where=[],args=[];
  if(req.query.search){where.push('(a.action LIKE ? OR a.resource LIKE ?)');args.push('%'+String(req.query.search).slice(0,80)+'%','%'+String(req.query.search).slice(0,80)+'%');}
  res.json(await paginated(pool,'SELECT a.*',`FROM audit_logs a ${where.length?'WHERE '+where.join(' AND '):''}`,args,req.query,'a.id DESC'));
}));
r.patch('/profile',wrap(async(req,res)=>{
  const body=z.object({name:z.string().min(2).max(100),email:z.string().email().max(190)}).strict().parse(req.body);
  await transaction(async c=>{await c.execute('UPDATE admin_users SET name=?,email=? WHERE id=?',[body.name,body.email,req.admin.id]);await audit(req,'UPDATE_PROFILE','users',req.admin.id,{name:req.admin.name,email:req.admin.email},body,c);});res.json({ok:true});
}));
