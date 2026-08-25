import { generateVoucherBatch } from '../services/voucherGenerator.js';
import { pool } from '../config/db.js';

const args = parseArgs(process.argv.slice(2));

if (!args.pacote && !args.pacoteId && !args.plan) {
  console.error('Informe o pacote: npm run vouchers:generate -- --pacote=1 --quantity=10');
  process.exit(1);
}

const result = await generateVoucherBatch({
  pacoteId: args.pacote || args.pacoteId || args.plan,
  quantity: args.quantity || args.qtd || args.q || 10,
  prefix: args.prefix || 'VCH'
});

console.log(JSON.stringify(result, null, 2));
await pool.end();

function parseArgs(values) {
  return values.reduce((acc, value) => {
    const clean = value.replace(/^--/, '');
    const [key, ...rest] = clean.split('=');
    acc[key] = rest.join('=') || true;
    return acc;
  }, {});
}
