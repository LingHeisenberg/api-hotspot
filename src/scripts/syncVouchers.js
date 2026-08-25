import { pool } from '../config/db.js';
import { createHotspotUser } from '../services/mikrotikService.js';
import { durationToRouterTime } from '../utils/mikrotikTime.js';

const args = parseArgs(process.argv.slice(2));
const params = [];
const filters = ["v.status <> 'cancelado'"];

if (!args.force) {
  filters.push('v.mikrotik_synced_at IS NULL');
}

if (args.code) {
  filters.push('v.codigo_voucher = ?');
  params.push(args.code);
}

if (args.reference) {
  filters.push('v.transacao_id = ?');
  params.push(args.reference);
}

const [vouchers] = await pool.execute(
  `SELECT
     v.id,
     v.codigo_voucher,
     v.senha_voucher,
     v.transacao_id,
     p.nome AS pacote_nome,
     p.tempo,
     p.perfil_mikrotik
   FROM vouchers v
   JOIN pacotes p ON v.pacote_id = p.id
   WHERE ${filters.join(' AND ')}
   ORDER BY v.id ASC
   LIMIT ?`,
  [...params, Number(args.limit || 100)]
);

let synced = 0;
let failed = 0;

for (const voucher of vouchers) {
  const sync = await createHotspotUser({
    username: voucher.codigo_voucher,
    password: voucher.senha_voucher,
    profile: args.profile || voucher.perfil_mikrotik,
    limitUptime: args.limitUptime || durationToRouterTime(voucher.tempo),
    comment: `Sincronizado pelo sistema - ${voucher.pacote_nome}`
  });

  if (sync.ok) {
    synced += 1;
    await pool.execute(
      `UPDATE vouchers
       SET mikrotik_user_id = ?,
           mikrotik_synced_at = NOW(),
           mikrotik_error = NULL,
           status_mensagem = COALESCE(status_mensagem, 'Voucher sincronizado com MikroTik.')
       WHERE id = ?`,
      [sync.id || null, voucher.id]
    );
    console.log(`OK ${voucher.codigo_voucher}`);
  } else {
    failed += 1;
    await pool.execute(
      `UPDATE vouchers
       SET mikrotik_error = ?
       WHERE id = ?`,
      [String(sync.message || 'Falha ao sincronizar com MikroTik.').slice(0, 255), voucher.id]
    );
    console.log(`FALHA ${voucher.codigo_voucher}: ${sync.message}`);
  }
}

await pool.end();

console.log(`Sincronizacao concluida. Encontrados: ${vouchers.length}. OK: ${synced}. Falhas: ${failed}.`);

function parseArgs(values) {
  return values.reduce((acc, item) => {
    const match = item.match(/^--([^=]+)=(.*)$/);

    if (match) {
      acc[match[1]] = match[2];
    }

    return acc;
  }, {});
}
