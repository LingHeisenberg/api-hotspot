import { pool } from '../config/db.js';

import {
  disableHotspotUser,
  removeActiveHotspotSession
} from './mikrotikService.js';


/**
 * Procura vouchers cuja validade absoluta terminou
 * e corta o acesso no MikroTik.
 */
export async function expireVouchers() {
  const [vouchers] = await pool.execute(
    `SELECT
       id,
       codigo_voucher,
       status,
       pago_em,
       expira_em
     FROM vouchers
     WHERE status IN ('pago', 'usado')
       AND expira_em IS NOT NULL
       AND expira_em <= NOW()
     ORDER BY expira_em ASC
     LIMIT 100`
  );

  if (vouchers.length === 0) {
    return {
      found: 0,
      expired: 0,
      failed: 0
    };
  }

  let expired = 0;
  let failed = 0;

  for (const voucher of vouchers) {
    try {
      /**
       * 1. Impede novo login.
       */
      const disabled =
        await disableHotspotUser(
          voucher.codigo_voucher
        );

      if (!disabled.ok) {
        failed += 1;

        console.error(
          `[VOUCHER-EXPIRATION] Falha ao desativar ${voucher.codigo_voucher}:`,
          disabled.message
        );

        continue;
      }

      /**
       * 2. Derruba sessão que já estiver ativa.
       */
      const session =
        await removeActiveHotspotSession(
          voucher.codigo_voucher
        );

      if (!session.ok) {
        failed += 1;

        console.error(
          `[VOUCHER-EXPIRATION] Falha ao remover sessão ${voucher.codigo_voucher}:`,
          session.message
        );

        continue;
      }

      /**
       * 3. Só marca como expirado depois
       * de aplicar o corte no MikroTik.
       */
      const [result] =
        await pool.execute(
          `UPDATE vouchers
           SET status = 'expirado',
               expirado_em = NOW(),
               status_mensagem = 'Validade do pacote terminada.'
           WHERE id = ?
             AND status IN ('pago', 'usado')
             AND expira_em IS NOT NULL
             AND expira_em <= NOW()`,
          [voucher.id]
        );

      if (result.affectedRows > 0) {
        expired += 1;

        console.log(
          `[VOUCHER-EXPIRATION] ${voucher.codigo_voucher} expirado.`
        );
      }
    } catch (error) {
      failed += 1;

      console.error(
        `[VOUCHER-EXPIRATION] Erro em ${voucher.codigo_voucher}:`,
        error.message
      );
    }
  }

  return {
    found: vouchers.length,
    expired,
    failed
  };
}