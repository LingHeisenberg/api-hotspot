import { pool } from '../config/db.js';
import { generateVoucherBatch } from './voucherGenerator.js';

let stockCheckRunning = false;

export async function refillVoucherStock() {
  if (stockCheckRunning) {
    return {
      skipped: true,
      reason: 'already_running'
    };
  }

  stockCheckRunning = true;

  const results = [];

  try {
    const [plans] = await pool.execute(
      `SELECT
         p.id,
         p.nome,
         p.stock_minimo,
         p.stock_alvo,

         SUM(
           CASE
             WHEN v.status = 'disponivel'
              AND v.mikrotik_sync_status = 'sincronizado'
             THEN 1
             ELSE 0
           END
         ) AS disponiveis,

         SUM(
           CASE
             WHEN v.status = 'disponivel'
              AND v.mikrotik_sync_status IN ('pendente', 'erro')
             THEN 1
             ELSE 0
           END
         ) AS aguardando_sync

       FROM pacotes p

       LEFT JOIN vouchers v
         ON v.pacote_id = p.id

       WHERE p.ativo = 1
         AND p.auto_stock_enabled = 1

       GROUP BY
         p.id,
         p.nome,
         p.stock_minimo,
         p.stock_alvo

       ORDER BY p.id`
    );

    for (const plan of plans) {
      const disponiveis =
        Number(plan.disponiveis || 0);

      const aguardandoSync =
        Number(plan.aguardando_sync || 0);

      const minimo =
        Number(plan.stock_minimo || 10);

      const alvo =
        Number(plan.stock_alvo || 30);

      /*
       * Se já existem vouchers aguardando
       * sincronização com a RB, não gera mais.
       *
       * Primeiro o voucherSyncService tenta
       * recuperar esses vouchers.
       */
      if (aguardandoSync > 0) {
        console.log(
          `[STOCK] ${plan.nome}: ${aguardandoSync} voucher(es) aguardando sincronização. Reposição adiada.`
        );

        results.push({
          planId: plan.id,
          plan: plan.nome,
          action: 'waiting_sync',
          available: disponiveis,
          waitingSync: aguardandoSync
        });

        continue;
      }

      /*
       * Stock ainda está saudável.
       */
      if (disponiveis >= minimo) {
        results.push({
          planId: plan.id,
          plan: plan.nome,
          action: 'ok',
          available: disponiveis
        });

        continue;
      }

      /*
       * Exemplo:
       *
       * disponíveis = 9
       * alvo = 30
       *
       * gera 21.
       */
      const quantidade =
        Math.max(
          alvo - disponiveis,
          0
        );

      if (quantidade === 0) {
        continue;
      }

      console.log(
        `[STOCK] ${plan.nome}: stock baixo (${disponiveis}/${minimo}). Necessário gerar ${quantidade}.`
      );

      /*
       * Lock MySQL para impedir que duas
       * instâncias do Railway reponham
       * o mesmo pacote simultaneamente.
       */
      const connection =
        await pool.getConnection();

      const lockName =
        `hotspot_stock_${plan.id}`;

      try {
        const [lockRows] =
          await connection.execute(
            'SELECT GET_LOCK(?, 0) AS acquired',
            [lockName]
          );

        if (
          Number(
            lockRows[0]?.acquired
          ) !== 1
        ) {
          console.log(
            `[STOCK] ${plan.nome}: outra instância já está fazendo reposição.`
          );

          continue;
        }

        /*
         * Confirma novamente o stock
         * depois de adquirir o lock.
         */
        const [stockRows] =
          await connection.execute(
            `SELECT COUNT(*) AS total
             FROM vouchers
             WHERE pacote_id = ?
               AND status = 'disponivel'
               AND mikrotik_sync_status = 'sincronizado'`,
            [plan.id]
          );

        const stockAtual =
          Number(
            stockRows[0]?.total || 0
          );

        if (stockAtual >= minimo) {
          console.log(
            `[STOCK] ${plan.nome}: stock já foi reposto por outro processo.`
          );

          continue;
        }

        const quantidadeReal =
          Math.max(
            alvo - stockAtual,
            0
          );

        /*
         * generateVoucherBatch aceita no
         * máximo 100 vouchers por chamada.
         */
        let restante =
          quantidadeReal;

        let created =
          0;

        let failed =
          0;

        while (restante > 0) {
          const lote =
            Math.min(
              restante,
              100
            );

          const generation =
            await generateVoucherBatch({
              pacoteId: plan.id,
              quantity: lote,
              prefix: 'VCH'
            });

          created +=
            Number(
              generation.created || 0
            );

          failed +=
            Number(
              generation.failed || 0
            );

          restante -=
            lote;

          /*
           * Se houve falha, interrompe.
           * O voucherSyncService tratará
           * os vouchers com erro.
           */
          if (
            Number(
              generation.failed || 0
            ) > 0
          ) {
            break;
          }
        }

        console.log(
          `[STOCK] ${plan.nome}: reposição concluída. Criados=${created}, falhas=${failed}.`
        );

        results.push({
          planId: plan.id,
          plan: plan.nome,
          action: 'refilled',
          before: stockAtual,
          target: alvo,
          requested: quantidadeReal,
          created,
          failed
        });

      } catch (error) {
        console.error(
          `[STOCK] Erro em ${plan.nome}:`,
          error.message
        );

        results.push({
          planId: plan.id,
          plan: plan.nome,
          action: 'error',
          message: error.message
        });

      } finally {
        try {
          await connection.execute(
            'SELECT RELEASE_LOCK(?)',
            [lockName]
          );
        } catch {
          // Ignora erro ao libertar lock.
        }

        connection.release();
      }
    }

    return {
      ok: true,
      plans: results
    };

  } finally {
    stockCheckRunning = false;
  }
}