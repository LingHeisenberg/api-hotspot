import { env } from '../config/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureWalledGardenAccess,
  getMikrotikRestUrl,
  requestMikrotik,
  uploadRouterFileContents
} from '../services/mikrotikService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');

const portalUrl = new URL(env.portal.publicUrl);
const walledGardenTargets = getWalledGardenTargets();

console.log(`Portal publico: ${portalUrl.href}`);
console.log(`API publica: ${env.api.publicUrl}`);

for (const target of walledGardenTargets) {
  const host = target.hostname;
  const port = target.port;
  const garden = await ensureWalledGardenAccess({ host, port });

  if (garden.ok) {
    console.log(`OK walled-garden: ${host}:${port}`);
  } else {
    console.log(`FALHA walled-garden ${host}:${port}: ${garden.message}`);
  }
}

const htmlTemplate = await fs.readFile(path.join(projectRoot, 'mikrotik', 'login.html'), 'utf8');
const html = htmlTemplate.replaceAll('__PORTAL_PUBLIC_URL__', portalUrl.href);

const upload = await uploadRouterFileContents({
  dstPath: 'hotspot/login.html',
  contents: html
});

if (upload.ok) {
  console.log(`OK login.html enviado por REST file/set (${upload.key}=${upload.target})`);
} else {
  console.log(`FALHA upload login.html: ${upload.message}`);
}

const flashUpload = await uploadRouterFileContents({
  dstPath: 'flash/hotspot/login.html',
  contents: html
});

if (flashUpload.ok) {
  console.log(`OK flash/hotspot/login.html atualizado (${flashUpload.key}=${flashUpload.target})`);
} else {
  console.log(`FALHA flash/hotspot/login.html: ${flashUpload.message}`);
}

await replaceLegacyPortalReferences(portalUrl.href);

console.log('Setup Hotspot concluido.');

function getWalledGardenTargets() {
  const urls = [env.portal.publicUrl, env.api.publicUrl, ...env.mikrotik.walledGardenUrls];
  const unique = new Map();

  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      addTarget(unique, url.hostname, port);

      if (env.mikrotik.walledGardenAllowHttp && port === '443') {
        addTarget(unique, url.hostname, '80');
      }
    } catch {
      console.log(`IGNORADO walled-garden URL invalida: ${rawUrl}`);
    }
  }

  return [...unique.values()];
}

function addTarget(unique, hostname, port) {
  unique.set(`${hostname}:${port}`, { hostname, port });
}

async function replaceLegacyPortalReferences(portalHref) {
  const files = await requestMikrotik(getMikrotikRestUrl('/file/print'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      '.proplist': '.id,name,contents'
    })
  });

  if (!files.ok || !Array.isArray(files.data)) {
    console.log(`FALHA limpeza legado: ${files.message}`);
    return;
  }

  const legacyNeedles = [
    'https://sixtelecom.eyazs.com',
    'http://sixtelecom.eyazs.com',
    'sixtelecom.eyazs.com',
    'http://seu_servidor:3010',
    'https://seu_servidor:3010',
    'seu_servidor:3010',
    'http://192.168.1.5:3010',
    'https://192.168.1.5:3010'
  ];

  for (const file of files.data) {
    const contents = String(file.contents || '');

    if (!contents || !legacyNeedles.some((needle) => contents.includes(needle))) {
      continue;
    }

    const nextContents = legacyNeedles.reduce(
      (current, needle) => current.replaceAll(needle, portalHref.replace(/\/$/, '')),
      contents
    );

    const saved = await requestMikrotik(getMikrotikRestUrl('/file/set'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        '.id': file['.id'],
        contents: nextContents
      })
    });

    if (saved.ok) {
      console.log(`OK legado removido: ${file.name}`);
    } else {
      console.log(`FALHA legado ${file.name}: ${saved.message}`);
    }
  }
}
