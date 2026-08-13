const mysql = require('mysql2/promise');

// Lecture adaptative des variables Render (DB_*) ou standard (MYSQL_*)
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

let connectionConfig;

if (dbUrl) {
  const parsedUrl = new URL(dbUrl);
  connectionConfig = {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
    user: parsedUrl.username,
    password: parsedUrl.password,
    database: parsedUrl.pathname.replace('/', '') || 'defaultdb',
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
} else {
  const host = process.env.DB_HOST || process.env.MYSQL_HOST;
  const port = process.env.DB_PORT || process.env.MYSQL_PORT || 3306;
  const user = process.env.DB_USER || process.env.MYSQL_USER || 'avnadmin';
  const password = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '';
  const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'defaultdb';
  const sslValue = process.env.DB_SSL || process.env.MYSQL_SSL;

  connectionConfig = {
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
    ssl: sslValue === 'false' ? false : { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
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
  }
}

module.exports = { pool, ensureSchema };
