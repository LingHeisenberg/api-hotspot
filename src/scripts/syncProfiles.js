import { pool } from '../config/db.js';
import { upsertHotspotUserProfile } from '../services/mikrotikService.js';
import { durationToRouterTime } from '../utils/mikrotikTime.js';

const [plans] = await pool.execute(
  `SELECT nome, tempo, perfil_mikrotik
   FROM pacotes
   WHERE ativo = 1
   ORDER BY ordem ASC, id ASC`
);

let ok = 0;
let failed = 0;

for (const plan of plans) {
  const result = await upsertHotspotUserProfile({
    name: plan.perfil_mikrotik,
    sessionTimeout: durationToRouterTime(plan.tempo),
    sharedUsers: '1'
  });

  if (result.ok) {
    ok += 1;
    console.log(`OK ${plan.perfil_mikrotik} (${plan.tempo})`);
  } else {
    failed += 1;
    console.log(`FALHA ${plan.perfil_mikrotik}: ${result.message}`);
  }
}

await pool.end();

console.log(`Perfis sincronizados. OK: ${ok}. Falhas: ${failed}.`);
