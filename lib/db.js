const mysql = require('mysql2/promise');

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

let connectionConfig;

if (dbUrl) {
  // Parsing de l'URL Aiven
  const parsedUrl = new URL(dbUrl);
  connectionConfig = {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
    user: parsedUrl.username,
    password: parsedUrl.password,
    database: parsedUrl.pathname.replace('/', '') || 'defaultdb',
    ssl: { rejectUnauthorized: false }, // Requis pour Aiven MySQL
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
} else {
  // Configuration fallback via variables individuelles
  connectionConfig = {
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306,
    user: process.env.MYSQL_USER || 'avnadmin',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'defaultdb',
    ssl: process.env.MYSQL_SSL === 'false' ? false : { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

// Sécurité : vérifier qu'un hôte est bien configuré avant de tenter de se connecter
if (!connectionConfig.host || connectionConfig.host === 'localhost' || connectionConfig.host === '127.0.0.1') {
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️ ATTENTION : Aucune variable d\'environnement Aiven (MYSQL_URL / MYSQL_HOST) n\'a été détectée sur Render !');
  }
}

const pool = mysql.createPool(connectionConfig);

async function ensureSchema() {
  try {
    const connection = await pool.getConnection();

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(64) NOT NULL UNIQUE,
        username VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(64) PRIMARY KEY,
        data LONGTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS connection_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_configs (
        user_id INT PRIMARY KEY,
        fivem_enabled TINYINT(1) DEFAULT 0,
        fivem_url VARCHAR(255) DEFAULT '',
        blur_val INT DEFAULT 10,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INT PRIMARY KEY,
        customer_id VARCHAR(128) DEFAULT '',
        plan_type VARCHAR(64) DEFAULT 'free',
        is_active TINYINT(1) DEFAULT 1,
        auto_renew TINYINT(1) DEFAULT 0,
        opt_fivem TINYINT(1) DEFAULT 0,
        opt_priority TINYINT(1) DEFAULT 0,
        opt_backups TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    connection.release();
    console.log('✅ Schéma MySQL Aiven vérifié et prêt.');
  } catch (err) {
    console.error('❌ Erreur de connexion/schéma MySQL Aiven :', err.message);
    throw err; // Permet de remonter l'erreur si la BDD est obligatoire
  }
}

module.exports = { pool, ensureSchema };
