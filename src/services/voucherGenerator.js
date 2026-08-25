import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { createHotspotUser } from './mikrotikService.js';
import { durationToRouterTime } from '../utils/mikrotikTime.js';

const DEFAULT_PREFIX = 'VCH';

export async function generateVoucherBatch({ pacoteId, quantity, prefix = DEFAULT_PREFIX }) {
  const amount = Number(quantity);

  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    const error = new Error('Quantidade inválida. Gere entre 1 e 100 vouchers por vez.');
    error.status = 422;
    throw error;
  }

  const [plans] = await pool.execute(
    `SELECT id, nome, tempo, perfil_mikrotik
     FROM pacotes
     WHERE id = ? AND ativo = 1
     LIMIT 1`,
    [Number(pacoteId)]
  );

  if (plans.length === 0) {
    const error = new Error('Pacote não encontrado.');
    error.status = 404;
    throw error;
  }

  const plan = plans[0];
  const generated = [];
  const failed = [];

  for (let index = 0; index < amount; index += 1) {
    const credentials = await createUniqueCredentials(prefix);
    const sync = await createHotspotUser({
      username: credentials.username,
      password: credentials.password,
      profile: plan.perfil_mikrotik,
      limitUptime: durationToRouterTime(plan.tempo),
      comment: `Pre-gerado ${plan.nome}`
    });

    if (!sync.ok) {
      failed.push({
        username: credentials.username,
        message: sync.message
      });
      continue;
    }

    try {
      await pool.execute(
        `INSERT INTO vouchers (
           pacote_id,
           codigo_voucher,
           senha_voucher,
           status,
           mikrotik_user_id,
           mikrotik_synced_at,
           status_mensagem
         )
         VALUES (?, ?, ?, 'disponivel', ?, NOW(), ?)`,
        [
          plan.id,
          credentials.username,
          credentials.password,
          sync.id || null,
          'Voucher pré-gerado e sincronizado com MikroTik.'
        ]
      );

      generated.push({
        username: credentials.username,
        password: credentials.password,
        profile: plan.perfil_mikrotik,
        limitUptime: durationToRouterTime(plan.tempo),
        packageName: plan.nome
      });
    } catch (error) {
      failed.push({
        username: credentials.username,
        message: `Criado no MikroTik, mas falhou ao gravar no MySQL: ${error.message}`
      });
    }
  }

  return {
    requested: amount,
    created: generated.length,
    failed: failed.length,
    plan: {
      id: plan.id,
      name: plan.nome,
      profile: plan.perfil_mikrotik
    },
    vouchers: generated,
    failures: failed
  };
}

async function createUniqueCredentials(prefix) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = `${sanitizePrefix(prefix)}${crypto.randomInt(100000, 999999)}`;
    const password = String(crypto.randomInt(1000, 9999));
    const [rows] = await pool.execute('SELECT id FROM vouchers WHERE codigo_voucher = ? LIMIT 1', [username]);

    if (rows.length === 0) {
      return { username, password };
    }
  }

  const error = new Error('Não foi possível gerar código único de voucher.');
  error.status = 500;
  throw error;
}

function sanitizePrefix(prefix) {
  const value = String(prefix || DEFAULT_PREFIX)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

  return value || DEFAULT_PREFIX;
}
