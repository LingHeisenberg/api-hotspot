import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { generateVoucherBatch } from '../services/voucherGenerator.js';

const router = Router();

router.post('/login', (req, res) => {
  if (String(req.body.password || '') !== env.admin.password) {
    return res.status(401).json({ message: 'Senha incorreta.' });
  }

  res.json({ token: env.admin.token });
});

router.use((req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (token !== env.admin.token) {
    return res.status(401).json({ message: 'Acesso negado.' });
  }

  next();
});

router.get('/summary', async (req, res, next) => {
  try {
    const [financeRows] = await pool.execute(
      `SELECT COALESCE(SUM(p.preco), 0) AS total, COUNT(v.id) AS qtd
       FROM vouchers v
       JOIN pacotes p ON v.pacote_id = p.id
       WHERE v.status IN ('pago', 'usado')`
    );

    const [stockRows] = await pool.execute(
      `SELECT
         SUM(status = 'disponivel') AS disponiveis,
         SUM(status = 'pendente') AS pendentes,
         COUNT(*) AS total
       FROM vouchers`
    );

    const [history] = await pool.execute(
      `SELECT
         v.codigo_voucher,
         v.telefone_cliente,
         v.status,
         v.transacao_id,
         v.data_criacao,
         p.nome AS pacote_nome,
         p.preco
       FROM vouchers v
       JOIN pacotes p ON v.pacote_id = p.id
       ORDER BY v.data_criacao DESC
       LIMIT 50`
    );

    const totalVouchers = Number(stockRows[0]?.total || 0);
    const totalVendas = Number(financeRows[0]?.qtd || 0);

    res.json({
      metrics: {
        faturamento: Number(financeRows[0]?.total || 0),
        vendas: totalVendas,
        conversao: totalVouchers > 0 ? Number(((totalVendas / totalVouchers) * 100).toFixed(1)) : 0,
        disponiveis: Number(stockRows[0]?.disponiveis || 0),
        pendentes: Number(stockRows[0]?.pendentes || 0)
      },
      history
    });
  } catch (error) {
    next(error);
  }
});

router.post('/vouchers/generate', async (req, res, next) => {
  try {
    const result = await generateVoucherBatch({
      pacoteId: req.body.pacoteId,
      quantity: req.body.quantity,
      prefix: req.body.prefix
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/export.csv', async (req, res, next) => {
  try {
    const inicio = String(req.query.inicio || '').slice(0, 10) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const fim = String(req.query.fim || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT
         v.data_criacao,
         v.transacao_id,
         v.telefone_cliente,
         p.nome AS pacote_nome,
         p.preco,
         v.codigo_voucher,
         v.status
       FROM vouchers v
       JOIN pacotes p ON v.pacote_id = p.id
       WHERE v.status IN ('pago', 'usado')
         AND v.data_criacao BETWEEN ? AND ?
       ORDER BY v.data_criacao ASC`,
      [`${inicio} 00:00:00`, `${fim} 23:59:59`]
    );

    const lines = [
      ['Data e Hora', 'Referencia', 'Telefone', 'Pacote', 'Valor MT', 'Voucher', 'Estado'],
      ...rows.map((row) => [
        row.data_criacao,
        row.transacao_id,
        row.telefone_cliente,
        row.pacote_nome,
        row.preco,
        row.codigo_voucher,
        row.status
      ])
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_vendas_${inicio}_a_${fim}.csv"`);
    res.send(`\uFEFF${lines.map(toCsvLine).join('\n')}`);
  } catch (error) {
    next(error);
  }
});

function toCsvLine(values) {
  return values
    .map((value) => {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(',');
}

export default router;
