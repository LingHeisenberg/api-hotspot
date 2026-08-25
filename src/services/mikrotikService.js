import { env } from '../config/env.js';

export async function createHotspotUser({ username, password, profile, comment, limitUptime }) {
  if (!env.mikrotik.syncEnabled) {
    return {
      ok: false,
      message: 'Sincronização com MikroTik está desativada. Ative MIKROTIK_SYNC_ENABLED=true.'
    };
  }

  if (!env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return {
      ok: false,
      message: 'Configuração REST do MikroTik incompleta. Verifique MIKROTIK_REST_URL e MIKROTIK_API_USER.'
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
    payload.server = env.mikrotik.hotspotServer;
  }

  const existing = await findHotspotUserByName(username);

  if (existing.ok && existing.user?.['.id']) {
    return updateHotspotUser(existing.user['.id'], payload);
  }

  return saveHotspotUser(payload, 'PUT', env.mikrotik.restUrl);
}

export async function findHotspotUserByName(username) {
  if (!env.mikrotik.syncEnabled || !env.mikrotik.restUrl || !env.mikrotik.apiUser) {
    return { ok: false, user: null };
  }

  const response = await requestMikrotik(env.mikrotik.restUrl, { method: 'GET' });

  if (!response.ok || !Array.isArray(response.data)) {
    return { ok: false, user: null, message: response.message };
  }

  return {
    ok: true,
    user: response.data.find((user) => user.name === username) || null
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
    const sameHost = item['dst-address'] === payload['dst-address'] || item['dst-host'] === payload['dst-host'];
    const samePort = !payload['dst-port'] || item['dst-port'] === payload['dst-port'];
    return sameHost && samePort;
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
  const match = Array.isArray(files.data)
    ? files.data.find((file) => file.name === dstPath || file.name === `/${dstPath}` || file.name?.endsWith(`/${dstPath}`))
    : null;
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

async function requestMikrotik(url, options = {}) {
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
          ? 'Tempo limite ao criar usuário no MikroTik.'
          : `Falha ao comunicar com MikroTik: ${error.message}`,
      raw: { error: error.message }
    };
  }
}

function getMikrotikRestUrl(path) {
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
  if (data && typeof data === 'object') {
    return data.detail || data.error || data.message || `MikroTik recusou o usuário. HTTP ${status}.`;
  }

  return text || `MikroTik recusou o usuário. HTTP ${status}.`;
}
