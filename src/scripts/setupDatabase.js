import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const schemaPath = path.join(projectRoot, 'db', 'schema.sql');

const database = env.db.database.replace(/`/g, '``');

const serverConnection = await mysql.createConnection({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  multipleStatements: true
});

await serverConnection.query(
  `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
await serverConnection.end();

const dbConnection = await mysql.createConnection({
  ...env.db,
  multipleStatements: true
});

const schema = await fs.readFile(schemaPath, 'utf8');
await dbConnection.query(schema);
await ensureColumn(dbConnection, 'vouchers', 'payment_provider', 'VARCHAR(30) NULL AFTER link_origem');
await ensureColumn(dbConnection, 'vouchers', 'status_mensagem', 'VARCHAR(255) NULL AFTER status');
await ensureColumn(dbConnection, 'vouchers', 'mikrotik_user_id', 'VARCHAR(80) NULL AFTER transacao_id');
await ensureColumn(dbConnection, 'vouchers', 'mikrotik_synced_at', 'DATETIME NULL AFTER mikrotik_user_id');
await ensureColumn(dbConnection, 'vouchers', 'mikrotik_error', 'VARCHAR(255) NULL AFTER mikrotik_synced_at');
await ensureColumn(dbConnection, 'vouchers', 'mikrotik_login_at', 'DATETIME NULL AFTER mikrotik_error');
await ensureColumn(dbConnection, 'vouchers', 'mikrotik_login_message', 'VARCHAR(255) NULL AFTER mikrotik_login_at');
await dbConnection.end();

console.log(`Banco ${env.db.database} pronto com pacotes e vouchers iniciais.`);

async function ensureColumn(connection, table, column, definition) {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [env.db.database, table, column]
  );

  if (columns.length === 0) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}
