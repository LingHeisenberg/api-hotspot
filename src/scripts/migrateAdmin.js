import { migrateAdmin } from '../admin/migrate.js';
import { pool } from '../config/db.js';
try { await migrateAdmin(); console.log('Migration administrativa concluída. Dados comerciais preservados.'); }
catch { console.error('Migration falhou. Verifique o schema e acesso MySQL.'); process.exitCode = 1; }
finally { await pool.end(); }
