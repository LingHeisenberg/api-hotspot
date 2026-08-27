import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function boolFromEnv(value, fallback) {
  if (value === undefined) return fallback;

  return ['1', 'true', 'yes', 'sim'].includes(
    String(value).toLowerCase()
  );
}

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável obrigatória não definida: ${name}`);
  }

  return value;
}

function listFromEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDatabaseConfig() {
  const rawUrl = isProduction
    ? required('DB_URL')
    : process.env.DB_URL || 'mysql://root@localhost:3306/eyazs_bd';

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DB_URL inválida.');
  }

  const database = decodeURIComponent(
    url.pathname.replace(/^\/+/, '')
  );

  if (!database) {
    throw new Error('DB_URL deve conter o nome da base de dados.');
  }

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),

    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    queueLimit: 0,
    decimalNumbers: true,

    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
}

export const env = {
  production: isProduction,

  port: Number(process.env.PORT || 8000),

  cors: {
    origins: listFromEnv(
      process.env.CORS_ORIGINS ||
        process.env.FRONTEND_URL ||
        process.env.FRONTEND_PUBLIC_URL ||
        process.env.PORTAL_PUBLIC_URL ||
        ''
    )
  },

  portal: {
    publicUrl: isProduction
      ? process.env.FRONTEND_PUBLIC_URL || required('PORTAL_PUBLIC_URL')
      : process.env.FRONTEND_PUBLIC_URL ||
        process.env.PORTAL_PUBLIC_URL ||
        'http://localhost:5173/'
  },

  db: getDatabaseConfig(),

  admin: {
    password: isProduction
      ? required('ADMIN_PASSWORD')
      : process.env.ADMIN_PASSWORD || 'admin',

    token: isProduction
      ? required('ADMIN_TOKEN')
      : process.env.ADMIN_TOKEN || 'dev-admin-token'
  },

  mikrotik: {
    loginUrl:
      process.env.MIKROTIK_LOGIN_URL ||
      'http://10.5.50.1/login',

    restUrl:
      process.env.MIKROTIK_REST_URL ||
      'http://10.5.50.1/rest/ip/hotspot/user',

    apiUser:
      process.env.MIKROTIK_API_USER ||
      process.env.MIKROTIK_USER ||
      'admin',

    apiPass:
      process.env.MIKROTIK_API_PASS ||
      process.env.MIKROTIK_PASS ||
      '',

    hotspotServer:
      process.env.MIKROTIK_HOTSPOT_SERVER || '',

    syncEnabled:
      boolFromEnv(
        process.env.MIKROTIK_SYNC_ENABLED,
        true
      ),

    requireHotspotContext:
      boolFromEnv(
        process.env.MIKROTIK_REQUIRE_HOTSPOT_CONTEXT,
        true
      ),

    timeoutMs:
      Number(process.env.MIKROTIK_TIMEOUT_MS || 15000)
  },

  payment: {
    mode:
      process.env.PAYMENT_MODE ||
      (isProduction ? 'live' : 'mock'),

    mockAutoApprove:
      boolFromEnv(
        process.env.PAYMENT_MOCK_AUTO_APPROVE,
        !isProduction
      ),

    mockDelayMs:
      Number(process.env.PAYMENT_MOCK_DELAY_MS || 5000),

    mpesa: {
      apiUrl:
        process.env.APIMPESA ||
        process.env.MPESA_API_URL ||
        '',

      timeoutMs:
        Number(process.env.MPESA_TIMEOUT_MS || 45000),

      msisdnPrefix:
        process.env.MPESA_MSISDN_PREFIX || '258',

      apiKey:
        process.env.MPESA_API_KEY || '',

      publicKey:
        process.env.MPESA_PUBLIC_KEY || '',

      serviceProviderCode:
        process.env.MPESA_SERVICE_PROVIDER_CODE || '',

      origin:
        process.env.MPESA_ORIGIN ||
        'developer.mpesa.vm.co.mz'
    },

    emola: {
      enabled:
        boolFromEnv(process.env.EMOLA_ENABLED, false),

      apiUrl:
        process.env.EMOLA_API_URL || '',

      timeoutMs:
        Number(process.env.EMOLA_TIMEOUT_MS || 45000),

      msisdnPrefix:
        process.env.EMOLA_MSISDN_PREFIX || '258',

      channelId:
        process.env.EMOLA_CHANNEL_ID || '',

      password:
        process.env.EMOLA_PASSWORD || '',

      serviceCode:
        process.env.EMOLA_SERVICE_CODE || ''
    }
  }
};
