import { Router } from 'express';
import { pool } from '../config/db.js';
import { normalizeCallbackPayload } from '../services/paymentService.js';

const router = Router();

router.post('/:provider/callback', async (req, res, next) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    const callback = normalizeCallbackPayload(req.body, provider);

    await pool.execute(
      `INSERT INTO payment_events (provider, reference, status, payload)
       VALUES (?, ?, ?, ?)`,
      [provider, callback.reference || null, callback.status || null, JSON.stringify(callback.raw)]
    );

    if (!callback.reference) {
      return res.status(422).json({ status: 'erro', message: 'Referencia em falta.' });
    }

  if (callback.success) {
  const [result] = await pool.execute(
    `UPDATE vouchers v
     INNER JOIN pacotes p
       ON p.id = v.pacote_id
     SET
       v.status = 'pago',
       v.status_mensagem = ?,
       v.pago_em = NOW(),
       v.expira_em = DATE_ADD(
         NOW(),
         INTERVAL p.duracao_minutos MINUTE
       ),
       v.expirado_em = NULL
     WHERE v.transacao_id = ?
       AND v.status = 'pendente'`,
    [
      callback.message || 'Pagamento confirmado pela operadora.',
      callback.reference
    ]
  );

  return res.json({
    status:
      result.affectedRows > 0
        ? 'sucesso'
        : 'ignorado',
    message: 'Callback de pagamento recebido.'
  });
}
    if (callback.canceled) {
      await pool.execute(
        `UPDATE vouchers
         SET status = 'cancelado',
             status_mensagem = ?
         WHERE transacao_id = ? AND status = 'pendente'`,
        [callback.message || 'O pagamento foi recusado ou cancelado pela operadora.', callback.reference]
      );

      return res.json({ status: 'cancelado' });
    }

    return res.json({ status: 'pendente' });
  } catch (error) {
    next(error);
  }
});

export default router;
