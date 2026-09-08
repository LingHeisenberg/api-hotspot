import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { permissions, roleDefaults } from './permissions.js';

// Deliberately independent of db:setup: never seeds or rewrites commercial data.
export async function migrateAdmin() {
  const c = await pool.getConnection();
  try {
    const [[lock]] = await c.query("SELECT GET_LOCK('eyazs_admin_migration', 30) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Migration administrativa já em execução.');
    // Some installations predate the Trial feature. Create only the missing
    // table; this does not seed, rewrite, or delete any commercial records.
    await c.query(`CREATE TABLE IF NOT EXISTS free_trials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_key VARCHAR(120) NOT NULL,
      mac_cliente VARCHAR(80) NULL,
      ip_cliente VARCHAR(80) NULL,
      link_origem VARCHAR(255) NULL,
      codigo_voucher VARCHAR(80) NOT NULL,
      senha_voucher VARCHAR(80) NOT NULL,
      mikrotik_user_id VARCHAR(80) NULL,
      status ENUM('ativo','expirado','erro') NOT NULL DEFAULT 'ativo',
      status_mensagem VARCHAR(255) NULL,
      trial_date DATE NOT NULL,
      expires_at DATETIME NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_free_trial_client_day (client_key,trial_date),
      UNIQUE KEY uk_free_trial_codigo (codigo_voucher),
      INDEX idx_free_trials_client (client_key),
      INDEX idx_free_trials_status (status,expires_at)
    ) ENGINE=InnoDB`);
    // Upgrade older installations one column at a time. Existing values are
    // preserved; defaults only apply to newly added fields/records.
    await ensureColumns(c, 'pacotes', {
      perfil_mikrotik: "VARCHAR(80) NOT NULL DEFAULT 'default'",
      ordem: 'INT NOT NULL DEFAULT 0', ativo: 'TINYINT(1) NOT NULL DEFAULT 1',
      stock_minimo: 'INT NOT NULL DEFAULT 10', stock_alvo: 'INT NOT NULL DEFAULT 30',
      auto_stock_enabled: 'TINYINT(1) NOT NULL DEFAULT 1',
      criado_em: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    });
    await ensureColumns(c, 'vouchers', {
      telefone_cliente: 'VARCHAR(20) NULL', mac_cliente: 'VARCHAR(80) NULL', ip_cliente: 'VARCHAR(80) NULL',
      link_origem: 'VARCHAR(255) NULL', payment_provider: 'VARCHAR(30) NULL',
      status: "ENUM('disponivel','pendente','pago','usado','cancelado') NOT NULL DEFAULT 'disponivel'",
      status_mensagem: 'VARCHAR(255) NULL', transacao_id: 'VARCHAR(80) NULL', mikrotik_user_id: 'VARCHAR(80) NULL',
      mikrotik_synced_at: 'DATETIME NULL', mikrotik_sync_status: "ENUM('pendente','sincronizado','erro') NOT NULL DEFAULT 'pendente'",
      mikrotik_sync_erro: 'TEXT NULL', mikrotik_sync_em: 'DATETIME NULL', mikrotik_error: 'VARCHAR(255) NULL',
      mikrotik_login_at: 'DATETIME NULL', mikrotik_login_message: 'VARCHAR(255) NULL', reservado_em: 'DATETIME NULL',
      pago_em: 'DATETIME NULL', usado_em: 'DATETIME NULL', data_criacao: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    });
    await ensureColumns(c, 'payment_events', {
      provider: 'VARCHAR(30) NULL', reference: 'VARCHAR(80) NULL', status: 'VARCHAR(80) NULL',
      payload: 'JSON NULL', created_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    });
    await ensureColumns(c, 'free_trials', {
      client_key: 'VARCHAR(120) NULL', mac_cliente: 'VARCHAR(80) NULL', ip_cliente: 'VARCHAR(80) NULL',
      link_origem: 'VARCHAR(255) NULL', codigo_voucher: 'VARCHAR(80) NULL', senha_voucher: 'VARCHAR(80) NULL',
      mikrotik_user_id: 'VARCHAR(80) NULL', status: "ENUM('ativo','expirado','erro') NOT NULL DEFAULT 'ativo'",
      status_mensagem: 'VARCHAR(255) NULL', trial_date: 'DATE NULL', expires_at: 'DATETIME NULL',
      criado_em: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP', atualizado_em: 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP'
    });
    const tables = [
      `roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL UNIQUE)`,
      `permissions (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE)`,
      `role_permissions (role_id INT NOT NULL, permission_id INT NOT NULL, PRIMARY KEY(role_id,permission_id), FOREIGN KEY(role_id) REFERENCES roles(id), FOREIGN KEY(permission_id) REFERENCES permissions(id))`,
      `admin_users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, username VARCHAR(60) NOT NULL UNIQUE, email VARCHAR(190) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role_id INT NOT NULL, status ENUM('ativo','desativado') NOT NULL DEFAULT 'ativo', failed_attempts INT NOT NULL DEFAULT 0, locked_until DATETIME NULL, last_login_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY(role_id) REFERENCES roles(id))`,
      `admin_sessions (id CHAR(36) PRIMARY KEY, admin_user_id INT NOT NULL, ip_address VARCHAR(45), user_agent VARCHAR(255), expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(admin_user_id,revoked_at), FOREIGN KEY(admin_user_id) REFERENCES admin_users(id))`,
      `refresh_tokens (id BIGINT AUTO_INCREMENT PRIMARY KEY, session_id CHAR(36) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, used_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(session_id) REFERENCES admin_sessions(id))`,
      `audit_logs (id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_user_id INT NULL, action VARCHAR(80) NOT NULL, resource VARCHAR(80) NOT NULL, resource_id VARCHAR(80), old_data JSON NULL, new_data JSON NULL, ip_address VARCHAR(45), user_agent VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(admin_user_id), FOREIGN KEY(admin_user_id) REFERENCES admin_users(id))`,
      `report_exports (id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_user_id INT NOT NULL, format VARCHAR(10) NOT NULL, filters JSON NOT NULL, row_count INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(admin_user_id) REFERENCES admin_users(id))`,
      `admin_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const table of tables) await c.query(`CREATE TABLE IF NOT EXISTS ${table} ENGINE=InnoDB`);
    await c.beginTransaction();
    const [done] = await c.query("SELECT name FROM admin_migrations WHERE name='001_rbac'");
    if (!done.length) {
      for (const permission of permissions) await c.execute('INSERT IGNORE INTO permissions(name) VALUES (?)',[permission]);
      for (const [role, grants] of Object.entries(roleDefaults)) {
        await c.execute('INSERT IGNORE INTO roles(name) VALUES (?)',[role]);
        for (const p of grants) await c.execute('INSERT IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.name=? WHERE r.name=?',[p,role]);
      }
      await c.execute("INSERT INTO admin_migrations(name) VALUES ('001_rbac')");
    }
    await c.commit();
  } catch(e) { await c.rollback(); throw e; }
  finally { await c.query("SELECT RELEASE_LOCK('eyazs_admin_migration')"); c.release(); }
}

async function ensureColumns(connection, table, definitions) {
  const [existing] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.db.database, table]
  );
  const names = new Set(existing.map(column => column.COLUMN_NAME));
  for (const [column, definition] of Object.entries(definitions)) {
    if (!names.has(column)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  }
}
