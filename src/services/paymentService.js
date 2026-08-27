import axios from 'axios';
import { env } from '../config/env.js';
import { detectProvider } from '../utils/validators.js';

export const EMOLA_UNAVAILABLE_MESSAGE = 'Pagamentos com e-Mola não estão disponíveis ainda. Só M-Pesa.';
export const INSUFFICIENT_FUNDS_MESSAGE =
  'Saldo insuficiente para concluir o pagamento. Recarregue a sua conta e tente novamente.';

export async function startWalletPayment({ amount, phone, reference }) {
  const provider = detectProvider(phone);

  if (!provider) {
    return {
      accepted: false,
      provider: null,
      message: 'Numero invalido para M-Pesa ou e-Mola.'
    };
  }

  if (provider === 'emola' && !env.payment.emola.enabled) {
    return {
      accepted: false,
      provider: 'emola',
      message: EMOLA_UNAVAILABLE_MESSAGE
    };
  }

  if (env.payment.mode === 'mock') {
    return {
      accepted: true,
      provider,
      message: `Pedido ${provider} simulado com sucesso.`,
      raw: {
        mode: 'mock',
        amount,
        phone,
        reference
      }
    };
  }

  if (provider === 'mpesa') {
    return startMpesaPayment({ amount, phone, reference });
  }

  return startEmolaPayment({ amount, phone, reference });
}

async function startMpesaPayment({ amount, phone, reference }) {
  if (!env.payment.mpesa.apiUrl) {
    return {
      accepted: false,
      provider: 'mpesa',
      message: 'Endpoint M-Pesa nao configurado. Defina APIMPESA em backend/.env.'
    };
  }

  const payload = {
    transaction_ref: reference,
    msisdn: withCountryPrefix(phone, env.payment.mpesa.msisdnPrefix),
    amount: Number(amount),
    thirdparty_ref: reference
  };

  try {
    const response = await axios.post(env.payment.mpesa.apiUrl, payload, {
      timeout: env.payment.mpesa.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      validateStatus: () => true
    });

    const data = response.data;
    const status = classifyPaymentResponse(data, response.status, 'M-Pesa');

    if (response.status < 200 || response.status >= 300 || status.kind === 'failed' || status.kind === 'insufficient_funds') {
      return {
        accepted: false,
        provider: 'mpesa',
        paymentStatus: status.kind,
        reason: status.kind,
        message: status.message || extractMessage(data) || `M-Pesa recusou o pedido. HTTP ${response.status}.`,
        raw: data,
        requestPayload: payload
      };
    }

    return {
      accepted: true,
      provider: 'mpesa',
      paymentStatus: status.kind,
      message: extractMessage(data) || status.message,
      raw: data,
      requestPayload: payload
    };
  } catch (error) {
    return {
      accepted: false,
      provider: 'mpesa',
      message:
        error.code === 'ECONNABORTED'
          ? 'Tempo limite ao contactar a API M-Pesa.'
          : 'Erro de comunicacao com a API M-Pesa.',
      raw: { error: error.message },
      requestPayload: payload
    };
  }
}

async function startEmolaPayment({ amount, phone, reference }) {
  if (!env.payment.emola.apiUrl) {
    return {
      accepted: false,
      provider: 'emola',
      message: 'Endpoint e-Mola nao configurado.'
    };
  }

  const payload = {
    transaction_ref: reference,
    msisdn: withCountryPrefix(phone, env.payment.emola.msisdnPrefix),
    amount: Number(amount),
    thirdparty_ref: reference,
    order_id: reference,
    comment: 'Compra de Internet Hotspot'
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.payment.emola.timeoutMs);

    const response = await fetch(env.payment.emola.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(env.payment.emola.channelId ? { 'X-Channel-ID': env.payment.emola.channelId } : {}),
        ...(env.payment.emola.password ? { 'X-Password': env.payment.emola.password } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await response.text();
    const data = parseJson(text);
    const status = classifyPaymentResponse(data, response.status, 'e-Mola');

    if (!response.ok || status.kind === 'failed' || status.kind === 'insufficient_funds') {
      return {
        accepted: false,
        provider: 'emola',
        paymentStatus: status.kind,
        reason: status.kind,
        message: status.message || extractMessage(data) || `e-Mola recusou o pedido. HTTP ${response.status}.`,
        raw: data || text,
        requestPayload: payload
      };
    }

    return {
      accepted: true,
      provider: 'emola',
      paymentStatus: status.kind,
      message: extractMessage(data) || status.message,
      raw: data || text,
      requestPayload: payload
    };
  } catch (error) {
    return {
      accepted: false,
      provider: 'emola',
      message: error.name === 'AbortError' ? 'Tempo limite ao contactar a API e-Mola.' : 'Erro de comunicacao com a API e-Mola.',
      raw: { error: error.message },
      requestPayload: payload
    };
  }
}

function withCountryPrefix(phone, prefix) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (digits.startsWith(prefix)) {
    return digits;
  }

  return `${prefix}${digits}`;
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classifyPaymentResponse(data, httpStatus, label) {
  const fields = flattenValues(data).map((value) => String(value).toUpperCase());
  const joined = fields.join(' ');

  const insufficientMarkers = [
    'INSUFFICIENT',
    'INSUFFICIENT_BALANCE',
    'NOT ENOUGH',
    'NO FUNDS',
    'LOW BALANCE',
    'SALDO INSUFICIENTE',
    'SEM SALDO',
    'FUNDOS INSUFICIENTES',
    'INS-6',
    'INS-2006'
  ];
  const paidMarkers = ['INS-0', 'SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED', 'CONFIRMED', 'APROVADO', 'PAGO'];
  const pendingMarkers = ['PENDING', 'PROCESSING', 'ACCEPTED', 'IN_PROGRESS', 'AGUARDANDO'];
  const failedMarkers = ['FAILED', 'ERROR', 'REJECTED', 'DECLINED', 'CANCELLED', 'CANCELED', 'TIMEOUT', 'INS-'];

  if (insufficientMarkers.some((marker) => joined.includes(marker))) {
    return { kind: 'insufficient_funds', message: INSUFFICIENT_FUNDS_MESSAGE };
  }

  const explicitStatus = extractExplicitStatus(data);

  if (explicitStatus === 'paid') {
    return { kind: 'paid', message: `Pagamento ${label} confirmado.` };
  }

  if (explicitStatus === 'failed') {
    return { kind: 'failed', message: extractMessage(data) || `Pagamento ${label} recusado.` };
  }

  if (paidMarkers.some((marker) => joined.includes(marker))) {
    return { kind: 'paid', message: `Pagamento ${label} confirmado.` };
  }

  if (pendingMarkers.some((marker) => joined.includes(marker))) {
    return { kind: 'pending', message: `Pedido ${label} aceite. Aguardando confirmacao.` };
  }

  if (failedMarkers.some((marker) => joined.includes(marker))) {
    return { kind: 'failed', message: `Pagamento ${label} recusado.` };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    return { kind: 'pending', message: `Pedido ${label} enviado. Aguardando confirmacao.` };
  }

  return {
    kind: 'failed',
    message: `${label} recusou o pedido.`
  };
}

function flattenValues(value) {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap(flattenValues);
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap(flattenValues);
  }

  return [value];
}

function extractExplicitStatus(value) {
  if (!value || typeof value !== 'object') return null;

  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue && typeof rawValue === 'object') {
      const nested = extractExplicitStatus(rawValue);
      if (nested) return nested;
    }

    const normalizedKey = String(key).toLowerCase();
    const normalizedValue = String(rawValue).toUpperCase();

    if (['success', 'ok', 'paid', 'completed'].includes(normalizedKey) && rawValue === true) {
      return 'paid';
    }

    if (['success', 'ok', 'paid', 'completed'].includes(normalizedKey) && rawValue === false) {
      return 'failed';
    }

    if (['status', 'state', 'paymentstatus', 'code', 'responsecode'].includes(normalizedKey)) {
      if (['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED', 'CONFIRMED', 'INS-0', '0', '00'].includes(normalizedValue)) {
        return 'paid';
      }

      if (['FAILED', 'ERROR', 'REJECTED', 'DECLINED', 'CANCELLED', 'CANCELED', 'TIMEOUT'].includes(normalizedValue)) {
        return 'failed';
      }
    }
  }

  return null;
}

function extractMessage(data) {
  if (!data || typeof data !== 'object') return '';

  const messageKeys = new Set([
    'message',
    'mensagem',
    'output_responsedesc',
    'responsedesc',
    'description',
    'error',
    'errormessage',
    'reason'
  ]);

  for (const [key, value] of Object.entries(data)) {
    if (messageKeys.has(String(key).toLowerCase()) && typeof value !== 'object') {
      return String(value);
    }

    if (value && typeof value === 'object') {
      const nested = extractMessage(value);
      if (nested) return nested;
    }
  }

  return '';
}

export function normalizeCallbackPayload(body, provider = 'M-Pesa') {
  const payload = body || {};
  const label = provider === 'emola' ? 'e-Mola' : 'M-Pesa';
  const classification = classifyPaymentResponse(payload, 200, label);
  const responseCode = payload.output_ResponseCode || payload.responseCode || payload.code;
  const rawStatus = payload.status || payload.paymentStatus || payload.state || responseCode || '';
  const status = String(rawStatus).toUpperCase();
  const reference =
    payload.reference ||
    payload.transaction_ref ||
    payload.thirdparty_ref ||
    payload.transactionReference ||
    payload.input_TransactionReference ||
    payload.thirdPartyReference ||
    payload.transacao_id ||
    payload.tx_id ||
    payload.order_id ||
    '';

  return {
    reference: String(reference),
    success: classification.kind === 'paid',
    canceled: classification.kind === 'failed' || classification.kind === 'insufficient_funds',
    reason: classification.kind,
    status: status || classification.kind,
    message: classification.message || extractMessage(payload),
    raw: payload
  };
}
