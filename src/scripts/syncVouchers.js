import { pool } from '../config/db.js';

import {
  syncVoucherToMikrotik
} from '../services/mikrotikService.js';

import {
  durationToRouterTime
} from '../utils/mikrotikTime.js';


const args = parseArgs(
  process.argv.slice(2)
);

const params = [];

/*
 * Nunca sincronizamos vouchers cancelados.
 */
const filters = [
  "v.status <> 'cancelado'"
];

const validStatuses = new Set([
  'disponivel',
  'pendente',
  'pago',
  'usado',
  'cancelado'
]);


/*
 * Por segurança, --force deve ser usado
 * juntamente com algum filtro.
 */
if (
  args.force &&
  !args.status &&
  !args.code &&
  !args.reference
) {
  console.error(
    'Por segurança, use --force apenas com --status=disponivel, --code=... ou --reference=...'
  );

  process.exit(1);
}


/*
 * Normalmente sincronizamos apenas:
 *
 * pendente
 * erro
 *
 * Quem já está sincronizado não precisa
 * ser enviado novamente.
 */
if (!args.force) {
  filters.push(
    `v.mikrotik_sync_status IN ('pendente', 'erro')`
  );
}


/*
 * Filtro por status comercial.
 */
if (args.status) {

  if (!validStatuses.has(args.status)) {
    console.error(
      `Status inválido: ${args.status}`
    );

    process.exit(1);
  }

  filters.push(
    'v.status = ?'
  );

  params.push(
    args.status
  );
}


/*
 * Filtro por código do voucher.
 */
if (args.code) {

  filters.push(
    'v.codigo_voucher = ?'
  );

  params.push(
    args.code
  );
}


/*
 * Filtro pela referência da transação.
 */
if (args.reference) {

  filters.push(
    'v.transacao_id = ?'
  );

  params.push(
    args.reference
  );
}


/*
 * Limite máximo.
 */
const limit = Math.min(
  Math.max(
    Number(args.limit || 100),
    1
  ),
  500
);


/*
 * Procura vouchers que precisam
 * ser sincronizados.
 */
const [vouchers] =
  await pool.execute(
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
       ON v.pacote_id = p.id

     WHERE ${filters.join(' AND ')}

     ORDER BY v.id ASC

     LIMIT ${limit}`,
    params
  );


console.log(
  `Encontrados ${vouchers.length} voucher(es) para sincronizar.`
);


let synced = 0;
let failed = 0;


/*
 * Sincroniza um por um.
 */
for (const voucher of vouchers) {

  console.log(
    `Sincronizando ${voucher.codigo_voucher}...`
  );

  try {

    const sync =
      await syncVoucherToMikrotik({

        username:
          voucher.codigo_voucher,

        password:
          voucher.senha_voucher,

        profile:
          args.profile ||
          voucher.perfil_mikrotik ||
          'default',

        limitUptime:
          args.limitUptime ||
          durationToRouterTime(
            voucher.tempo
          ),

        comment:
          `Sincronizado pelo sistema - ${voucher.pacote_nome}`
      });


    /*
     * SUCESSO
     */
    if (sync.ok) {

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
               THEN 'Voucher sincronizado com MikroTik.'
               ELSE status_mensagem
             END

         WHERE id = ?`,
        [
          sync.id || null,
          voucher.id
        ]
      );


      console.log(
        `OK ${voucher.codigo_voucher}`
      );

      continue;
    }


    /*
     * FALHA retornada pelo serviço
     */
    failed += 1;

    const message =
      String(
        sync.message ||
        'Falha ao sincronizar com MikroTik.'
      ).slice(
        0,
        1000
      );


    await pool.execute(
      `UPDATE vouchers

       SET
         mikrotik_sync_status = 'erro',

         mikrotik_sync_erro = ?,

         mikrotik_error = ?,

         status_mensagem = ?

       WHERE id = ?`,
      [
        message,
        message.slice(0, 255),

        `Falha na sincronização com MikroTik: ${message}`.slice(
          0,
          255
        ),

        voucher.id
      ]
    );


    console.log(
      `FALHA ${voucher.codigo_voucher}: ${message}`
    );

  } catch (error) {

    /*
     * Erro inesperado.
     */
    failed += 1;

    const message =
      String(
        error.message ||
        'Erro inesperado ao sincronizar.'
      ).slice(
        0,
        1000
      );


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
      `ERRO ${voucher.codigo_voucher}: ${message}`
    );
  }
}


/*
 * Fecha ligação à base.
 */
await pool.end();


console.log('');
console.log('==============================');
console.log('SINCRONIZAÇÃO CONCLUÍDA');
console.log('==============================');

console.log(
  `Encontrados: ${vouchers.length}`
);

console.log(
  `Sincronizados: ${synced}`
);

console.log(
  `Falhas: ${failed}`
);


/*
 * Argumentos CLI.
 *
 * Exemplos:
 *
 * --status=disponivel
 * --code=VCH20001
 * --reference=ISP...
 * --limit=50
 * --force
 */
function parseArgs(values) {

  return values.reduce(
    (acc, item) => {

      const match =
        item.match(
          /^--([^=]+)=(.*)$/
        );

      if (match) {

        acc[
          match[1]
        ] = match[2];

        return acc;
      }


      if (
        item.startsWith('--')
      ) {
        acc[
          item.slice(2)
        ] = true;
      }


      return acc;

    },
    {}
  );
}