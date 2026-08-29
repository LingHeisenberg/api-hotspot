import { env } from '../config/env.js';

const MIKROTIK_SYNC_MAX_ATTEMPTS = 3;
const MIKROTIK_SYNC_RETRY_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Garante que um voucher existe no MikroTik.
 *
 * - Se não existir, cria.
 * - Se já existir, atualiza.
 * - Confirma depois se realmente existe na RB.
 * - Tenta novamente caso haja falha temporária.
 */
export async function syncVoucherToMikrotik({
  username,
  password,
  profile = 'default',
  comment = 'Eyazs Hotspot - voucher sincronizado automaticamente',
  limitUptime = '',
  maxAttempts = MIKROTIK_SYNC_MAX_ATTEMPTS
}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '').trim();

  if (!normalizedUsername || !normalizedPassword) {
    return {
      ok: false,
      synced: false,
      message:
        'Voucher sem username ou password para sincronizar com o MikroTik.'
    };
  }

  if (!env.mikrotik.syncEnabled) {
    return {
      ok: false,
      synced: false,
      skipped: true,
      message:
        'Sincronização com MikroTik está desativada. Ative MIKROTIK_SYNC_ENABLED=true.'
    };
  }

  if (!env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return {
      ok: false,
      synced: false,
      message:
        'Configuração REST do MikroTik incompleta. Verifique MIKROTIK_REST_URL e MIKROTIK_API_USER.'
    };
  }

  const attempts = Math.max(
    1,
    Math.min(Number(maxAttempts) || 1, 5)
  );

  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await createHotspotUser({
      username: normalizedUsername,
      password: normalizedPassword,
      profile,
      comment,
      limitUptime
    });

    if (result.ok) {
      const verification =
        await findHotspotUserByName(normalizedUsername);

      if (verification.ok && verification.user) {
        return {
          ok: true,
          synced: true,
          createdOrUpdated: true,
          attempt,
          id:
            verification.user['.id'] ||
            result.id ||
            '',
          user: verification.user,
          message:
            `Voucher ${normalizedUsername} sincronizado com o MikroTik.`
        };
      }

      lastResult = {
        ok: false,
        synced: false,
        message:
          `O MikroTik aceitou ${normalizedUsername}, mas a verificação posterior não encontrou o utilizador.`,
        raw: result.raw
      };
    } else {
      lastResult = {
        ...result,
        synced: false
      };
    }

    if (attempt < attempts) {
      await sleep(
        MIKROTIK_SYNC_RETRY_DELAY_MS * attempt
      );
    }
  }

  return {
    ok: false,
    synced: false,
    attempts,
    message:
      lastResult?.message ||
      `Não foi possível sincronizar ${normalizedUsername} com o MikroTik.`,
    raw: lastResult?.raw
  };
}

/**
 * Sincroniza vários vouchers.
 */
export async function syncVoucherBatchToMikrotik(
  vouchers = []
) {
  const results = [];

  for (const voucher of vouchers) {
    const username =
      voucher.username ||
      voucher.codigo_voucher ||
      voucher.codigo ||
      voucher.name;

    const password =
      voucher.password ||
      voucher.senha_voucher ||
      voucher.senha;

    const result =
      await syncVoucherToMikrotik({
        username,
        password,
        profile:
          voucher.profile || 'default',
        comment:
          voucher.comment ||
          'Eyazs Hotspot - voucher sincronizado automaticamente',
        limitUptime:
          voucher.limitUptime ||
          voucher['limit-uptime'] ||
          ''
      });

    results.push({
      username,
      ...result
    });
  }

  return {
    ok: results.every((item) => item.ok),

    total: results.length,

    sincronizados:
      results.filter((item) => item.ok).length,

    falhas:
      results.filter((item) => !item.ok).length,

    results
  };
}

////DIVISAO

export async function createHotspotUser({
  username,
  password,
  profile = 'default',
  comment = 'Eyazs Hotspot',
  limitUptime = ''
}) {
  username = String(username || '').trim();
  password = String(password || '').trim();

  if (!username || !password) {
    return {
      ok: false,
      message:
        'Username e password são obrigatórios para criar o utilizador Hotspot.'
    };
  }

  if (!env.mikrotik.syncEnabled) {
    return {
      ok: false,
      message:
        'Sincronização com MikroTik está desativada. Ative MIKROTIK_SYNC_ENABLED=true.'
    };
  }

  if (
    !env.mikrotik.restUrl ||
    !env.mikrotik.apiUser
  ) {
    return {
      ok: false,
      message:
        'Configuração REST do MikroTik incompleta. Verifique MIKROTIK_REST_URL e MIKROTIK_API_USER.'
    };
  }

  const payload = {
    name: username,
    password,
    profile,
    comment
  };

  if (limitUptime) {
    payload['limit-uptime'] = limitUptime;
  }

  if (env.mikrotik.hotspotServer) {
    payload.server =
      env.mikrotik.hotspotServer;
  }

  const existing =
    await findHotspotUserByName(username);

  /*
   * Se já existe na RB,
   * atualiza em vez de criar duplicado.
   */
  if (
    existing.ok &&
    existing.user?.['.id']
  ) {
    return updateHotspotUser(
      existing.user['.id'],
      payload
    );
  }

  /*
   * Caso não exista, cria.
   */
  return saveHotspotUser(
    payload,
    'PUT',
    env.mikrotik.restUrl
  );
}

export async function findHotspotUserByName(
  username
) {
  if (
    !env.mikrotik.syncEnabled ||
    !env.mikrotik.restUrl ||
    !env.mikrotik.apiUser
  ) {
    return {
      ok: false,
      user: null
    };
  }

  const normalizedUsername =
    String(username || '').trim();

  if (!normalizedUsername) {
    return {
      ok: false,
      user: null,
      message:
        'Username do Hotspot em falta.'
    };
  }

  /*
   * Primeiro tenta procurar diretamente
   * pelo nome.
   */
  let filteredUrl =
    env.mikrotik.restUrl;

  try {
    const url =
      new URL(env.mikrotik.restUrl);

    url.searchParams.set(
      'name',
      normalizedUsername
    );

    filteredUrl = url.toString();
  } catch {
    /*
     * Se houver problema,
     * usa o endpoint normal abaixo.
     */
  }

  const filteredResponse =
    await requestMikrotik(
      filteredUrl,
      {
        method: 'GET'
      }
    );

  if (
    filteredResponse.ok &&
    Array.isArray(filteredResponse.data)
  ) {
    const directUser =
      filteredResponse.data.find(
        (user) =>
          user.name === normalizedUsername
      ) || null;

    if (directUser) {
      return {
        ok: true,
        user: directUser
      };
    }
  }

  /*
   * Fallback:
   * lista todos e procura localmente.
   */
  const response =
    await requestMikrotik(
      env.mikrotik.restUrl,
      {
        method: 'GET'
      }
    );

  if (
    !response.ok ||
    !Array.isArray(response.data)
  ) {
    return {
      ok: false,
      user: null,
      message:
        response.message ||
        filteredResponse.message
    };
  }

  return {
    ok: true,

    user:
      response.data.find(
        (user) =>
          user.name === normalizedUsername
      ) || null
  };
}
export async function upsertHotspotUserProfile({ name, sessionTimeout, sharedUsers = '1', rateLimit = '' }) {
  if (!env.mikrotik.syncEnabled || !env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return {
      ok: false,
      message: 'Configuracao REST do MikroTik incompleta.'
    };
  }

  const profileUrl = getMikrotikRestUrl('/ip/hotspot/user/profile');
  const profiles = await requestMikrotik(profileUrl, { method: 'GET' });

  if (!profiles.ok || !Array.isArray(profiles.data)) {
    return {
      ok: false,
      message: profiles.message || 'Nao foi possivel listar perfis Hotspot.'
    };
  }

  const payload = {
    name,
    'shared-users': String(sharedUsers),
    'add-mac-cookie': 'yes'
  };

  if (sessionTimeout) payload['session-timeout'] = sessionTimeout;
  if (rateLimit) payload['rate-limit'] = rateLimit;

  const existing = profiles.data.find((profile) => profile.name === name);
  const method = existing?.['.id'] ? 'PATCH' : 'PUT';
  const url = existing?.['.id'] ? `${profileUrl.replace(/\/+$/, '')}/${existing['.id']}` : profileUrl;
  const saved = await requestMikrotik(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!saved.ok) {
    return {
      ok: false,
      message: saved.message,
      raw: saved.raw
    };
  }

  return {
    ok: true,
    id: saved.data?.['.id'] || existing?.['.id'] || '',
    created: method === 'PUT',
    raw: saved.data
  };
}

export async function activateHotspotClient({ username, password, ip, mac }) {
  if (!env.mikrotik.syncEnabled || !env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return {
      ok: false,
      skipped: true,
      message: 'Configuracao REST do MikroTik incompleta.'
    };
  }

  const host = await findHotspotHost({ ip, mac });
  const resolvedIp = host.host?.address || host.host?.['to-address'] || ip;
  const resolvedMac = mac || host.host?.['mac-address'];

  if (!resolvedIp) {
    return {
      ok: false,
      skipped: true,
      message: 'Cliente sem IP do Hotspot. Abra a compra pela pagina login.html do MikroTik.'
    };
  }

  const payload = {
    user: username,
    password,
    ip: resolvedIp
  };

  if (resolvedMac) {
    payload['mac-address'] = resolvedMac;
  }

  const response = await requestMikrotik(getMikrotikRestUrl('/ip/hotspot/active/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
      raw: response.raw,
      payload
    };
  }

  return {
    ok: true,
    message: 'Cliente autenticado no Hotspot.',
    raw: response.data,
    payload
  };
}

export async function findHotspotHost({ ip, mac }) {
  const response = await requestMikrotik(getMikrotikRestUrl('/ip/hotspot/host'), { method: 'GET' });

  if (!response.ok || !Array.isArray(response.data)) {
    return {
      ok: false,
      host: null,
      message: response.message || 'Nao foi possivel listar hosts do Hotspot.'
    };
  }

  const normalizedMac = String(mac || '').toLowerCase();
  const host =
    response.data.find((item) => ip && (item.address === ip || item['to-address'] === ip)) ||
    response.data.find((item) => normalizedMac && String(item['mac-address'] || '').toLowerCase() === normalizedMac) ||
    null;

  return {
    ok: true,
    host
  };
}

export async function checkHotspotReadiness() {
  if (!env.mikrotik.syncEnabled) {
    return {
      ok: false,
      message: 'Sincronizacao com MikroTik esta desativada.'
    };
  }

  if (!env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return {
      ok: false,
      message: 'Configuracao REST do MikroTik incompleta.'
    };
  }

  const users = await requestMikrotik(env.mikrotik.restUrl, { method: 'GET' });

  if (!users.ok) {
    return {
      ok: false,
      message: `REST do MikroTik indisponivel: ${users.message}`
    };
  }

  const servers = await requestMikrotik(getMikrotikRestUrl('/ip/hotspot'), { method: 'GET' });

  if (!servers.ok) {
    const hosts = await requestMikrotik(getMikrotikRestUrl('/ip/hotspot/host'), { method: 'GET' });

    if (hosts.ok && Array.isArray(hosts.data)) {
      return {
        ok: true,
        users: Array.isArray(users.data) ? users.data.length : 0,
        hotspotServers: null,
        hosts: hosts.data.length,
        warning: `Servidor Hotspot nao confirmou em /ip/hotspot, mas /ip/hotspot/host respondeu. Detalhe: ${servers.message}`
      };
    }

    return {
      ok: false,
      message: `Nao foi possivel confirmar o servidor Hotspot: ${servers.message}`
    };
  }

  const activeServers = Array.isArray(servers.data)
    ? servers.data.filter((server) => String(server.disabled || 'false') !== 'true')
    : [];

  if (activeServers.length === 0) {
    return {
      ok: false,
      message:
        'O MikroTik REST esta acessivel, mas este router nao tem servidor Hotspot ativo em /ip/hotspot. Configure o Hotspot neste router ou aponte MIKROTIK_REST_URL para o router correto antes de cobrar.'
    };
  }

  return {
    ok: true,
    users: Array.isArray(users.data) ? users.data.length : 0,
    hotspotServers: activeServers.length
  };
}

export async function ensureWalledGardenAccess({ host, port }) {
  if (!host) {
    return {
      ok: false,
      message: 'Host do portal em falta.'
    };
  }

  const url = getMikrotikRestUrl('/ip/hotspot/walled-garden/ip');
  const existing = await requestMikrotik(url, { method: 'GET' });

  if (!existing.ok || !Array.isArray(existing.data)) {
    return {
      ok: false,
      message: existing.message || 'Nao foi possivel listar o walled-garden.'
    };
  }

  const payload = {
    action: 'accept',
    disabled: 'false',
    comment: 'Eyazs portal de pagamentos'
  };

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    payload['dst-address'] = host;
  } else {
    payload['dst-host'] = host;
  }

  if (port) {
    payload.protocol = 'tcp';
    payload['dst-port'] = String(port);
  }

  const match = existing.data.find((item) => {
    const sameAddress = payload['dst-address'] && item['dst-address'] === payload['dst-address'];
    const sameHost = payload['dst-host'] && item['dst-host'] === payload['dst-host'];
    const samePort = !payload['dst-port'] || item['dst-port'] === payload['dst-port'];
    return (sameAddress || sameHost) && samePort;
  });

  const method = match?.['.id'] ? 'PATCH' : 'PUT';
  const targetUrl = match?.['.id'] ? `${url.replace(/\/+$/, '')}/${match['.id']}` : url;
  const saved = await requestMikrotik(targetUrl, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!saved.ok) {
    return {
      ok: false,
      message: saved.message,
      raw: saved.raw
    };
  }

  return {
    ok: true,
    created: method === 'PUT',
    raw: saved.data
  };
}

export async function downloadHotspotLoginToRouter({ sourceUrl, dstPath = 'hotspot/login.html' }) {
  const response = await requestMikrotik(getMikrotikRestUrl('/tool/fetch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: sourceUrl,
      'dst-path': dstPath,
      output: 'file'
    })
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
      raw: response.raw
    };
  }

  return {
    ok: true,
    raw: response.data
  };
}

export async function uploadRouterFileContents({ dstPath = 'hotspot/login.html', contents }) {
  if (!contents) {
    return {
      ok: false,
      message: 'Conteudo do arquivo em falta.'
    };
  }

  const files = await requestMikrotik(getMikrotikRestUrl('/file'), { method: 'GET' });
  const fileList = Array.isArray(files.data) ? files.data : [];
  const match =
    fileList.find((file) => file.name === dstPath || file.name === `/${dstPath}`) ||
    null;
  const targets = match?.['.id'] ? [...new Set([match['.id'], dstPath].filter(Boolean))] : [];
  const url = getMikrotikRestUrl('/file/set');
  let lastError = 'Nao foi possivel atualizar o arquivo no MikroTik.';

  for (const target of targets) {
    for (const key of ['.id', 'numbers']) {
      const response = await requestMikrotik(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          [key]: target,
          contents
        })
      });

      if (response.ok) {
        return {
          ok: true,
          raw: response.data,
          target,
          key
        };
      }

      lastError = response.message || lastError;
    }
  }

  const created = await requestMikrotik(getMikrotikRestUrl('/file/add'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: dstPath,
      contents
    })
  });

  if (created.ok) {
    return {
      ok: true,
      raw: created.data,
      target: dstPath,
      key: 'name'
    };
  }

  lastError = created.message || lastError;

  return {
    ok: false,
    message: lastError
  };
}

async function updateHotspotUser(id, payload) {
  const url = `${env.mikrotik.restUrl.replace(/\/+$/, '')}/${id}`;
  return saveHotspotUser(payload, 'PATCH', url, id);
}

async function saveHotspotUser(payload, method, url, knownId = '') {
  const response = await requestMikrotik(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
      raw: response.raw
    };
  }

  return {
    ok: true,
    id: response.data?.['.id'] || response.data?.id || knownId || '',
    raw: response.data
  };
}

export async function requestMikrotik(url, options = {}) {
  const credentials = Buffer.from(`${env.mikrotik.apiUser}:${env.mikrotik.apiPass}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.mikrotik.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok) {
      return {
        ok: false,
        message: extractMikrotikError(data, text, response.status),
        raw: data || text
      };
    }

    return {
      ok: true,
      data: data || text
    };
  } catch (error) {
    clearTimeout(timeout);

    return {
      ok: false,
      message:
        error.name === 'AbortError'
          ? 'Tempo limite ao comunicar com MikroTik.'
          : `Falha ao comunicar com MikroTik: ${error.message}`,
      raw: { error: error.message }
    };
  }
}

export function getMikrotikRestUrl(path) {
  const marker = '/rest/';
  const index = env.mikrotik.restUrl.indexOf(marker);

  if (index === -1) {
    return env.mikrotik.restUrl.replace(/\/+$/, '');
  }

  return `${env.mikrotik.restUrl.slice(0, index + marker.length)}${path.replace(/^\/+/, '')}`;
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMikrotikError(data, text, status) {
  if (status === 401) {
    return 'MikroTik recusou as credenciais REST. Verifique MIKROTIK_API_USER e MIKROTIK_API_PASS no Railway.';
  }

  if (status === 403) {
    return 'Usuario MikroTik sem permissao para esta operacao REST. Verifique as permissoes do grupo no RouterOS.';
  }

  if (data && typeof data === 'object') {
    return data.detail || data.error || data.message || `MikroTik recusou o usuário. HTTP ${status}.`;
  }

  return text || `MikroTik recusou o usuário. HTTP ${status}.`;
}
