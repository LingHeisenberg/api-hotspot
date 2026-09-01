import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';

import plansRouter from './routes/plans.js';
import ordersRouter from './routes/orders.js';
import paymentsRouter from './routes/payments.js';
import adminRouter from './routes/admin.js';
import freeTrialsRouter from './routes/freeTrials.js';

import {
  syncPendingVouchers
} from './services/voucherSyncService.js';

import {
  refillVoucherStock
} from './services/voucherStockService.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(
  __dirname,
  '..',
  '..'
);

const distPath = path.join(
  workspaceRoot,
  'frontend',
  'dist'
);

const mikrotikPath = path.join(
  workspaceRoot,
  'mikrotik'
);


/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...(env.cors?.origins || [])
];

console.log(
  'Origens permitidas pelo CORS:',
  allowedOrigins
);

app.use(
  cors({
    origin(origin, callback) {

      /*
       * Requisições sem Origin:
       * curl, Postman, server-to-server etc.
       */
      if (!origin) {
        return callback(
          null,
          true
        );
      }

      /*
       * Frontend local durante desenvolvimento.
       */
      if (
        isLocalDevelopmentOrigin(
          origin
        )
      ) {
        return callback(
          null,
          true
        );
      }

      /*
       * Permite tudo caso CORS_ORIGINS
       * contenha "*".
       */
      if (
        allowedOrigins.includes('*')
      ) {
        return callback(
          null,
          true
        );
      }

      /*
       * Origem explicitamente permitida.
       */
      if (
        allowedOrigins.includes(
          origin
        )
      ) {
        return callback(
          null,
          true
        );
      }

      const error = new Error(
        `Origem nao permitida pelo CORS: ${origin}`
      );

      error.status = 403;

      return callback(
        error
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization'
    ]
  })
);


/*
|--------------------------------------------------------------------------
| BODY PARSER
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/*
|--------------------------------------------------------------------------
| ROTA PRINCIPAL
|--------------------------------------------------------------------------
*/

app.get(
  '/',
  (req, res) => {

    res.json({
      ok: true,
      name: 'Eyazs Hotspot API',
      health: '/api/health'
    });
  }
);


/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
  '/api/health',
  (req, res) => {

    res.json({
      ok: true,

      config: {
        paymentMode:
          env.payment.mode,

        mpesaMsisdnFormat:
          env.payment.mpesa.msisdnFormat,

        mikrotikSyncEnabled:
          env.mikrotik.syncEnabled,

        autoLoginViaRest:
          env.mikrotik.autoLoginViaRest,

        allowExistingDbVouchers:
          env.mikrotik.allowExistingDbVouchers,

        voucherAutoSync:
          env.voucherSync.enabled,

        voucherSyncIntervalMs:
          env.voucherSync.intervalMs,

        freeTrialEnabled:
          env.freeTrial.enabled,

        freeTrialMinutes:
          env.freeTrial.minutes,

        freeTrialMaxDays:
          env.freeTrial.maxDays
      }
    });
  }
);


/*
|--------------------------------------------------------------------------
| CONFIGURAÇÕES PÚBLICAS
|--------------------------------------------------------------------------
*/

app.get(
  '/api/public-config',
  (req, res) => {

    res.json({
      mikrotikLoginUrl:
        env.mikrotik.loginUrl,

      paymentMode:
        env.payment.mode,

      freeTrial: {
        enabled:
          env.freeTrial.enabled,

        minutes:
          env.freeTrial.minutes,

        maxDays:
          env.freeTrial.maxDays
      }
    });
  }
);


/*
|--------------------------------------------------------------------------
| ROTAS DA API
|--------------------------------------------------------------------------
*/

app.use(
  '/api/plans',
  plansRouter
);

app.use(
  '/api/orders',
  ordersRouter
);

app.use(
  '/api/payments',
  paymentsRouter
);

app.use(
  '/api/free-trials',
  freeTrialsRouter
);

app.use(
  '/api/admin',
  adminRouter
);


/*
|--------------------------------------------------------------------------
| ARQUIVOS DO HOTSPOT
|--------------------------------------------------------------------------
*/

app.get(
  '/hotspot/login.html',
  async (
    req,
    res,
    next
  ) => {

    try {

      const template =
        await fs.readFile(
          path.join(
            mikrotikPath,
            'login.html'
          ),
          'utf8'
        );

      const html =
        template.replaceAll(
          '__PORTAL_PUBLIC_URL__',
          env.portal.publicUrl
        );

      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );

      res
        .type('html')
        .send(html);

    } catch (error) {
      next(error);
    }
  }
);


app.use(
  '/hotspot',
  express.static(
    mikrotikPath
  )
);


/*
|--------------------------------------------------------------------------
| FRONTEND COMPILADO
|--------------------------------------------------------------------------
*/

app.use(
  express.static(
    distPath
  )
);


/*
|--------------------------------------------------------------------------
| FALLBACK FRONTEND
|--------------------------------------------------------------------------
*/

app.get(
  '*',
  (req, res, next) => {

    /*
     * Não interceptar rotas /api.
     */
    if (
      req.path.startsWith(
        '/api'
      )
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        distPath,
        'index.html'
      ),

      (error) => {

        if (error) {

          res
            .status(404)
            .send(
              'Frontend ainda nao foi compilado. Rode npm run build ou use npm run dev.'
            );
        }
      }
    );
  }
);


/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      'Erro:',
      error
    );

    /*
     * JSON inválido.
     */
    if (
      error.type ===
      'entity.parse.failed'
    ) {

      return res
        .status(400)
        .json({
          message:
            'JSON invalido no pedido.'
        });
    }

    /*
     * Outros erros.
     */
    return res
      .status(
        error.status ||
        500
      )
      .json({
        message:
          error.status
            ? error.message
            : 'Erro interno no servidor.'
      });
  }
);


/*
|--------------------------------------------------------------------------
| SINCRONIZAÇÃO AUTOMÁTICA DE VOUCHERS
|--------------------------------------------------------------------------
*/

function startVoucherAutoSync() {

  /*
   * Localmente normalmente ficará false.
   */
  if (
    !env.voucherSync.enabled
  ) {

    console.log(
      '[VOUCHER-SYNC] Sincronização automática desativada.'
    );

    return;
  }


  /*
   * Não adianta tentar sincronizar
   * se a integração MikroTik estiver desligada.
   */
  if (
    !env.mikrotik.syncEnabled
  ) {

    console.log(
      '[VOUCHER-SYNC] Não iniciado porque MIKROTIK_SYNC_ENABLED=false.'
    );

    return;
  }


  /*
   * Evita intervalo inválido.
   *
   * Mínimo de 10 segundos.
   */
  const intervalMs =
    Math.max(
      Number(
        env.voucherSync.intervalMs
      ) || 60000,
      10000
    );


  console.log(
    `[VOUCHER-SYNC] Automático ativo. Intervalo: ${intervalMs}ms.`
  );


  /*
   * Função executada a cada ciclo.
   */
  const runSync =
    async () => {

      try {

        const result =
          await syncPendingVouchers();

        /*
         * Só mostra resumo quando
         * encontrou alguma coisa.
         */
        if (
          result &&
          Number(result.found) > 0
        ) {

          console.log(
            `[VOUCHER-SYNC] Resultado: encontrados=${result.found}, sincronizados=${result.synced}, falhas=${result.failed}.`
          );
        }

      } catch (error) {

        console.error(
          '[VOUCHER-SYNC] Erro no ciclo automático:',
          error.message
        );
      }
    };


  /*
   * Executa uma vez imediatamente
   * quando o backend inicia.
   */
  runSync();


  /*
   * Depois continua automaticamente.
   */
  setInterval(
    runSync,
    intervalMs
  );
}

function startVoucherAutoStock() {
  if (!env.voucherStock?.enabled) {
    console.log('[STOCK] Reposição automática desativada.');
    return;
  }

  if (!env.mikrotik.syncEnabled) {
    console.log(
      '[STOCK] Não iniciado porque MIKROTIK_SYNC_ENABLED=false.'
    );
    return;
  }

  const intervalMs = Math.max(
    Number(env.voucherStock.intervalMs) || 60000,
    30000
  );

  console.log(
    `[STOCK] Reposição automática ativa. Intervalo: ${intervalMs}ms.`
  );

  const runStock = async () => {
    try {
      await refillVoucherStock();
    } catch (error) {
      console.error(
        '[STOCK] Erro no ciclo automático:',
        error.message
      );
    }
  };

  setTimeout(runStock, 15000);

  setInterval(runStock, intervalMs);
}


/*
|--------------------------------------------------------------------------
| SERVIDOR
|--------------------------------------------------------------------------
*/


app.listen(
  env.port,
  '0.0.0.0',
  () => {
    console.log(
      `API pronta na porta ${env.port}`
    );

    startVoucherAutoSync();
    startVoucherAutoStock();
  }
);


/*
|--------------------------------------------------------------------------
| AUXILIAR - ORIGENS LOCAIS
|--------------------------------------------------------------------------
*/

function isLocalDevelopmentOrigin(
  origin
) {

  if (
    env.production
  ) {
    return false;
  }

  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/i.test(
    origin
  );
}
