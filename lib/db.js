const mysql = require('mysql2/promise');

// ── Pool MySQL partagé (settings, sessions, tickets, users, logs) ──────
// C'est LA source de vérité pour tout ce qui doit survivre à un redeploy
// ou un redémarrage du conteneur (le disque local est éphémère).
//
// Compatible avec deux façons de configurer la DB :
//  - Variables génériques DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
//    (Render + Aiven, ou toute DB externe manuelle)
//  - Variables auto-injectées par Clever Cloud quand tu lies un addon MySQL
//    à ton appli : MYSQL_ADDON_HOST / MYSQL_ADDON_PORT / MYSQL_ADDON_USER /
//    MYSQL_ADDON_PASSWORD / MYSQL_ADDON_DB (aucune config manuelle requise).
const DB_HOST = process.env.DB_HOST || process.env.MYSQL_ADDON_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || process.env.MYSQL_ADDON_PORT || '3306';
const DB_USER = process.env.DB_USER || process.env.MYSQL_ADDON_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQL_ADDON_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || process.env.MYSQL_ADDON_DB || 'dashboard_db';

// DB_SSL=true si ton hébergeur MySQL l'exige (ex: Aiven) — sinon laisse
// vide/false (Clever Cloud n'en a pas besoin par défaut, une DB locale non plus).
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

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    // Stockage clé/valeur générique -> remplace data/settings.json (fichier local
    // qui disparaît à chaque redeploy Render car non commité, cf .gitignore).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        \`key\` VARCHAR(191) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Tickets -> remplace data/tickets.json (même souci de persistance).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(32) PRIMARY KEY,
        data LONGTEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Comptes web (login Discord OAuth2) + logs de connexion.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL UNIQUE,
        username VARCHAR(191),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_configs (
        user_id INT PRIMARY KEY,
        fivem_enabled TINYINT(1) NOT NULL DEFAULT 0,
        fivem_url VARCHAR(255),
        blur_val INT NOT NULL DEFAULT 5,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('🗄️  Schéma MySQL vérifié/créé.');
  })();

  return schemaReady;
}

module.exports = { pool, ensureSchema };
