import axios from 'axios';
import { env } from '../config/env.js';
import { detectProvider } from '../utils/validators.js';

export const EMOLA_UNAVAILABLE_MESSAGE =
  'Pagamentos com e-Mola não estão disponíveis ainda. Só M-Pesa.';

export const INSUFFICIENT_FUNDS_MESSAGE =
  'Saldo insuficiente para concluir o pagamento. Recarregue a sua conta e tente novamente.';


/**
 * ============================================================
 * INICIAR PAGAMENTO
 * ============================================================
 */
export async function startWalletPayment({
  amount,
  phone,
  reference
}) {
  const provider = detectProvider(phone);

  if (!provider) {
    return {
      accepted: false,
      provider: null,
      message: 'Numero invalido para M-Pesa ou e-Mola.'
    };
  }

  if (
    provider === 'emola' &&
    !env.payment.emola.enabled
  ) {
    return {
      accepted: false,
      provider: 'emola',
      message: EMOLA_UNAVAILABLE_MESSAGE
    };
  }

  /**
   * Ambiente MOCK
   */
  if (env.payment.mode === 'mock') {
    return {
      accepted: true,
      provider,
      paymentStatus: 'pending',

      message:
        `Pedido ${provider} simulado com sucesso.`,

      raw: {
        mode: 'mock',
        amount,
        phone,
        reference
      }
    };
  }

  /**
   * M-PESA
   */
  if (provider === 'mpesa') {
    return startMpesaPayment({
      amount,
      phone,
      reference
    });
  }

  /**
   * E-MOLA
   */
  return startEmolaPayment({
    amount,
    phone,
    reference
  });
}


/**
 * ============================================================
 * M-PESA
 * ============================================================
 */

async function startMpesaPayment({
  amount,
  phone,
  reference
}) {
  /**
   * Verificar endpoint
   */
  if (!env.payment.mpesa.apiUrl) {
    return {
      accepted: false,
      provider: 'mpesa',

      message:
        'Endpoint M-Pesa nao configurado. Defina APIMPESA em backend/.env.'
    };
  }

  /**
   * Validar valor
   */
  const paymentAmount =
    Number(amount);

  if (
    !Number.isFinite(paymentAmount) ||
    paymentAmount <= 0
  ) {
    return {
      accepted: false,
      provider: 'mpesa',
      message: 'Valor de pagamento invalido.'
    };
  }

  /**
   * Formatar telefone.
   *
   * 851904232
   * =>
   * 258851904232
   */
  const msisdn =
    formatMpesaNumber(phone);

  if (!msisdn) {
    return {
      accepted: false,
      provider: 'mpesa',
      message: 'Numero M-Pesa invalido.'
    };
  }

  /**
   * IMPORTANTE:
   *
   * Este payload segue o mesmo padrão
   * da tua aplicação que já funciona.
   */
  const payload = {
    transaction_ref: 'EyazsImperium',

    msisdn,

    amount: paymentAmount,

    thirdparty_ref:
      String(reference)
  };

  /**
   * LOG DO PEDIDO
   */
  console.log('');
  console.log(
    '=============================================='
  );
  console.log(
    '           PEDIDO PAGAMENTO M-PESA'
  );
  console.log(
    '=============================================='
  );

  console.log(
    'URL:',
    env.payment.mpesa.apiUrl
  );

  console.log(
    'Transaction Reference:',
    payload.transaction_ref
  );

  console.log(
    'MSISDN:',
    payload.msisdn
  );

  console.log(
    'Amount:',
    payload.amount
  );

  console.log(
    'ThirdParty Reference:',
    payload.thirdparty_ref
  );

  console.log(
    'Payload:',
    JSON.stringify(
      payload,
      null,
      2
    )
  );

  console.log(
    '=============================================='
  );

  try {

    /**
     * CHAMADA À API
     */
    const response =
      await axios.post(
        env.payment.mpesa.apiUrl,

        payload,

        {
          timeout:
            Number(
              env.payment.mpesa.timeoutMs
            ) || 30000,

          headers: {
            'Content-Type':
              'application/json',

            Accept:
              'application/json'
          },

          /**
           * Não fazer axios lançar erro
           * automaticamente em HTTP 400/500.
           *
           * Assim conseguimos ver a resposta
           * verdadeira da API.
           */
          validateStatus:
            () => true
        }
      );


    /**
     * ========================================================
     * RESPOSTA DA API M-PESA
     * ========================================================
     */

    console.log('');
    console.log(
      '=============================================='
    );

    console.log(
      '              RESPOSTA M-PESA'
    );

    console.log(
      '=============================================='
    );

    console.log(
      'HTTP:',
      response.status
    );

    console.log(
      'DATA:',
      JSON.stringify(
        response.data,
        null,
        2
      )
    );

    console.log(
      '=============================================='
    );


    const data =
      response.data;

    const status =
      classifyPaymentResponse(
        data,
        response.status,
        'M-Pesa'
      );

    const apiMessage =
      extractMessage(data);


    /**
     * ========================================================
     * HTTP ERRO
     * ========================================================
     */

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      console.error(
        'M-Pesa devolveu HTTP:',
        response.status
      );

      return {
        accepted: false,

        provider:
          'mpesa',

        paymentStatus:
          status.kind,

        reason:
          status.kind,

        message:
          apiMessage ||
          status.message ||
          `M-Pesa recusou o pedido. HTTP ${response.status}.`,

        httpStatus:
          response.status,

        raw:
          data,

        requestPayload:
          payload
      };
    }


    /**
     * ========================================================
     * SALDO INSUFICIENTE
     * ========================================================
     */

    if (
      status.kind ===
      'insufficient_funds'
    ) {
      return {
        accepted: false,

        provider:
          'mpesa',

        paymentStatus:
          'insufficient_funds',

        reason:
          'insufficient_funds',

        message:
          INSUFFICIENT_FUNDS_MESSAGE,

        httpStatus:
          response.status,

        raw:
          data,

        requestPayload:
          payload
      };
    }


    /**
     * ========================================================
     * PAGAMENTO RECUSADO
     * ========================================================
     */

    if (
      status.kind ===
      'failed'
    ) {
      return {
        accepted: false,

        provider:
          'mpesa',

        paymentStatus:
          'failed',

        reason:
          'failed',

        message:
          apiMessage ||
          status.message ||
          'Pagamento M-Pesa recusado.',

        httpStatus:
          response.status,

        raw:
          data,

        requestPayload:
          payload
      };
    }


    /**
     * ========================================================
     * PEDIDO ACEITE
     * ========================================================
     *
     * Neste momento o M-Pesa deverá
     * enviar a solicitação para o telefone.
     */

    return {
      accepted: true,

      provider:
        'mpesa',

      paymentStatus:
        status.kind,

      message:
        apiMessage ||
        status.message ||
        'Pedido M-Pesa enviado. Confirme o pagamento no telefone.',

      httpStatus:
        response.status,

      raw:
        data,

      requestPayload:
        payload
    };

  } catch (error) {

    /**
     * ========================================================
     * ERRO DE COMUNICAÇÃO
     * ========================================================
     */

    console.error('');
    console.error(
      '=============================================='
    );

    console.error(
      '                 ERRO M-PESA'
    );

    console.error(
      '=============================================='
    );

    console.error(
      'Mensagem:',
      error.message
    );

    console.error(
      'Codigo:',
      error.code
    );

    console.error(
      'HTTP:',
      error.response?.status
    );

    console.error(
      'Resposta:',
      JSON.stringify(
        error.response?.data,
        null,
        2
      )
    );

    console.error(
      '=============================================='
    );


    /**
     * TIMEOUT
     */
    if (
      error.code ===
        'ECONNABORTED' ||
      error.code ===
        'ETIMEDOUT'
    ) {
      return {
        accepted: false,

        provider:
          'mpesa',

        paymentStatus:
          'failed',

        reason:
          'timeout',

        message:
          'Tempo limite ao contactar a API M-Pesa.',

        raw: {
          error:
            error.message,

          code:
            error.code
        },

        requestPayload:
          payload
      };
    }


    /**
     * OUTRO ERRO
     */
    return {
      accepted: false,

      provider:
        'mpesa',

      paymentStatus:
        'failed',

      reason:
        'communication_error',

      message:
        'Erro de comunicacao com a API M-Pesa.',

      raw: {
        error:
          error.message,

        code:
          error.code,

        httpStatus:
          error.response?.status,

        response:
          error.response?.data
      },

      requestPayload:
        payload
    };
  }
}


/**
 * ============================================================
 * FORMATAR NÚMERO M-PESA
 * ============================================================
 */

function formatMpesaNumber(phone) {

  let digits =
    String(phone || '')
      .replace(/\D/g, '');


  /**
   * Exemplo:
   *
   * 00258851904232
   */
  if (
    digits.startsWith('00258')
  ) {
    digits =
      digits.substring(2);
  }

  const local =
    digits.length === 9
      ? digits
      : digits.length > 9
        ? digits.slice(-9)
        : '';

  if (!/^(84|85)\d{7}$/.test(local)) {
    return null;
  }

  const format =
    String(
      env.payment.mpesa.msisdnFormat ||
      'local'
    )
      .toLowerCase()
      .trim();

  if (
    [
      'international',
      'internacional',
      'country',
      'prefix',
      'e164'
    ].includes(format)
  ) {
    return `${env.payment.mpesa.msisdnPrefix || '258'}${local}`;
  }

  return local;


  /**
   * Já possui 258
   *
   * 258851904232
   */
  /**
   * Número local
   *
   * 851904232
   */
  /**
   * Caso venha com alguma
   * informação adicional,
   * usamos os últimos 9 números.
   */
}


/**
 * ============================================================
 * E-MOLA
 * ============================================================
 */

async function startEmolaPayment({
  amount,
  phone,
  reference
}) {

  if (
    !env.payment.emola.apiUrl
  ) {
    return {
      accepted: false,

      provider:
        'emola',

      message:
        'Endpoint e-Mola nao configurado.'
    };
  }


  const payload = {

    transaction_ref:
      reference,

    msisdn:
      withCountryPrefix(
        phone,
        env.payment.emola.msisdnPrefix ||
          '258'
      ),

    amount:
      Number(amount),

    thirdparty_ref:
      reference,

    order_id:
      reference,

    comment:
      'Compra de Internet Hotspot'
  };


  try {

    const controller =
      new AbortController();


    const timeout =
      setTimeout(
        () =>
          controller.abort(),

        Number(
          env.payment.emola.timeoutMs
        ) || 30000
      );


    const response =
      await fetch(
        env.payment.emola.apiUrl,

        {
          method:
            'POST',

          headers: {

            'Content-Type':
              'application/json',

            Accept:
              'application/json',

            ...(env.payment.emola.channelId
              ? {
                  'X-Channel-ID':
                    env.payment.emola.channelId
                }
              : {}),

            ...(env.payment.emola.password
              ? {
                  'X-Password':
                    env.payment.emola.password
                }
              : {})
          },

          body:
            JSON.stringify(
              payload
            ),

          signal:
            controller.signal
        }
      );


    clearTimeout(
      timeout
    );


    const text =
      await response.text();


    const data =
      parseJson(
        text
      );


    const status =
      classifyPaymentResponse(
        data,
        response.status,
        'e-Mola'
      );


    if (
      !response.ok ||
      status.kind ===
        'failed' ||
      status.kind ===
        'insufficient_funds'
    ) {
      return {
        accepted:
          false,

        provider:
          'emola',

        paymentStatus:
          status.kind,

        reason:
          status.kind,

        message:
          extractMessage(
            data
          ) ||
          status.message ||
          `e-Mola recusou o pedido. HTTP ${response.status}.`,

        raw:
          data || text,

        requestPayload:
          payload
      };
    }


    return {
      accepted:
        true,

      provider:
        'emola',

      paymentStatus:
        status.kind,

      message:
        extractMessage(
          data
        ) ||
        status.message,

      raw:
        data || text,

      requestPayload:
        payload
    };


  } catch (error) {

    return {

      accepted:
        false,

      provider:
        'emola',

      message:
        error.name ===
        'AbortError'
          ? 'Tempo limite ao contactar a API e-Mola.'
          : 'Erro de comunicacao com a API e-Mola.',

      raw: {
        error:
          error.message
      },

      requestPayload:
        payload
    };
  }
}


/**
 * ============================================================
 * ADICIONAR PREFIXO INTERNACIONAL
 * ============================================================
 */

function withCountryPrefix(
  phone,
  prefix
) {

  const digits =
    String(phone || '')
      .replace(/\D/g, '');


  if (
    digits.startsWith(
      prefix
    )
  ) {
    return digits;
  }


  return `${prefix}${digits}`;
}


/**
 * ============================================================
 * JSON SAFE PARSER
 * ============================================================
 */

function parseJson(text) {

  if (!text) {
    return null;
  }


  try {

    return JSON.parse(
      text
    );

  } catch {

    return {
      message:
        text
    };
  }
}


/**
 * ============================================================
 * CLASSIFICAR RESPOSTA DA OPERADORA
 * ============================================================
 */

function classifyPaymentResponse(
  data,
  httpStatus,
  label
) {

  const fields =
    flattenValues(
      data
    ).map(
      value =>
        String(value)
          .toUpperCase()
    );


  const joined =
    fields.join(' ');


  /**
   * SALDO INSUFICIENTE
   */
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


  /**
   * SUCESSO
   */
  const paidMarkers = [

    'INS-0',

    'SUCCESS',

    'SUCCESSFUL',

    'PAID',

    'COMPLETED',

    'CONFIRMED',

    'APROVADO',

    'PAGO'
  ];


  /**
   * PENDENTE
   */
  const pendingMarkers = [

    'PENDING',

    'PROCESSING',

    'ACCEPTED',

    'IN_PROGRESS',

    'AGUARDANDO'
  ];


  /**
   * FALHA
   */
  const failedMarkers = [

    'FAILED',

    'ERROR',

    'ERRO',

    'REJECTED',

    'DECLINED',

    'CANCELLED',

    'CANCELED',

    'TIMEOUT',

    'INVALID'
  ];


  /**
   * SALDO INSUFICIENTE
   */
  if (
    insufficientMarkers.some(
      marker =>
        joined.includes(
          marker
        )
    )
  ) {

    return {

      kind:
        'insufficient_funds',

      message:
        INSUFFICIENT_FUNDS_MESSAGE
    };
  }


  /**
   * STATUS EXPLÍCITO
   */
  const explicitStatus =
    extractExplicitStatus(
      data
    );


  if (
    explicitStatus ===
    'paid'
  ) {

    return {

      kind:
        'paid',

      message:
        `Pagamento ${label} confirmado.`
    };
  }


  if (
    explicitStatus ===
    'failed'
  ) {

    return {

      kind:
        'failed',

      message:
        extractMessage(
          data
        ) ||
        `Pagamento ${label} recusado.`
    };
  }


  /**
   * SUCESSO
   */
  if (
    paidMarkers.some(
      marker =>
        joined.includes(
          marker
        )
    )
  ) {

    return {

      kind:
        'paid',

      message:
        `Pagamento ${label} confirmado.`
    };
  }


  /**
   * PENDENTE
   */
  if (
    pendingMarkers.some(
      marker =>
        joined.includes(
          marker
        )
    )
  ) {

    return {

      kind:
        'pending',

      message:
        `Pedido ${label} aceite. Aguardando confirmacao.`
    };
  }


  /**
   * FALHA
   */
  if (
    failedMarkers.some(
      marker =>
        joined.includes(
          marker
        )
    )
  ) {

    return {

      kind:
        'failed',

      message:
        extractMessage(
          data
        ) ||
        `Pagamento ${label} recusado.`
    };
  }


  /**
   * HTTP 2xx sem status
   *
   * Consideramos pendente.
   */
  if (
    httpStatus >= 200 &&
    httpStatus < 300
  ) {

    return {

      kind:
        'pending',

      message:
        `Pedido ${label} enviado. Aguardando confirmacao.`
    };
  }


  return {

    kind:
      'failed',

    message:
      `${label} recusou o pedido.`
  };
}


/**
 * ============================================================
 * TRANSFORMAR OBJECTO EM LISTA DE VALORES
 * ============================================================
 */

function flattenValues(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return [];
  }


  if (
    Array.isArray(
      value
    )
  ) {

    return value.flatMap(
      flattenValues
    );
  }


  if (
    typeof value ===
    'object'
  ) {

    return Object.values(
      value
    ).flatMap(
      flattenValues
    );
  }


  return [
    value
  ];
}


/**
 * ============================================================
 * EXTRAIR STATUS EXPLÍCITO
 * ============================================================
 */

function extractExplicitStatus(
  value
) {

  if (
    !value ||
    typeof value !==
      'object'
  ) {

    return null;
  }


  for (
    const [
      key,
      rawValue
    ]
    of Object.entries(
      value
    )
  ) {

    /**
     * OBJECTOS ANINHADOS
     */
    if (
      rawValue &&
      typeof rawValue ===
        'object'
    ) {

      const nested =
        extractExplicitStatus(
          rawValue
        );


      if (nested) {

        return nested;
      }
    }


    const normalizedKey =
      String(
        key
      ).toLowerCase();


    const normalizedValue =
      String(
        rawValue
      ).toUpperCase();


    /**
     * BOOLEAN SUCCESS
     */
    if (
      [
        'success',
        'ok',
        'paid',
        'completed'
      ].includes(
        normalizedKey
      ) &&
      rawValue === true
    ) {

      return 'paid';
    }


    /**
     * BOOLEAN FAILED
     */
    if (
      [
        'success',
        'ok',
        'paid',
        'completed'
      ].includes(
        normalizedKey
      ) &&
      rawValue === false
    ) {

      return 'failed';
    }


    /**
     * STATUS
     */
    if (
      [
        'status',
        'state',
        'paymentstatus',
        'code',
        'responsecode',
        'output_responsecode'
      ].includes(
        normalizedKey
      )
    ) {


      if (
        [
          'SUCCESS',

          'SUCCESSFUL',

          'PAID',

          'COMPLETED',

          'CONFIRMED',

          'INS-0',

          '0',

          '00'
        ].includes(
          normalizedValue
        )
      ) {

        return 'paid';
      }


      if (
        [
          'FAILED',

          'ERROR',

          'REJECTED',

          'DECLINED',

          'CANCELLED',

          'CANCELED',

          'TIMEOUT'
        ].includes(
          normalizedValue
        )
      ) {

        return 'failed';
      }
    }
  }


  return null;
}


/**
 * ============================================================
 * EXTRAIR MENSAGEM
 * ============================================================
 */

function extractMessage(
  data
) {

  if (
    !data ||
    typeof data !==
      'object'
  ) {

    return '';
  }


  const messageKeys =
    new Set([

      'message',

      'mensagem',

      'output_responsedesc',

      'responsedesc',

      'description',

      'error',

      'errormessage',

      'reason'
    ]);


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      data
    )
  ) {


    if (
      messageKeys.has(
        String(
          key
        ).toLowerCase()
      ) &&
      typeof value !==
        'object'
    ) {

      return String(
        value
      );
    }


    if (
      value &&
      typeof value ===
        'object'
    ) {

      const nested =
        extractMessage(
          value
        );


      if (nested) {

        return nested;
      }
    }
  }


  return '';
}


/**
 * ============================================================
 * CALLBACK
 * ============================================================
 */

export function normalizeCallbackPayload(
  body,
  provider = 'M-Pesa'
) {

  const payload =
    body || {};


  const label =
    String(
      provider
    ).toLowerCase() ===
    'emola'
      ? 'e-Mola'
      : 'M-Pesa';


  const classification =
    classifyPaymentResponse(
      payload,
      200,
      label
    );


  const responseCode =

    payload.output_ResponseCode ||

    payload.responseCode ||

    payload.code ||

    '';


  const rawStatus =

    payload.status ||

    payload.paymentStatus ||

    payload.state ||

    responseCode ||

    '';


  const status =
    String(
      rawStatus
    ).toUpperCase();


  /**
   * REFERÊNCIA
   */
  const reference =

    payload.reference ||

    payload.transaction_ref ||

    payload.thirdparty_ref ||

    payload.transactionReference ||

    payload.input_TransactionReference ||

    payload.thirdPartyReference ||

    payload.output_ThirdPartyReference ||

    payload.output_TransactionReference ||

    payload.transacao_id ||

    payload.tx_id ||

    payload.order_id ||

    '';


  return {

    reference:
      String(
        reference
      ),

    success:
      classification.kind ===
      'paid',

    canceled:
      classification.kind ===
        'failed' ||
      classification.kind ===
        'insufficient_funds',

    reason:
      classification.kind,

    status:
      status ||
      classification.kind,

    message:
      extractMessage(
        payload
      ) ||
      classification.message,

    raw:
      payload
  };
}
