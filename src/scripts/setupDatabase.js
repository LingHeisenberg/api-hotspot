import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

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

await ensureCoreTables(dbConnection);
await ensurePacotesColumns(dbConnection);
await ensureVouchersColumns(dbConnection);
await ensurePaymentEventsColumns(dbConnection);
await ensureFreeTrialsColumns(dbConnection);
await ensureIndexes(dbConnection);
await seedPackages(dbConnection);
await seedInitialVouchers(dbConnection);
await normalizeVoucherSyncStatus(dbConnection);
await dbConnection.end();

console.log(`Banco ${env.db.database} pronto e migrado.`);

async function ensureCoreTables(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS pacotes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(80) NOT NULL,
      tempo VARCHAR(60) NOT NULL,
      categoria ENUM('horas', 'dias', 'semanal') NOT NULL,
      preco DECIMAL(10,2) NOT NULL,
      perfil_mikrotik VARCHAR(80) NOT NULL DEFAULT 'default',
      ordem INT NOT NULL DEFAULT 0,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      stock_minimo INT NOT NULL DEFAULT 10,
      stock_alvo INT NOT NULL DEFAULT 30,
      auto_stock_enabled TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS vouchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pacote_id INT NOT NULL,
      codigo_voucher VARCHAR(80) NOT NULL,
      senha_voucher VARCHAR(80) NOT NULL,
      telefone_cliente VARCHAR(20) NULL,
      mac_cliente VARCHAR(80) NULL,
      ip_cliente VARCHAR(80) NULL,
      link_origem VARCHAR(255) NULL,
      payment_provider VARCHAR(30) NULL,
      status ENUM('disponivel', 'pendente', 'pago', 'usado', 'cancelado') NOT NULL DEFAULT 'disponivel',
      status_mensagem VARCHAR(255) NULL,
      transacao_id VARCHAR(80) NULL,
      mikrotik_user_id VARCHAR(80) NULL,
      mikrotik_synced_at DATETIME NULL,
      mikrotik_sync_status ENUM('pendente', 'sincronizado', 'erro') NOT NULL DEFAULT 'pendente',
      mikrotik_sync_erro TEXT NULL,
      mikrotik_sync_em DATETIME NULL,
      mikrotik_error VARCHAR(255) NULL,
      mikrotik_login_at DATETIME NULL,
      mikrotik_login_message VARCHAR(255) NULL,
      reservado_em DATETIME NULL,
      pago_em DATETIME NULL,
      usado_em DATETIME NULL,
      data_criacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS payment_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(30) NULL,
      reference VARCHAR(80) NULL,
      status VARCHAR(80) NULL,
      payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS free_trials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_key VARCHAR(120) NOT NULL,
      mac_cliente VARCHAR(80) NULL,
      ip_cliente VARCHAR(80) NULL,
      link_origem VARCHAR(255) NULL,
      codigo_voucher VARCHAR(80) NOT NULL,
      senha_voucher VARCHAR(80) NOT NULL,
      mikrotik_user_id VARCHAR(80) NULL,
      status ENUM('ativo', 'expirado', 'erro') NOT NULL DEFAULT 'ativo',
      status_mensagem VARCHAR(255) NULL,
      trial_date DATE NOT NULL,
      expires_at DATETIME NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
    )`
  );
}

async function ensurePacotesColumns(connection) {
  await ensureColumn(connection, 'pacotes', 'perfil_mikrotik', "VARCHAR(80) NOT NULL DEFAULT 'default' AFTER preco");
  await ensureColumn(connection, 'pacotes', 'ordem', 'INT NOT NULL DEFAULT 0 AFTER perfil_mikrotik');
  await ensureColumn(connection, 'pacotes', 'ativo', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER ordem');
  await ensureColumn(connection, 'pacotes', 'stock_minimo', 'INT NOT NULL DEFAULT 10 AFTER ativo');
  await ensureColumn(connection, 'pacotes', 'stock_alvo', 'INT NOT NULL DEFAULT 30 AFTER stock_minimo');
  await ensureColumn(connection, 'pacotes', 'auto_stock_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER stock_alvo');
  await ensureColumn(connection, 'pacotes', 'criado_em', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER auto_stock_enabled');
}

async function ensureVouchersColumns(connection) {
  await ensureColumn(connection, 'vouchers', 'telefone_cliente', 'VARCHAR(20) NULL AFTER senha_voucher');
  await ensureColumn(connection, 'vouchers', 'mac_cliente', 'VARCHAR(80) NULL AFTER telefone_cliente');
  await ensureColumn(connection, 'vouchers', 'ip_cliente', 'VARCHAR(80) NULL AFTER mac_cliente');
  await ensureColumn(connection, 'vouchers', 'link_origem', 'VARCHAR(255) NULL AFTER ip_cliente');
  await ensureColumn(connection, 'vouchers', 'payment_provider', 'VARCHAR(30) NULL AFTER link_origem');
  await ensureColumn(
    connection,
    'vouchers',
    'status',
    "ENUM('disponivel', 'pendente', 'pago', 'usado', 'cancelado') NOT NULL DEFAULT 'disponivel' AFTER payment_provider"
  );
  await ensureColumn(connection, 'vouchers', 'status_mensagem', 'VARCHAR(255) NULL AFTER status');
  await ensureColumn(connection, 'vouchers', 'transacao_id', 'VARCHAR(80) NULL AFTER status_mensagem');
  await ensureColumn(connection, 'vouchers', 'mikrotik_user_id', 'VARCHAR(80) NULL AFTER transacao_id');
  await ensureColumn(connection, 'vouchers', 'mikrotik_synced_at', 'DATETIME NULL AFTER mikrotik_user_id');
  await ensureColumn(
    connection,
    'vouchers',
    'mikrotik_sync_status',
    "ENUM('pendente', 'sincronizado', 'erro') NOT NULL DEFAULT 'pendente' AFTER mikrotik_synced_at"
  );
  await ensureColumn(connection, 'vouchers', 'mikrotik_sync_erro', 'TEXT NULL AFTER mikrotik_sync_status');
  await ensureColumn(connection, 'vouchers', 'mikrotik_sync_em', 'DATETIME NULL AFTER mikrotik_sync_erro');
  await ensureColumn(connection, 'vouchers', 'mikrotik_error', 'VARCHAR(255) NULL AFTER mikrotik_sync_em');
  await ensureColumn(connection, 'vouchers', 'mikrotik_login_at', 'DATETIME NULL AFTER mikrotik_error');
  await ensureColumn(connection, 'vouchers', 'mikrotik_login_message', 'VARCHAR(255) NULL AFTER mikrotik_login_at');
  await ensureColumn(connection, 'vouchers', 'reservado_em', 'DATETIME NULL AFTER mikrotik_login_message');
  await ensureColumn(connection, 'vouchers', 'pago_em', 'DATETIME NULL AFTER reservado_em');
  await ensureColumn(connection, 'vouchers', 'usado_em', 'DATETIME NULL AFTER pago_em');
  await ensureColumn(connection, 'vouchers', 'data_criacao', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER usado_em');
}

async function ensurePaymentEventsColumns(connection) {
  await ensureColumn(connection, 'payment_events', 'provider', 'VARCHAR(30) NULL AFTER id');
  await ensureColumn(connection, 'payment_events', 'reference', 'VARCHAR(80) NULL AFTER provider');
  await ensureColumn(connection, 'payment_events', 'status', 'VARCHAR(80) NULL AFTER reference');
  await ensureColumn(connection, 'payment_events', 'payload', 'JSON NULL AFTER status');
  await ensureColumn(connection, 'payment_events', 'created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER payload');
}

async function ensureFreeTrialsColumns(connection) {
  await ensureColumn(connection, 'free_trials', 'client_key', 'VARCHAR(120) NOT NULL AFTER id');
  await ensureColumn(connection, 'free_trials', 'mac_cliente', 'VARCHAR(80) NULL AFTER client_key');
  await ensureColumn(connection, 'free_trials', 'ip_cliente', 'VARCHAR(80) NULL AFTER mac_cliente');
  await ensureColumn(connection, 'free_trials', 'link_origem', 'VARCHAR(255) NULL AFTER ip_cliente');
  await ensureColumn(connection, 'free_trials', 'codigo_voucher', 'VARCHAR(80) NOT NULL AFTER link_origem');
  await ensureColumn(connection, 'free_trials', 'senha_voucher', 'VARCHAR(80) NOT NULL AFTER codigo_voucher');
  await ensureColumn(connection, 'free_trials', 'mikrotik_user_id', 'VARCHAR(80) NULL AFTER senha_voucher');
  await ensureColumn(connection, 'free_trials', 'status', "ENUM('ativo', 'expirado', 'erro') NOT NULL DEFAULT 'ativo' AFTER mikrotik_user_id");
  await ensureColumn(connection, 'free_trials', 'status_mensagem', 'VARCHAR(255) NULL AFTER status');
  await ensureColumn(connection, 'free_trials', 'trial_date', 'DATE NOT NULL AFTER status_mensagem');
  await ensureColumn(connection, 'free_trials', 'expires_at', 'DATETIME NOT NULL AFTER trial_date');
  await ensureColumn(connection, 'free_trials', 'criado_em', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER expires_at');
  await ensureColumn(connection, 'free_trials', 'atualizado_em', 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER criado_em');
}

async function ensureIndexes(connection) {
  await ensureIndex(
    connection,
    'vouchers',
    'uk_codigo_voucher',
    'CREATE UNIQUE INDEX uk_codigo_voucher ON vouchers (codigo_voucher)'
  );
  await ensureIndex(
    connection,
    'vouchers',
    'uk_transacao_id',
    'CREATE UNIQUE INDEX uk_transacao_id ON vouchers (transacao_id)'
  );
  await ensureIndex(
    connection,
    'vouchers',
    'idx_vouchers_status_pacote',
    'CREATE INDEX idx_vouchers_status_pacote ON vouchers (pacote_id, status)'
  );
  await ensureIndex(
    connection,
    'vouchers',
    'idx_vouchers_sync_stock',
    'CREATE INDEX idx_vouchers_sync_stock ON vouchers (pacote_id, status, mikrotik_sync_status)'
  );
  await ensureIndex(
    connection,
    'payment_events',
    'idx_payment_events_reference',
    'CREATE INDEX idx_payment_events_reference ON payment_events (reference)'
  );
  await ensureIndex(
    connection,
    'free_trials',
    'uk_free_trial_client_day',
    'CREATE UNIQUE INDEX uk_free_trial_client_day ON free_trials (client_key, trial_date)'
  );
  await ensureIndex(
    connection,
    'free_trials',
    'uk_free_trial_codigo',
    'CREATE UNIQUE INDEX uk_free_trial_codigo ON free_trials (codigo_voucher)'
  );
  await ensureIndex(
    connection,
    'free_trials',
    'idx_free_trials_client',
    'CREATE INDEX idx_free_trials_client ON free_trials (client_key)'
  );
  await ensureIndex(
    connection,
    'free_trials',
    'idx_free_trials_status',
    'CREATE INDEX idx_free_trials_status ON free_trials (status, expires_at)'
  );
}

async function seedPackages(connection) {
  await connection.query(
    `INSERT INTO pacotes (
       id,
       nome,
       tempo,
       categoria,
       preco,
       perfil_mikrotik,
       ordem,
       ativo,
       stock_minimo,
       stock_alvo,
       auto_stock_enabled
     )
     VALUES
       (1, 'Matinal', '2 Horas', 'horas', 5.00, 'Matinal', 1, 1, 10, 30, 1),
       (2, 'Expediente', '5 Horas', 'horas', 10.00, 'Expediente', 2, 1, 10, 30, 1),
       (3, 'Dia a Dia', '1 Dia', 'dias', 20.00, 'Dia_a_Dia', 3, 1, 10, 30, 1),
       (4, 'Fim de Semana', '3 Dias', 'dias', 60.00, 'Fim_de_Semana', 4, 1, 10, 30, 1),
       (5, 'Toda Semana', '1 Semana', 'semanal', 100.00, 'Toda_Semana', 5, 1, 10, 30, 1),
       (6, 'Super Net', '4 Semanas', 'semanal', 550.00, 'Super_Net', 6, 1, 10, 30, 1)
     ON DUPLICATE KEY UPDATE
       nome = VALUES(nome),
       tempo = VALUES(tempo),
       categoria = VALUES(categoria),
       preco = VALUES(preco),
       perfil_mikrotik = VALUES(perfil_mikrotik),
       ordem = VALUES(ordem),
       ativo = VALUES(ativo),
       stock_minimo = VALUES(stock_minimo),
       stock_alvo = VALUES(stock_alvo),
       auto_stock_enabled = VALUES(auto_stock_enabled)`
  );
}

async function seedInitialVouchers(connection) {
  await connection.query(
    `INSERT IGNORE INTO vouchers (
       pacote_id,
       codigo_voucher,
       senha_voucher,
       status,
       mikrotik_sync_status,
       status_mensagem
     )
     VALUES
       (1, 'VCH10001', '2101', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (1, 'VCH10002', '2102', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (1, 'VCH10003', '2103', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (2, 'VCH20001', '2201', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (2, 'VCH20002', '2202', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (2, 'VCH20003', '2203', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (3, 'VCH30001', '2301', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (3, 'VCH30002', '2302', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (4, 'VCH40001', '2401', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (4, 'VCH40002', '2402', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (5, 'VCH50001', '2501', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (5, 'VCH50002', '2502', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (6, 'VCH60001', '2601', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.'),
       (6, 'VCH60002', '2602', 'disponivel', 'pendente', 'Voucher inicial aguardando sincronizacao.')`
  );
}

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

async function ensureIndex(connection, table, indexName, statement) {
  const [indexes] = await connection.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [env.db.database, table, indexName]
  );

  if (indexes.length === 0) {
    await connection.query(statement);
  }
}

async function normalizeVoucherSyncStatus(connection) {
  await connection.query(
    `UPDATE vouchers
     SET mikrotik_sync_status = 'sincronizado',
         mikrotik_sync_em = COALESCE(mikrotik_sync_em, mikrotik_synced_at)
     WHERE mikrotik_synced_at IS NOT NULL
       AND mikrotik_sync_status <> 'sincronizado'`
  );
}
