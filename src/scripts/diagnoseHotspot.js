import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { getMikrotikRestUrl, requestMikrotik } from '../services/mikrotikService.js';

const result = {
  portal: {
    publicUrl: env.portal.publicUrl,
    loginUrl: env.mikrotik.loginUrl,
    restUrl: env.mikrotik.restUrl,
    paymentMode: env.payment.mode
  },
  mysql: null,
  mikrotik: {
    reachable: false,
    users: 0,
    profiles: 0,
    hotspotServers: 0,
    hosts: 0,
    walledGardenRules: 0,
    loginFile: false,
    warnings: []
  }
};

try {
  const [stock] = await pool.execute(
    `SELECT
       p.nome,
       SUM(v.status = 'disponivel') AS disponiveis,
       SUM(v.status = 'disponivel' AND v.mikrotik_synced_at IS NOT NULL) AS sincronizados,
       SUM(v.status = 'pendente') AS pendentes,
       SUM(v.status = 'pago') AS pagos,
       SUM(v.status = 'usado') AS usados
     FROM pacotes p
     LEFT JOIN vouchers v ON v.pacote_id = p.id
     GROUP BY p.id, p.nome
     ORDER BY p.ordem ASC`
  );

  result.mysql = stock;
} catch (error) {
  result.mysql = { ok: false, message: error.message };
}

const users = await requestMikrotik(env.mikrotik.restUrl, { method: 'GET' });

if (!users.ok) {
  result.mikrotik.warnings.push(`REST indisponivel: ${users.message}`);
  await finish();
}

result.mikrotik.reachable = true;
result.mikrotik.users = Array.isArray(users.data) ? users.data.length : 0;

await count('/ip/hotspot/user/profile', 'profiles');
await count('/ip/hotspot', 'hotspotServers');
await count('/ip/hotspot/host', 'hosts');
await count('/ip/hotspot/walled-garden/ip', 'walledGardenRules');
await checkLoginFile();

if (result.mikrotik.hotspotServers === 0) {
  result.mikrotik.warnings.push(
    'Este router REST nao mostra nenhum servidor em /ip/hotspot. Se o Hotspot real estiver noutro router, atualize MIKROTIK_REST_URL.'
  );
}

if (result.mikrotik.hosts === 0) {
  result.mikrotik.warnings.push(
    'Nao ha clientes listados em /ip/hotspot/host neste momento. Para login automatico, o cliente precisa abrir a compra pela rede Hotspot.'
  );
}

await finish();

async function count(path, key) {
  const response = await requestMikrotik(getMikrotikRestUrl(path), { method: 'GET' });

  if (!response.ok) {
    result.mikrotik.warnings.push(`${path}: ${response.message}`);
    return;
  }

  result.mikrotik[key] = Array.isArray(response.data) ? response.data.length : 0;
}

async function checkLoginFile() {
  const response = await requestMikrotik(getMikrotikRestUrl('/file'), { method: 'GET' });

  if (!response.ok) {
    result.mikrotik.warnings.push(`/file: ${response.message}`);
    return;
  }

  const files = Array.isArray(response.data) ? response.data : [];
  result.mikrotik.loginFile = files.some((file) => {
    const name = String(file.name || '');
    return name === 'hotspot/login.html' || name === 'flash/hotspot/login.html' || name.endsWith('/hotspot/login.html');
  });

  if (!result.mikrotik.loginFile) {
    result.mikrotik.warnings.push('login.html do portal nao foi encontrado nos arquivos do MikroTik.');
  }
}

async function finish() {
  await pool.end();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.mikrotik.warnings.length > 0 ? 1 : 0);
}
