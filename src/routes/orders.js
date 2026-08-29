import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { createReference, detectProvider, normalizePhone, sanitizeHotspotValue } from '../utils/validators.js';
import { EMOLA_UNAVAILABLE_MESSAGE, startWalletPayment } from '../services/paymentService.js';
import { activateHotspotClient, checkHotspotReadiness } from '../services/mikrotikService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  const pacoteId = Number(req.body.pacoteId || req.body.packageId);
  const telefone = normalizePhone(req.body.telefone || req.body.phone);
  const mac = sanitizeHotspotValue(req.body.mac);
  const ip = sanitizeHotspotValue(req.body.ip);
  const linkorig = sanitizeHotspotValue(req.body.linkorig || req.body.dst, 'https://www.google.com/');
  const loginUrl = sanitizeHotspotValue(req.body.loginUrl || req.body.linkLoginOnly || req.body.linklogin);
  const chapId = sanitizeHotspotValue(req.body.chapId || req.body.chapid || req.body['chap-id']);
  const chapChallenge = sanitizeHotspotValue(
    req.body.chapChallenge || req.body.chapchallenge || req.body['chap-challenge']
  );
  const provider = detectProvider(telefone);
  const requireSyncedVoucher = env.mikrotik.syncEnabled;

  if (!pacoteId || !provider) {
    return res.status(422).json({
      message: 'Dados invalidos. Confirme o plano e use um numero 84, 85, 86 ou 87 com 9 digitos.'
    });
  }

  if (provider === 'emola' && !env.payment.emola.enabled) {
    return res.status(422).json({
      message: EMOLA_UNAVAILABLE_MESSAGE
    });
  }

  if (env.payment.mode === 'live' && env.mikrotik.requireHotspotContext && !ip && !mac) {
    return res.status(422).json({
      message:
        'Abra esta pagina a partir do Wi-Fi Hotspot antes de pagar. Sem IP/MAC do MikroTik o acesso nao pode ser libertado automaticamente.'
    });
  }

  if (env.payment.mode === 'live' && env.mikrotik.syncEnabled && env.mikrotik.blockPaymentIfOffline) {
    const readiness = await checkHotspotReadiness();

    if (!readiness.ok) {
      return res.status(503).json({
        message: readiness.message,
        reason: 'hotspot_not_ready'
      });
    }
  }

  const connection = await pool.getConnection();
  let voucherId;
  let reference;

  try {
    await connection.beginTransaction();

    const [packages] = await connection.execute(
      'SELECT id, nome, preco FROM pacotes WHERE id = ? AND ativo = 1 LIMIT 1',
      [pacoteId]
    );

    if (packages.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pacote nao encontrado.' });
    }

    const pacote = packages[0];
    const [vouchers] = await connection.execute(
      `SELECT id, codigo_voucher
       FROM vouchers
       WHERE pacote_id = ?
         AND status = 'disponivel'
         ${requireSyncedVoucher ? 'AND mikrotik_synced_at IS NOT NULL' : ''}
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`,
      [pacoteId]
    );

    if (vouchers.length === 0) {
      await connection.rollback();
      return res.status(409).json({
        message: requireSyncedVoucher
          ? 'Nao ha vouchers sincronizados com o MikroTik para este pacote. Gere vouchers no painel admin.'
          : 'Nao ha vouchers disponiveis para este pacote.'
      });
    }

    voucherId = vouchers[0].id;
    reference = createReference();

    await connection.execute(
      `UPDATE vouchers
       SET status = 'pendente',
           telefone_cliente = ?,
           transacao_id = ?,
           mac_cliente = ?,
           ip_cliente = ?,
           link_origem = ?,
           payment_provider = ?,
           status_mensagem = ?,
           reservado_em = NOW()
       WHERE id = ?`,
      [telefone, reference, mac || null, ip || null, linkorig, provider, 'Aguardando confirmação do pagamento.', voucherId]
    );

    await connection.commit();

    const payment = await startWalletPayment({
      amount: pacote.preco,
      phone: telefone,
      reference
    });

    if (!payment.accepted) {
      await recordPaymentEvent(payment.provider, reference, 'rejected', payment);
      await restoreVoucher(voucherId);
      return res.status(payment.reason === 'insufficient_funds' ? 402 : 502).json({
        message: payment.message,
        reason: payment.reason || 'payment_rejected'
      });
    }

    await recordPaymentEvent(payment.provider, reference, payment.paymentStatus || 'accepted', payment);

    if (payment.paymentStatus === 'paid') {
      await pool.execute(
        `UPDATE vouchers
         SET status = 'pago',
             status_mensagem = ?,
             pago_em = NOW()
         WHERE transacao_id = ? AND status = 'pendente'`,
        [payment.message || 'Pagamento confirmado.', reference]
      );
    }

    if (env.payment.mode === 'mock' && env.payment.mockAutoApprove) {
      scheduleMockApproval(reference);
    }

    return res.status(201).json({
      reference,
      provider: payment.provider,
      status: payment.paymentStatus === 'paid' ? 'pago' : 'pendente',
      waitingUrl: createWaitingUrl({ reference, ip, mac, linkorig, loginUrl, chapId, chapChallenge })
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Transaction may already be closed.
    }

    if (voucherId) {
      await restoreVoucher(voucherId);
    }

    next(error);
  } finally {
    connection.release();
  }
});

router.get('/:reference/status', async (req, res, next) => {
  try {
    const reference = sanitizeHotspotValue(req.params.reference);
    const [rows] = await pool.execute(
      `SELECT
         id,
         status,
         codigo_voucher,
         senha_voucher,
         status_mensagem,
         ip_cliente,
         mac_cliente,
         mikrotik_login_at,
         mikrotik_login_message
       FROM vouchers
       WHERE transacao_id = ?
       LIMIT 1`,
      [reference]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'nao_encontrado', message: 'Transacao invalida.' });
    }

    const voucher = rows[0];
    let activation = null;

    if (
      env.mikrotik.autoLoginViaRest &&
      (voucher.status === 'pago' || voucher.status === 'usado') &&
      !voucher.mikrotik_login_at
    ) {
      activation = await activateHotspotClient({
        username: voucher.codigo_voucher,
        password: voucher.senha_voucher,
        ip: voucher.ip_cliente,
        mac: voucher.mac_cliente
      });

      await pool.execute(
        `UPDATE vouchers
         SET mikrotik_login_at = IF(?, NOW(), mikrotik_login_at),
             mikrotik_login_message = ?
         WHERE id = ?`,
        [activation.ok ? 1 : 0, String(activation.message || 'Falha ao autenticar no Hotspot.').slice(0, 255), voucher.id]
      );
    }

    if (voucher.status === 'pago' || voucher.status === 'usado') {
      const activated = Boolean(activation?.ok || voucher.mikrotik_login_at);
      const hasHotspotClient = Boolean(voucher.ip_cliente || voucher.mac_cliente);
      const browserLoginMessage = hasHotspotClient
        ? 'A enviar o voucher para o login do Hotspot.'
        : 'Compra feita sem IP/MAC do Hotspot.';

      if (voucher.status === 'pago' && activated) {
        await pool.execute(
          `UPDATE vouchers
           SET status = 'usado', usado_em = NOW()
           WHERE id = ? AND status = 'pago'`,
          [voucher.id]
        );
      }

      return res.json({
        status: 'pago',
        voucher: voucher.codigo_voucher,
        senha: voucher.senha_voucher,
        mikrotikLoginUrl: env.mikrotik.loginUrl,
        access: {
          activated,
          autoLoginAvailable: hasHotspotClient,
          message:
            activation?.message ||
            voucher.mikrotik_login_message ||
            browserLoginMessage
        }
      });
    }

    if (voucher.status === 'cancelado') {
      return res.json({
        status: 'cancelado',
        message: voucher.status_mensagem || 'O pagamento foi recusado ou cancelado pela operadora.'
      });
    }

    return res.json({ status: voucher.status });
  } catch (error) {
    next(error);
  }
});

function createWaitingUrl({ reference, ip, mac, linkorig, loginUrl, chapId, chapChallenge }) {
  const params = new URLSearchParams({
    ref: reference,
    ip,
    mac,
    linkorig
  });

  if (loginUrl) params.set('loginUrl', loginUrl);
  if (chapId) params.set('chapId', chapId);
  if (chapChallenge) params.set('chapChallenge', chapChallenge);

  return `/aguardando?${params.toString()}`;
}

async function restoreVoucher(voucherId) {
  await pool.execute(
    `UPDATE vouchers
     SET status = 'disponivel',
         telefone_cliente = NULL,
         transacao_id = NULL,
         mac_cliente = NULL,
         ip_cliente = NULL,
         link_origem = NULL,
         payment_provider = NULL,
         status_mensagem = NULL,
         reservado_em = NULL
     WHERE id = ? AND status = 'pendente'`,
    [voucherId]
  );
}

async function recordPaymentEvent(provider, reference, status, payload) {
  await pool.execute(
    `INSERT INTO payment_events (provider, reference, status, payload)
     VALUES (?, ?, ?, ?)`,
    [provider || null, reference || null, status || null, JSON.stringify(payload || {})]
  );
}

function scheduleMockApproval(reference) {
  setTimeout(async () => {
    try {
      await pool.execute(
        `UPDATE vouchers
         SET status = 'pago',
             status_mensagem = 'Pagamento confirmado em modo de teste.',
             pago_em = NOW()
         WHERE transacao_id = ? AND status = 'pendente'`,
        [reference]
      );
    } catch (error) {
      console.error('Mock payment approval failed:', error);
    }
  }, env.payment.mockDelayMs);
}

export default router;
