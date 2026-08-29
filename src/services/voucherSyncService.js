import { pool } from '../config/db.js';
import { syncVoucherToMikrotik } from './mikrotikService.js';
import { durationToRouterTime } from '../utils/mikrotikTime.js';

let syncRunning = false;

export async function syncPendingVouchers({
  limit = 100
} = {}) {
  /*
   * Impede duas sincronizações simultâneas
   * dentro da mesma instância do backend.
   */
  if (syncRunning) {
    console.log(
      '[VOUCHER-SYNC] Sincronização anterior ainda está em execução.'
    );

    return {
      skipped: true,
      reason: 'already_running'
    };
  }

  syncRunning = true;

  let synced = 0;
  let failed = 0;

  try {
    const safeLimit = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );

    /*
     * Busca somente vouchers que precisam
     * ser recuperados.
     */
    const [vouchers] = await pool.execute(
      `SELECT
         v.id,
         v.codigo_voucher,
         v.senha_voucher,
         v.status,
         v.transacao_id,
         v.mikrotik_sync_status,

         p.nome AS pacote_nome,
         p.tempo,
         p.perfil_mikrotik

       FROM vouchers v

       JOIN pacotes p
         ON p.id = v.pacote_id

       WHERE v.status <> 'cancelado'
         AND v.mikrotik_sync_status IN ('pendente', 'erro')

       ORDER BY v.id ASC

       LIMIT ${safeLimit}`
    );

    if (vouchers.length === 0) {
      console.log(
        '[VOUCHER-SYNC] Nenhum voucher pendente.'
      );

      return {
        found: 0,
        synced: 0,
        failed: 0
      };
    }

    console.log(
      `[VOUCHER-SYNC] ${vouchers.length} voucher(es) encontrados.`
    );

    /*
     * Sincroniza um por um.
     */
    for (const voucher of vouchers) {
      try {
        console.log(
          `[VOUCHER-SYNC] Sincronizando ${voucher.codigo_voucher}...`
        );

        const sync = await syncVoucherToMikrotik({
          username: voucher.codigo_voucher,

          password: voucher.senha_voucher,

          profile:
            voucher.perfil_mikrotik ||
            'default',

          limitUptime:
            durationToRouterTime(
              voucher.tempo
            ),

          comment:
            `Sincronizado automaticamente - ${voucher.pacote_nome}`
        });

        /*
         * Falha retornada pelo MikroTik.
         */
        if (!sync.ok) {
          failed += 1;

          const message = String(
            sync.message ||
            'Falha ao sincronizar com MikroTik.'
          ).slice(0, 1000);

          await pool.execute(
            `UPDATE vouchers
             SET
               mikrotik_sync_status = 'erro',
               mikrotik_sync_erro = ?,
               mikrotik_error = ?
             WHERE id = ?`,
            [
              message,
              message.slice(0, 255),
              voucher.id
            ]
          );

          console.error(
            `[VOUCHER-SYNC] FALHA ${voucher.codigo_voucher}: ${message}`
          );

          continue;
        }

        /*
         * Sucesso.
         */
        synced += 1;

        await pool.execute(
          `UPDATE vouchers
           SET
             mikrotik_sync_status = 'sincronizado',
             mikrotik_sync_erro = NULL,
             mikrotik_sync_em = NOW(),

             mikrotik_user_id = ?,
             mikrotik_synced_at = NOW(),
             mikrotik_error = NULL,

             status_mensagem =
               CASE
                 WHEN status_mensagem IS NULL
                      OR status_mensagem = ''
                 THEN 'Voucher sincronizado automaticamente com MikroTik.'
                 ELSE status_mensagem
               END

           WHERE id = ?`,
          [
            sync.id || null,
            voucher.id
          ]
        );

        console.log(
          `[VOUCHER-SYNC] OK ${voucher.codigo_voucher}`
        );

      } catch (error) {
        failed += 1;

        const message = String(
          error.message ||
          'Erro inesperado durante sincronização.'
        ).slice(0, 1000);

        await pool.execute(
          `UPDATE vouchers
           SET
             mikrotik_sync_status = 'erro',
             mikrotik_sync_erro = ?,
             mikrotik_error = ?
           WHERE id = ?`,
          [
            message,
            message.slice(0, 255),
            voucher.id
          ]
        );

        console.error(
          `[VOUCHER-SYNC] ERRO ${voucher.codigo_voucher}:`,
          message
        );
      }
    }

    console.log(
      `[VOUCHER-SYNC] Concluído. OK=${synced}, falhas=${failed}.`
    );

    return {
      found: vouchers.length,
      synced,
      failed
    };

  } finally {
    syncRunning = false;
  }
}