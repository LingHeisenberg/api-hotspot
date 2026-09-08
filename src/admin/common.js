import { z } from 'zod';
import { pool } from '../config/db.js';

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export const idSchema = z.coerce.number().int().positive();
export const passwordSchema = z.string().min(12).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Máximo 72 bytes');
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
export async function transaction(fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const result = await fn(c); await c.commit(); return result; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
export async function audit(req, action, resource, resourceId = null, oldData = null, newData = null, db = pool) {
  // Callers supply explicit safe fields, never request bodies or provider payloads.
  await db.execute(`INSERT INTO audit_logs (admin_user_id,action,resource,resource_id,old_data,new_data,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?)`,
    [req.admin?.id || null, action, resource, resourceId == null ? null : String(resourceId), oldData == null ? null : JSON.stringify(oldData), newData == null ? null : JSON.stringify(newData), String(req.ip || '').slice(0,45), String(req.headers?.['user-agent'] || '').slice(0,255)]);
}
export async function paginated(db, select, from, args, query, order = 'id DESC') {
  const {page, limit} = pageSchema.parse(query);
  const [count] = await db.execute(`SELECT COUNT(*) AS total ${from}`, args);
  const [data] = await db.execute(`${select} ${from} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page-1)*limit}`, args);
  return {data, pagination:{page,limit,total:Number(count[0].total),pages:Math.ceil(count[0].total/limit)}};
}
