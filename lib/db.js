const mysql = require('mysql2/promise');

// ── Pool MySQL partagé (settings, sessions, tickets, users, logs) ──────
const DB_HOST = process.env.DB_HOST || process.env.MYSQL_ADDON_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || process.env.MYSQL_ADDON_PORT || '3306';
const DB_USER = process.env.DB_USER || process.env.MYSQL_ADDON_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQL_ADDON_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || process.env.MYSQL_ADDON_DB || 'dashboard_db';

const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

// Ajoute une colonne si elle n'existe pas déjà (on catch l'erreur "colonne
// déjà existante" (code 1060) plutôt que de dépendre de la version MySQL).
async function addColumnIfMissing(table, columnDef) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (err.errno !== 1060) throw err; // 1060 = Duplicate column name
  }
}

async function addIndexIfMissing(table, indexName, columns) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columns})`);
  } catch (err) {
    if (err.errno !== 1061 && err.errno !== 1831) throw err; // duplicate key name
  }
}

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    // ── Stockage clé/valeur générique ──────────────────────────────
    // Contient désormais DEUX types de clés :
    //  - 'global_settings' : config unique de l'app (app OAuth Discord utilisée
    //    pour la connexion, secret de session). Un seul jeu pour tout le monde.
    //  - 'tenant:<id>' : config PROPRE à chaque client (bot Discord, ticket
    //    types, abonnement, liste d'admins). Une ligne par client.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        \`key\` VARCHAR(191) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Tenants (= un client = un dashboard/bot isolé) ─────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_discord_id VARCHAR(32) NOT NULL,
        name VARCHAR(191) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_owner (owner_discord_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Qui a le droit d'administrer quel tenant ───────────────────
    // (remplace l'ancienne liste globale settings.auth.adminIds : chaque
    // admin est désormais rattaché à UN SEUL tenant, jamais à "tout".)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_admins (
        tenant_id INT NOT NULL,
        discord_id VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, discord_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addIndexIfMissing('tenant_admins', 'idx_discord_id', 'discord_id');

    // ── Tickets -> scopés par tenant_id ─────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(32) PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        data LONGTEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Si la table existait déjà avant ce patch (installations existantes).
    await addColumnIfMissing('tickets', 'tenant_id INT NOT NULL DEFAULT 0');
    await addIndexIfMissing('tickets', 'idx_tenant_id', 'tenant_id');

    // ── Comptes web (login Discord OAuth2) + logs de connexion ──────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL UNIQUE,
        tenant_id INT DEFAULT NULL,
        username VARCHAR(191),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing('users', 'tenant_id INT DEFAULT NULL');
    await addIndexIfMissing('users', 'idx_tenant_id', 'tenant_id');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS connection_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        event_type VARCHAR(16) NOT NULL,
        ip_address VARCHAR(64),
        user_agent VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // user_configs (FiveM) était déjà correctement scopé par user_id -> on
    // le laisse tel quel, ce n'était pas la source de la fuite.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_configs (
        user_id INT PRIMARY KEY,
        fivem_enabled TINYINT(1) NOT NULL DEFAULT 0,
        fivem_url VARCHAR(255),
        blur_val INT NOT NULL DEFAULT 5,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ── Codes clients ────────────────────────────────────────────
    // + colonne tenant_id : renseignée au moment où le code est consommé,
    // pour tracer quel tenant a été créé par quel code.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_codes (
        code VARCHAR(32) PRIMARY KEY,
        plan_type VARCHAR(32) DEFAULT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        used_by_discord_id VARCHAR(32) DEFAULT NULL,
        used_by_username VARCHAR(191) DEFAULT NULL,
        tenant_id INT DEFAULT NULL,
        used_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing('customer_codes', 'tenant_id INT DEFAULT NULL');

    const DEFAULT_CUSTOMER_CODES = [
      'TCKT-PNCE-EFDU-3R5F',
      'TCKT-6UAH-ECLC-YZX3',
      'TCKT-YE3K-QR55-46H5',
      'TCKT-7L8J-6A6G-SP33',
      'TCKT-LU8G-4JYK-ELSC',
      'TCKT-G8RQ-NTN3-2TL7',
      'TCKT-DR85-6ALZ-TBZ8',
      'TCKT-M4D3-HRQH-8ABT',
      'TCKT-L6QG-H8TR-FDDN',
      'TCKT-TCXR-FSZ5-ZWX4',
      'TCKT-5PNW-QMLZ-A9Z4',
      'TCKT-GBNL-KWGL-D3LL',
      'TCKT-AM7L-WXJ6-69M5',
      'TCKT-H2UJ-HJA9-XCKE',
      'TCKT-ZMQ2-UD7R-DDEZ',
      'TCKT-MMMD-E8TS-MJ9V',
      'TCKT-3URA-T5N5-2WE8',
      'TCKT-8VAT-MRXC-9KHH',
      'TCKT-HTMF-Z5HX-ZV9M',
      'TCKT-Q24D-2Q3V-DKCZ',
    ];
    for (const code of DEFAULT_CUSTOMER_CODES) {
      await pool.query('INSERT IGNORE INTO customer_codes (code) VALUES (?)', [code]);
    }

    console.log('🗄️  Schéma MySQL vérifié/créé (multi-tenant).');
  })();

  return schemaReady;
}

module.exports = { pool, ensureSchema, addColumnIfMissing, addIndexIfMissing };
