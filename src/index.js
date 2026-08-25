import express from 'express';
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
const distPath = path.join(workspaceRoot, 'frontend', 'dist');
const mikrotikPath = path.join(workspaceRoot, 'mikrotik');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/public-config', (req, res) => {
  res.json({
    mikrotikLoginUrl: env.mikrotik.loginUrl,
    paymentMode: env.payment.mode
  });
});

app.use('/api/plans', plansRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);
app.use('/hotspot', express.static(mikrotikPath));

app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  res.sendFile(path.join(distPath, 'index.html'), (error) => {
    if (error) {
      res.status(404).send('Frontend ainda nao foi compilado. Rode npm run build ou use npm run dev.');
    }
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      message: 'JSON invalido no pedido.'
    });
  }

  res.status(error.status || 500).json({
    message: error.status ? error.message : 'Erro interno no servidor.'
  });
});

app.listen(env.port, () => {
  console.log(`API pronta em http://localhost:${env.port}`);
});
