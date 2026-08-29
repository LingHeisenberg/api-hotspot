import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { syncVoucherToMikrotik } from './mikrotikService.js';
import { durationToRouterTime } from '../utils/mikrotikTime.js';

const DEFAULT_PREFIX = 'VCH';

export async function generateVoucherBatch({
  pacoteId,
  quantity,
  prefix = DEFAULT_PREFIX
}) {
  const amount = Number(quantity);

  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 100
  ) {
    const error = new Error(
      'Quantidade inválida. Gere entre 1 e 100 vouchers por vez.'
    );

    error.status = 422;
    throw error;
  }

  /*
   * Busca o pacote.
   */
  const [plans] = await pool.execute(
    `SELECT
       id,
       nome,
       tempo,
       perfil_mikrotik
     FROM pacotes
     WHERE id = ?
       AND ativo = 1
     LIMIT 1`,
    [Number(pacoteId)]
  );

  if (plans.length === 0) {
    const error = new Error(
      'Pacote não encontrado.'
    );

    error.status = 404;
    throw error;
  }

  const plan = plans[0];

  const generated = [];
  const failed = [];

  /*
   * Converte uma única vez.
   */
  const limitUptime =
    durationToRouterTime(plan.tempo);

  /*
   * Gera os vouchers.
   */
  for (
    let index = 0;
    index < amount;
    index += 1
  ) {
    let credentials;
    let voucherId = null;

    try {
      /*
       * 1. Gera username e password únicos.
       */
      credentials =
        await createUniqueCredentials(prefix);

      /*
       * 2. Primeiro grava no MySQL.
       *
       * Ainda não consideramos sincronizado.
       */
      const [insertResult] =
        await pool.execute(
          `INSERT INTO vouchers (
             pacote_id,
             codigo_voucher,
             senha_voucher,
             status,
             mikrotik_sync_status,
             mikrotik_sync_erro,
             mikrotik_sync_em,
             status_mensagem
           )
           VALUES (
             ?,
             ?,
             ?,
             'disponivel',
             'pendente',
             NULL,
             NULL,
             ?
           )`,
          [
            plan.id,
            credentials.username,
            credentials.password,
            'Voucher criado. Aguardando sincronização com MikroTik.'
          ]
        );

      voucherId = insertResult.insertId;

      console.log(
        `[VOUCHER] ${credentials.username} criado no MySQL.`
      );

      /*
       * 3. Agora sincroniza automaticamente
       * com o MikroTik.
       */
      const sync =
        await syncVoucherToMikrotik({
          username:
            credentials.username,

          password:
            credentials.password,

          profile:
            plan.perfil_mikrotik ||
            'default',

          limitUptime,

          comment:
            `Pre-gerado ${plan.nome}`
        });

      /*
       * 4. MikroTik respondeu com erro.
       *
       * O voucher continua no MySQL,
       * mas NÃO fica marcado como sincronizado.
       */
      if (!sync.ok) {
        const message =
          sync.message ||
          'Falha desconhecida ao sincronizar com MikroTik.';

        await pool.execute(
          `UPDATE vouchers
           SET
             mikrotik_sync_status = 'erro',
             mikrotik_sync_erro = ?,
             mikrotik_sync_em = NULL,
             status_mensagem = ?
           WHERE id = ?`,
          [
            message,
            `Voucher criado, mas ainda não sincronizado com MikroTik: ${message}`,
            voucherId
          ]
        );

        console.error(
          `[MIKROTIK] ${credentials.username} não sincronizado: ${message}`
        );

        failed.push({
          id: voucherId,
          username:
            credentials.username,
          password:
            credentials.password,
          message
        });

        continue;
      }

      /*
       * 5. MikroTik confirmou o voucher.
       *
       * Agora marcamos como sincronizado.
       */
      await pool.execute(
        `UPDATE vouchers
         SET
           mikrotik_user_id = ?,
           mikrotik_synced_at = NOW(),
           mikrotik_sync_status = 'sincronizado',
           mikrotik_sync_erro = NULL,
           mikrotik_sync_em = NOW(),
           status_mensagem = ?
         WHERE id = ?`,
        [
          sync.id || null,

          'Voucher pré-gerado e sincronizado com MikroTik.',

          voucherId
        ]
      );

      console.log(
        `[MIKROTIK] ${credentials.username} sincronizado com sucesso.`
      );

      /*
       * 6. Só entra na lista de sucesso
       * depois do MikroTik confirmar.
       */
      generated.push({
        id: voucherId,

        username:
          credentials.username,

        password:
          credentials.password,

        profile:
          plan.perfil_mikrotik ||
          'default',

        limitUptime,

        packageName:
          plan.nome,

        mikrotikSyncStatus:
          'sincronizado'
      });

    } catch (error) {
      console.error(
        '[VOUCHER] Erro na geração:',
        error
      );

      /*
       * Se já conseguimos inserir no MySQL
       * antes do erro, marca como erro.
       */
      if (voucherId) {
        try {
          await pool.execute(
            `UPDATE vouchers
             SET
               mikrotik_sync_status = 'erro',
               mikrotik_sync_erro = ?,
               status_mensagem = ?
             WHERE id = ?`,
            [
              error.message,

              `Falha durante processamento do voucher: ${error.message}`,

              voucherId
            ]
          );
        } catch (updateError) {
          console.error(
            '[VOUCHER] Também falhou ao atualizar status:',
            updateError.message
          );
        }
      }

      failed.push({
        id: voucherId,

        username:
          credentials?.username ||
          null,

        message:
          error.message
      });
    }
  }

  /*
   * Resultado final da geração.
   */
  return {
    requested:
      amount,

    created:
      generated.length,

    failed:
      failed.length,

    plan: {
      id:
        plan.id,

      name:
        plan.nome,

      profile:
        plan.perfil_mikrotik ||
        'default'
    },

    vouchers:
      generated,

    failures:
      failed
  };
}

/*
 * Gera credenciais únicas.
 */
async function createUniqueCredentials(
  prefix
) {
  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    const username =
      `${sanitizePrefix(prefix)}${crypto.randomInt(
        100000,
        999999
      )}`;

    const password =
      String(
        crypto.randomInt(
          1000,
          9999
        )
      );

    const [rows] =
      await pool.execute(
        `SELECT id
         FROM vouchers
         WHERE codigo_voucher = ?
         LIMIT 1`,
        [username]
      );

    if (rows.length === 0) {
      return {
        username,
        password
      };
    }
  }

  const error = new Error(
    'Não foi possível gerar código único de voucher.'
  );

  error.status = 500;

  throw error;
}

/*
 * Limpa o prefixo.
 */
function sanitizePrefix(prefix) {
  const value =
    String(
      prefix ||
      DEFAULT_PREFIX
    )
      .toUpperCase()
      .replace(
        /[^A-Z0-9]/g,
        ''
      )
      .slice(
        0,
        8
      );

  return value ||
    DEFAULT_PREFIX;
}