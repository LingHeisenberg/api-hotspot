import { env } from '../config/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadHotspotLoginToRouter,
  ensureWalledGardenAccess,
  uploadRouterFileContents
} from '../services/mikrotikService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');

const portalUrl = new URL(env.portal.publicUrl);
const host = portalUrl.hostname;
const port = portalUrl.port || (portalUrl.protocol === 'https:' ? '443' : '80');

console.log(`Portal publico: ${portalUrl.href}`);

const garden = await ensureWalledGardenAccess({ host, port });

if (garden.ok) {
  console.log(`OK walled-garden: ${host}:${port}`);
} else {
  console.log(`FALHA walled-garden: ${garden.message}`);
}

const loginUrl = new URL('/hotspot/login.html', portalUrl).href;
const login = await downloadHotspotLoginToRouter({
  sourceUrl: loginUrl,
  dstPath: 'hotspot/login.html'
});
const html = await fs.readFile(path.join(projectRoot, 'mikrotik', 'login.html'), 'utf8');

if (login.ok) {
  console.log(`OK login.html copiado para o MikroTik a partir de ${loginUrl}`);
} else {
  console.log(`FALHA login.html: ${login.message}`);

  const upload = await uploadRouterFileContents({
    dstPath: 'hotspot/login.html',
    contents: html
  });

  if (upload.ok) {
    console.log(`OK login.html enviado por REST file/set (${upload.key}=${upload.target})`);
  } else {
    console.log(`FALHA upload login.html: ${upload.message}`);
  }
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

console.log('Setup Hotspot concluido.');
