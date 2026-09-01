import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { sanitizeHotspotValue } from '../utils/validators.js';
import {
  syncVoucherToMikrotik,
  upsertHotspotUserProfile
} from './mikrotikService.js';

const DEFAULT_LINK_ORIG = 'https://www.google.com/';

export async function getFreeTrialStatus(payload = {}) {
  const context = normalizeContext(payload);
  const trialDate = getTrialDate();

  if (!env.freeTrial.enabled) {
    return {
      enabled: false,
      canStart: false,
      message: 'Teste gratis indisponivel no momento.'
    };
  }

  if (!context.clientKey) {
    return {
      enabled: true,
      canStart: false,
      message: 'Abra esta pagina pelo Wi-Fi Hotspot para usar o teste gratis.'
    };
  }

  const connection = await pool.getConnection();

  try {
    await expireOldTrials(connection, context.clientKey);
    const eligibility = await readEligibility(connection, context.clientKey, trialDate);

    return {
      enabled: true,
      canStart:
        !eligibility.activeTrial &&
        !eligibility.usedToday &&
        eligibility.totalUsed < env.freeTrial.maxDays,
      usedToday: eligibility.usedToday,
      totalUsed: eligibility.totalUsed,
      maxDays: env.freeTrial.maxDays,
      remainingDays: Math.max(env.freeTrial.maxDays - eligibility.totalUsed, 0),
      activeTrial: eligibility.activeTrial
        ? toClientTrial(eligibility.activeTrial, context)
        : null,
      message: eligibilityMessage(eligibility)
    };
  } finally {
    connection.release();
  }
}

export async function startFreeTrial(payload = {}) {
  const context = normalizeContext(payload);
  const trialDate = getTrialDate();

  if (!env.freeTrial.enabled) {
    throw httpError(403, 'Teste gratis indisponivel no momento.', 'free_trial_disabled');
  }

  if (!context.clientKey) {
    throw httpError(
      422,
      'Abra esta pagina pelo Wi-Fi Hotspot para usar o teste gratis. Sem IP/MAC nao e possivel liberar o acesso.',
      'missing_hotspot_context'
    );
  }

  const connection = await pool.getConnection();
  const lockName = createLockName(context.clientKey);

  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 10) AS acquired',
      [lockName]
    );

    if (Number(lockRows[0]?.acquired) !== 1) {
      throw httpError(
        409,
        'Ja existe uma tentativa de teste gratis em processamento para este dispositivo.',
        'free_trial_locked'
      );
    }

    await expireOldTrials(connection, context.clientKey);
    const eligibility = await readEligibility(connection, context.clientKey, trialDate);

    if (eligibility.activeTrial) {
      return toClientTrial(eligibility.activeTrial, context);
    }

    if (eligibility.usedToday) {
      throw httpError(
        429,
        'O teste gratis de hoje ja foi usado neste dispositivo. Para continuar, escolha um pacote e pague por M-Pesa.',
        'free_trial_used_today'
      );
    }

    if (eligibility.totalUsed >= env.freeTrial.maxDays) {
      throw httpError(
        429,
        'O limite de testes gratis deste dispositivo foi atingido. Para continuar, escolha um pacote e pague por M-Pesa.',
        'free_trial_limit_reached'
      );
    }

    const profileResult = await ensureFreeTrialProfile();

    if (!profileResult.ok) {
      throw httpError(
        503,
        profileResult.message,
        'free_trial_profile_failed'
      );
    }

    const credentials = await createUniqueCredentials(connection);
    const limitUptime = `${env.freeTrial.minutes}m`;
    const sync = await syncVoucherToMikrotik({
      username: credentials.username,
      password: credentials.password,
      profile: env.freeTrial.profile,
      limitUptime,
      comment: `Teste gratis ${env.freeTrial.minutes} minutos`
    });

    if (!sync.ok) {
      throw httpError(
        503,
        sync.message || 'Falha ao criar teste gratis no MikroTik.',
        'free_trial_mikrotik_failed'
      );
    }

    const [result] = await connection.execute(
      `INSERT INTO free_trials (
         client_key,
         mac_cliente,
         ip_cliente,
         link_origem,
         codigo_voucher,
         senha_voucher,
         mikrotik_user_id,
         status,
         status_mensagem,
         trial_date,
         expires_at
       )
       VALUES (
         ?,
         ?,
         ?,
         ?,
         ?,
         ?,
         ?,
         'ativo',
         ?,
         ?,
         DATE_ADD(NOW(), INTERVAL ${safeMinutes()} MINUTE)
       )`,
      [
        context.clientKey,
        context.mac || null,
        context.ip || null,
        context.linkorig,
        credentials.username,
        credentials.password,
        sync.id || null,
        `Teste gratis ativo por ${env.freeTrial.minutes} minutos.`,
        trialDate
      ]
    );

    const [rows] = await connection.execute(
      `SELECT *,
              TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining_seconds
       FROM free_trials
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return toClientTrial(rows[0], context);
  } finally {
    try {
      await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch {
      // Ignore lock release errors.
    }

    connection.release();
  }
}

function normalizeContext(payload) {
  const mac = sanitizeHotspotValue(payload.mac);
  const ip = sanitizeHotspotValue(payload.ip);

  return {
    mac,
    ip,
    linkorig: sanitizeHotspotValue(
      payload.linkorig || payload.dst,
      DEFAULT_LINK_ORIG
    ),
    loginUrl: sanitizeHotspotValue(
      payload.loginUrl ||
      payload.linkLoginOnly ||
      payload.linklogin
    ),
    chapId: sanitizeHotspotValue(
      payload.chapId ||
      payload.chapid ||
      payload['chap-id']
    ),
    chapChallenge: sanitizeHotspotValue(
      payload.chapChallenge ||
      payload.chapchallenge ||
      payload['chap-challenge']
    ),
    clientKey: mac
      ? `mac:${mac.toLowerCase()}`
      : ip
        ? `ip:${ip}`
        : ''
  };
}

async function expireOldTrials(connection, clientKey) {
  await connection.execute(
    `UPDATE free_trials
     SET status = 'expirado',
         status_mensagem = 'Teste gratis expirado.'
     WHERE client_key = ?
       AND status = 'ativo'
       AND expires_at <= NOW()`,
    [clientKey]
  );
}

async function readEligibility(connection, clientKey, trialDate) {
  const [activeRows] = await connection.execute(
    `SELECT *,
            TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining_seconds
     FROM free_trials
     WHERE client_key = ?
       AND status = 'ativo'
       AND expires_at > NOW()
     ORDER BY expires_at DESC
     LIMIT 1`,
    [clientKey]
  );

  const [usageRows] = await connection.execute(
    `SELECT
       COUNT(*) AS total_used,
       SUM(trial_date = ?) AS used_today
     FROM free_trials
     WHERE client_key = ?
       AND status <> 'erro'`,
    [trialDate, clientKey]
  );

  return {
    activeTrial: activeRows[0] || null,
    totalUsed: Number(usageRows[0]?.total_used || 0),
    usedToday: Number(usageRows[0]?.used_today || 0) > 0
  };
}

async function ensureFreeTrialProfile() {
  const profile = String(env.freeTrial.profile || 'default').trim();

  if (!profile || profile === 'default') {
    return { ok: true };
  }

  return upsertHotspotUserProfile({
    name: profile,
    sessionTimeout: `${env.freeTrial.minutes}m`,
    sharedUsers: '1'
  });
}

async function createUniqueCredentials(connection) {
  const prefix = sanitizePrefix(env.freeTrial.prefix);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const username = `${prefix}${crypto.randomInt(100000, 999999)}`;
    const password = String(crypto.randomInt(1000, 9999));

    const [rows] = await connection.execute(
      `SELECT codigo_voucher
       FROM (
         SELECT codigo_voucher FROM vouchers WHERE codigo_voucher = ?
         UNION
         SELECT codigo_voucher FROM free_trials WHERE codigo_voucher = ?
       ) AS existing_codes
       LIMIT 1`,
      [username, username]
    );

    if (rows.length === 0) {
      return { username, password };
    }
  }

  throw httpError(
    500,
    'Nao foi possivel gerar um voucher unico para o teste gratis.',
    'free_trial_code_failed'
  );
}

function toClientTrial(row, context) {
  const remainingSeconds = Math.max(Number(row.remaining_seconds || 0), 0);

  return {
    status: 'ativo',
    voucher: row.codigo_voucher,
    senha: row.senha_voucher,
    expiresAt: row.expires_at,
    remainingSeconds,
    minutes: env.freeTrial.minutes,
    maxDays: env.freeTrial.maxDays,
    mikrotikLoginUrl: context.loginUrl || env.mikrotik.loginUrl,
    linkorig: context.linkorig || row.link_origem || DEFAULT_LINK_ORIG,
    access: {
      activated: false,
      autoLoginAvailable: Boolean(context.ip || context.mac),
      message: 'Teste gratis criado. A entrar no Hotspot.'
    }
  };
}

function eligibilityMessage(eligibility) {
  if (eligibility.activeTrial) {
    return 'Teste gratis ativo neste dispositivo.';
  }

  if (eligibility.usedToday) {
    return 'O teste gratis de hoje ja foi usado neste dispositivo.';
  }

  if (eligibility.totalUsed >= env.freeTrial.maxDays) {
    return 'O limite de testes gratis deste dispositivo foi atingido.';
  }

  return 'Teste gratis disponivel.';
}

function sanitizePrefix(value) {
  const prefix = String(value || 'FREE')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

  return prefix || 'FREE';
}

function createLockName(clientKey) {
  const digest = crypto
    .createHash('sha1')
    .update(clientKey)
    .digest('hex')
    .slice(0, 32);

  return `free_trial_${digest}`;
}

function safeMinutes() {
  return Math.max(1, Math.min(Number(env.freeTrial.minutes) || 15, 1440));
}

function getTrialDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: env.freeTrial.timeZone || 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function httpError(status, message, reason) {
  const error = new Error(message);
  error.status = status;
  error.reason = reason;
  return error;
}
