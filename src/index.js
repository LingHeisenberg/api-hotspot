import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';

import plansRouter from './routes/plans.js';
import ordersRouter from './routes/orders.js';
import paymentsRouter from './routes/payments.js';
import adminRouter from './routes/admin.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..', '..');

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
|
| Permite:
| - Frontend local Vite na porta 5173
| - Frontend local Vite na porta 5174
| - Domínios definidos em CORS_ORIGINS
|
*/

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...(env.cors?.origins || [])
];

console.log('Origens permitidas pelo CORS:', allowedOrigins);

app.use(
  cors({
    origin(origin, callback) {

      /*
       * Requisições sem Origin:
       * Postman, curl, chamadas server-to-server, etc.
       */
      if (!origin) {
        return callback(null, true);
      }

      if (isLocalDevelopmentOrigin(origin)) {
        return callback(null, true);
      }

      /*
       * Permite tudo caso tenha *
       */
      if (allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      /*
       * Verifica se a origem está autorizada
       */
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const error = new Error(
        `Origem nao permitida pelo CORS: ${origin}`
      );

      error.status = 403;

      return callback(error);
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

app.get('/', (req, res) => {

  res.json({
    ok: true,
    name: 'Eyazs Hotspot API',
    health: '/api/health'
  });

});


/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get('/api/health', (req, res) => {

  res.json({
    ok: true
  });

});


/*
|--------------------------------------------------------------------------
| CONFIGURAÇÕES PÚBLICAS
|--------------------------------------------------------------------------
*/

app.get('/api/public-config', (req, res) => {

  res.json({
    mikrotikLoginUrl: env.mikrotik.loginUrl,
    paymentMode: env.payment.mode
  });

});


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
  '/api/admin',
  adminRouter
);


/*
|--------------------------------------------------------------------------
| ARQUIVOS DO HOTSPOT
|--------------------------------------------------------------------------
*/

app.use(
  '/hotspot',
  express.static(mikrotikPath)
);


/*
|--------------------------------------------------------------------------
| FRONTEND COMPILADO
|--------------------------------------------------------------------------
*/

app.use(
  express.static(distPath)
);


/*
|--------------------------------------------------------------------------
| FALLBACK FRONTEND
|--------------------------------------------------------------------------
*/

app.get('*', (req, res, next) => {

  /*
   * Não intercepta rotas da API.
   */
  if (req.path.startsWith('/api')) {
    return next();
  }

  res.sendFile(
    path.join(distPath, 'index.html'),
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

});


/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {

  console.error('Erro:', error);

  /*
   * JSON inválido
   */
  if (error.type === 'entity.parse.failed') {

    return res.status(400).json({
      message: 'JSON invalido no pedido.'
    });

  }

  /*
   * Outros erros
   */
  return res
    .status(error.status || 500)
    .json({
      message:
        error.status
          ? error.message
          : 'Erro interno no servidor.'
    });

});


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

  }
);

function isLocalDevelopmentOrigin(origin) {
  if (env.production) return false;

  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/i.test(origin);
}
