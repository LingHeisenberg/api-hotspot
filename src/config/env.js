import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendRoot = path.resolve(
  __dirname,
  '..',
  '..'
);

/*
 * Carrega primeiro o .env da pasta backend.
 */
dotenv.config({
  path: path.join(
    backendRoot,
    '.env'
  )
});

dotenv.config();

const isProduction =
  process.env.NODE_ENV === 'production';


/*
 * Converte variáveis true/false.
 *
 * Aceita:
 * true
 * 1
 * yes
 * sim
 */
function boolFromEnv(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return [
    '1',
    'true',
    'yes',
    'sim'
  ].includes(
    String(value)
      .toLowerCase()
      .trim()
  );
}


/*
 * Variáveis obrigatórias em produção.
 */
function required(name) {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      `Variável obrigatória não definida: ${name}`
    );
  }

  return value;
}


/*
 * Converte:
 *
 * dominio1.com,dominio2.com
 *
 * em array.
 */
function listFromEnv(value) {
  return String(value || '')
    .split(',')
    .map(
      (item) => item.trim()
    )
    .filter(Boolean);
}


/*
 * Configuração MySQL.
 */
function getDatabaseConfig() {
  const rawUrl =
    isProduction
      ? required('DB_URL')
      : process.env.DB_URL ||
        'mysql://root@localhost:3306/eyazs_bd';

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'DB_URL inválida.'
    );
  }

  const database =
    decodeURIComponent(
      url.pathname.replace(
        /^\/+/,
        ''
      )
    );

  if (!database) {
    throw new Error(
      'DB_URL deve conter o nome da base de dados.'
    );
  }

  return {
    host:
      url.hostname,

    port:
      Number(
        url.port || 3306
      ),

    database,

    user:
      decodeURIComponent(
        url.username
      ),

    password:
      decodeURIComponent(
        url.password
      ),

    waitForConnections:
      true,

    connectionLimit:
      Number(
        process.env.DB_POOL_LIMIT ||
        10
      ),

    queueLimit:
      0,

    decimalNumbers:
      true,

    enableKeepAlive:
      true,

    keepAliveInitialDelay:
      0
  };
}


/*
 * Configuração central da aplicação.
 */
export const env = {

  /*
   * Ambiente
   */
  production:
    isProduction,


  /*
   * Porta da API.
   *
   * No Railway, process.env.PORT
   * será utilizado automaticamente.
   */
  port:
    Number(
      process.env.PORT ||
      8000
    ),


  /*
   * CORS
   */
  cors: {
    origins:
      listFromEnv(
        process.env.CORS_ORIGINS ||
        process.env.FRONTEND_URL ||
        process.env.FRONTEND_PUBLIC_URL ||
        process.env.PORTAL_PUBLIC_URL ||
        ''
      )
  },


  /*
   * Portal público.
   */
  portal: {
    publicUrl:
      isProduction
        ? (
            process.env.FRONTEND_PUBLIC_URL ||
            required(
              'PORTAL_PUBLIC_URL'
            )
          )
        : (
            process.env.FRONTEND_PUBLIC_URL ||
            process.env.PORTAL_PUBLIC_URL ||
            'http://localhost:5173/'
          )
  },


  /*
   * URL pública da API.
   */
  api: {
    publicUrl:
      process.env.API_PUBLIC_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      `http://localhost:${process.env.PORT || 8000}/`
  },

  freeTrial: {
    enabled:
      boolFromEnv(
        process.env.FREE_TRIAL_ENABLED,
        true
      ),

    minutes:
      Math.max(
        1,
        Number(
          process.env.FREE_TRIAL_MINUTES ||
          15
        )
      ),

    maxDays:
      Math.max(
        1,
        Number(
          process.env.FREE_TRIAL_MAX_DAYS ||
          5
        )
      ),

    profile:
      process.env.FREE_TRIAL_PROFILE ||
      process.env.MIKROTIK_FREE_TRIAL_PROFILE ||
      'default',

    prefix:
      process.env.FREE_TRIAL_PREFIX ||
      'FREE'
  },


  /*
   * MySQL
   */
  db:
    getDatabaseConfig(),


  /*
   * Administrador.
   */
  admin: {

    password:
      isProduction
        ? required(
            'ADMIN_PASSWORD'
          )
        : (
            process.env.ADMIN_PASSWORD ||
            'admin'
          ),

    token:
      isProduction
        ? required(
            'ADMIN_TOKEN'
          )
        : (
            process.env.ADMIN_TOKEN ||
            'dev-admin-token'
          )
  },


  /*
   * =====================================
   * SINCRONIZAÇÃO AUTOMÁTICA DE VOUCHERS
   * =====================================
   */
voucherSync: {
  enabled: boolFromEnv(
    process.env.VOUCHER_AUTO_SYNC_ENABLED,
    false
  ),

  intervalMs: Number(
    process.env.VOUCHER_SYNC_INTERVAL_MS || 60000
  )
},

voucherStock: {
  enabled: boolFromEnv(
    process.env.VOUCHER_AUTO_STOCK_ENABLED,
    false
  ),

  intervalMs: Number(
    process.env.VOUCHER_STOCK_INTERVAL_MS || 60000
  )
},

  mikrotik: {

    /*
     * Login acessível pelo cliente
     * dentro da rede Hotspot.
     */
    loginUrl:
      process.env
        .MIKROTIK_LOGIN_URL ||
      'http://10.5.50.1/login',


    /*
     * REST utilizada pelo backend.
     *
     * Em produção o Railway deverá
     * fornecer MIKROTIK_REST_URL.
     */
    restUrl:
      process.env
        .MIKROTIK_REST_URL ||
      'http://10.5.50.1/rest/ip/hotspot/user',


    /*
     * Utilizador REST.
     */
    apiUser:
      process.env
        .MIKROTIK_API_USER ||
      process.env
        .MIKROTIK_USER ||
      'admin',


    /*
     * Senha REST.
     */
    apiPass:
      process.env
        .MIKROTIK_API_PASS ||
      process.env
        .MIKROTIK_PASS ||
      '',


    /*
     * Pode ser:
     *
     * all
     *
     * ou:
     *
     * hotspot1
     */
    hotspotServer:
      process.env
        .MIKROTIK_HOTSPOT_SERVER ||
      '',


    /*
     * Ativa MySQL -> MikroTik.
     */
    syncEnabled:
      boolFromEnv(
        process.env
          .MIKROTIK_SYNC_ENABLED,
        true
      ),


    /*
     * Exige IP/MAC do cliente
     * quando compra no Hotspot.
     */
    requireHotspotContext:
      boolFromEnv(
        process.env
          .MIKROTIK_REQUIRE_HOTSPOT_CONTEXT,
        true
      ),


    /*
     * Se true, impede pagamento
     * quando a RB estiver inacessível.
     */
    blockPaymentIfOffline:
      boolFromEnv(
        process.env
          .MIKROTIK_BLOCK_PAYMENT_IF_OFFLINE,
        false
      ),


    /*
     * Login automático depois
     * do pagamento.
     *
     * Esta variável precisa estar TRUE
     * no Railway para libertar Internet
     * automaticamente.
     */
    autoLoginViaRest:
      boolFromEnv(
        process.env
          .MIKROTIK_AUTO_LOGIN_VIA_REST,
        false
      ),


    /*
     * Compatibilidade com vouchers
     * antigos do MySQL.
     *
     * Como agora usamos
     * mikrotik_sync_status,
     * em produção recomendo false.
     */
    allowExistingDbVouchers:
      boolFromEnv(
        process.env
          .MIKROTIK_ALLOW_EXISTING_DB_VOUCHERS,
        false
      ),


    /*
     * URLs adicionais para
     * Walled Garden.
     */
    walledGardenUrls:
      listFromEnv(
        process.env
          .MIKROTIK_WALLED_GARDEN_URLS
      ),


    /*
     * Permitir HTTP no Walled Garden.
     */
    walledGardenAllowHttp:
      boolFromEnv(
        process.env
          .MIKROTIK_WALLED_GARDEN_ALLOW_HTTP,
        true
      ),


    /*
     * Timeout das chamadas REST.
     *
     * 15000 ms = 15 segundos.
     */
    timeoutMs:
      Number(
        process.env
          .MIKROTIK_TIMEOUT_MS ||
        15000
      )
  },


  /*
   * =====================================
   * PAGAMENTOS
   * =====================================
   */
  payment: {

    /*
     * live ou mock.
     */
    mode:
      process.env
        .PAYMENT_MODE ||
      (
        isProduction
          ? 'live'
          : 'mock'
      ),


    /*
     * Aprovação automática
     * somente para ambiente mock.
     */
    mockAutoApprove:
      boolFromEnv(
        process.env
          .PAYMENT_MOCK_AUTO_APPROVE,
        !isProduction
      ),


    /*
     * Tempo para aprovação mock.
     */
    mockDelayMs:
      Number(
        process.env
          .PAYMENT_MOCK_DELAY_MS ||
        5000
      ),


    /*
     * =================================
     * M-PESA
     * =================================
     */
    mpesa: {

      apiUrl:
        process.env.APIMPESA ||
        process.env.MPESA_API_URL ||
        '',


      timeoutMs:
        Number(
          process.env
            .MPESA_TIMEOUT_MS ||
          45000
        ),


      msisdnFormat:
        process.env
          .MPESA_MSISDN_FORMAT ||
        'local',


      msisdnPrefix:
        process.env
          .MPESA_MSISDN_PREFIX ||
        '258',


      apiKey:
        process.env
          .MPESA_API_KEY ||
        '',


      publicKey:
        process.env
          .MPESA_PUBLIC_KEY ||
        '',


      serviceProviderCode:
        process.env
          .MPESA_SERVICE_PROVIDER_CODE ||
        '',


      origin:
        process.env
          .MPESA_ORIGIN ||
        'developer.mpesa.vm.co.mz'
    },


    /*
     * =================================
     * E-MOLA
     * =================================
     */
    emola: {

      enabled:
        boolFromEnv(
          process.env
            .EMOLA_ENABLED,
          false
        ),


      apiUrl:
        process.env
          .EMOLA_API_URL ||
        '',


      timeoutMs:
        Number(
          process.env
            .EMOLA_TIMEOUT_MS ||
          45000
        ),


      msisdnPrefix:
        process.env
          .EMOLA_MSISDN_PREFIX ||
        '258',


      channelId:
        process.env
          .EMOLA_CHANNEL_ID ||
        '',


      password:
        process.env
          .EMOLA_PASSWORD ||
        '',


      serviceCode:
        process.env
          .EMOLA_SERVICE_CODE ||
        ''
    }
  }
};
