import { pool } from '../config/db.js';

const [rows] = await pool.execute(
  `SELECT
     p.id,
     p.nome,
     p.perfil_mikrotik,
     SUM(CASE WHEN v.status = 'disponivel' THEN 1 ELSE 0 END) AS disponiveis,
     SUM(CASE WHEN v.status = 'disponivel' AND v.mikrotik_synced_at IS NOT NULL THEN 1 ELSE 0 END) AS sincronizados,
     SUM(CASE WHEN v.status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
     SUM(CASE WHEN v.status = 'pago' THEN 1 ELSE 0 END) AS pagos,
     SUM(CASE WHEN v.status = 'usado' THEN 1 ELSE 0 END) AS usados
   FROM pacotes p
   LEFT JOIN vouchers v ON v.pacote_id = p.id
   GROUP BY p.id, p.nome, p.perfil_mikrotik
   ORDER BY p.id`
);

console.table(rows);
await pool.end();
