require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { ensureSchema } = require('./lib/db');
const store = require('./lib/store');

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

// ── Blindage process ──────────────────────────────────────────
// Une erreur non catchée ailleurs (route dashboard, requête SQL, etc.)
// ne doit JAMAIS tuer tout le process — sinon le bot Discord (qui tourne
// dans le même process) meurt avec elle. On loggue et on continue.
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException (process maintenu en vie):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection (process maintenu en vie):', reason);
});

async function main() {
  console.log('🔌 Connexion à MySQL et vérification du schéma…');
  await ensureSchema();

  console.log('⚙️  Chargement des settings…');
  await store.init();

  // bot.js et dashboard/server.js dépendent du store initialisé ci-dessus,
  // on ne les require qu'après pour être sûr que store.init() est déjà passé.
  const createDashboardServer = require('./dashboard/server');
  const bot = require('./lib/bot');

  const app = createDashboardServer();
  app.use(cors());
  app.use(express.json());

  const server = app.listen(PORT, HOST, () => {
    console.log(`🖥️  Dashboard disponible sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (!store.hasAuthApp()) {
      console.log('👉 Ouvre le dashboard pour configurer la connexion via Discord (/setup).');
    }
  });

  // ── Démarrage du bot, indépendant du dashboard ──────────────────
  // Le bot n'est jamais démarré/arrêté en fonction du dashboard : il tourne
  // tant que le process Node tourne, que quelqu'un consulte le dashboard ou non.
  if (store.getBot().token) {
    await bot.start();
  } else {
    console.log('🔑 Aucun token configuré — renseigne-le depuis l\'onglet "Connexion bot" du dashboard.');
  }

  // ── Watchdog de reconnexion ──────────────────────────────────────
  // Si le bot tombe en erreur/hors ligne alors qu'un token est configuré,
  // on retente automatiquement au lieu de rester mort jusqu'au prochain
  // redeploy manuel. Backoff simple pour ne pas spammer l'API Discord.
  let watchdogBackoffMs = 15_000;
  const scheduleWatchdog = () => {
    setTimeout(async () => {
      const bStatus = bot.getStatus().status;
      const hasToken = !!store.getBot().token;
      if (hasToken && (bStatus === 'offline' || bStatus === 'error')) {
        console.log(`🔄 Watchdog : bot ${bStatus}, tentative de reconnexion…`);
        try {
          await bot.start();
          watchdogBackoffMs = 15_000;
        } catch (err) {
          console.error('Watchdog: échec de reconnexion:', err.message);
          watchdogBackoffMs = Math.min(watchdogBackoffMs * 2, 5 * 60_000);
        }
      } else {
        watchdogBackoffMs = 15_000;
      }
      scheduleWatchdog();
    }, watchdogBackoffMs);
  };
  scheduleWatchdog();

  // ── Arrêt propre ─────────────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n👋 Signal ${signal} reçu, arrêt en cours…`);
    server.close();
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Échec fatal au démarrage:', err);
  process.exit(1);
});
