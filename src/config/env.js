import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config();

function boolFromEnv(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(String(value).toLowerCase());
}

export const env = {
  port: Number(process.env.PORT || 3000),
  portal: {
    publicUrl: process.env.PORTAL_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}/`
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'eyazs_bd',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    queueLimit: 0,
    decimalNumbers: true
  },
  admin: {
    password: process.env.ADMIN_PASSWORD || 'admin',
    token: process.env.ADMIN_TOKEN || 'dev-admin-token'
  },
  mikrotik: {
    loginUrl: process.env.MIKROTIK_LOGIN_URL || 'http://10.5.50.1/login',
    restUrl: process.env.MIKROTIK_REST_URL || 'http://10.5.50.1/rest/ip/hotspot/user',
    apiUser: process.env.MIKROTIK_API_USER || process.env.MIKROTIK_USER || 'admin',
    apiPass: process.env.MIKROTIK_API_PASS || process.env.MIKROTIK_PASS || '',
    hotspotServer: process.env.MIKROTIK_HOTSPOT_SERVER || '',
    syncEnabled: boolFromEnv(process.env.MIKROTIK_SYNC_ENABLED, true),
    requireHotspotContext: boolFromEnv(process.env.MIKROTIK_REQUIRE_HOTSPOT_CONTEXT, true),
    timeoutMs: Number(process.env.MIKROTIK_TIMEOUT_MS || 15000)
  },
  payment: {
    mode: process.env.PAYMENT_MODE || 'mock',
    mockAutoApprove: boolFromEnv(process.env.PAYMENT_MOCK_AUTO_APPROVE, true),
    mockDelayMs: Number(process.env.PAYMENT_MOCK_DELAY_MS || 5000),
    mpesa: {
      apiUrl: process.env.APIMPESA || process.env.MPESA_API_URL || '',
      timeoutMs: Number(process.env.MPESA_TIMEOUT_MS || 45000),
      msisdnPrefix: process.env.MPESA_MSISDN_PREFIX || '258',
      apiKey: process.env.MPESA_API_KEY || '',
      publicKey: process.env.MPESA_PUBLIC_KEY || '',
      serviceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE || '',
      origin: process.env.MPESA_ORIGIN || 'developer.mpesa.vm.co.mz'
    },
    emola: {
      enabled: boolFromEnv(process.env.EMOLA_ENABLED, false),
      apiUrl: process.env.EMOLA_API_URL || '',
      timeoutMs: Number(process.env.EMOLA_TIMEOUT_MS || 45000),
      msisdnPrefix: process.env.EMOLA_MSISDN_PREFIX || '258',
      channelId: process.env.EMOLA_CHANNEL_ID || '',
      password: process.env.EMOLA_PASSWORD || '',
      serviceCode: process.env.EMOLA_SERVICE_CODE || ''
    }
  }
};
