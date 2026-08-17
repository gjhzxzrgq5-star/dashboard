require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { ensureSchema, pool } = require('./lib/db');
const { globalStore, tenantManager } = require('./lib/store');
const botManager = require('./lib/botManager');
const statusBotManager = require('./lib/statusBot');
const { startKeepAlive } = require('./lib/keepAlive');

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException (process maintenu en vie):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection (process maintenu en vie):', reason);
});

// Démarre le bot Discord de CHAQUE tenant qui a un token configuré.
// Remplace l'ancien démarrage d'un unique bot global : chaque client a
// désormais son propre bot, avec son propre token (cf. décision produit).
async function startAllTenantBots() {
  const [rows] = await pool.query('SELECT id FROM tenants');
  let started = 0;
  for (const row of rows) {
    try {
      const store = await tenantManager.getStore(row.id);
      if (store.getBot().token) {
        const controller = botManager.get(row.id, store);
        await controller.start();
        started += 1;
      }
    } catch (err) {
      console.error(`❌ Échec démarrage bot du tenant ${row.id}:`, err.message);
    }
  }
  console.log(`🤖 ${started} bot(s) client démarré(s) sur ${rows.length} tenant(s) au total.`);
}

// Démarre le bot status FiveM de chaque tenant qui a un token configuré
// (application Discord distincte du bot principal, cf. lib/statusBot.js).
async function startAllStatusBots() {
  const [rows] = await pool.query('SELECT id FROM tenants');
  let started = 0;
  for (const row of rows) {
    try {
      const store = await tenantManager.getStore(row.id);
      if (store.getStatusBot().token) {
        const controller = statusBotManager.get(row.id, store);
        await controller.start();
        started += 1;
      }
    } catch (err) {
      console.error(`❌ Échec démarrage bot status du tenant ${row.id}:`, err.message);
    }
  }
  console.log(`📡 ${started} bot(s) status démarré(s) sur ${rows.length} tenant(s) au total.`);
}

async function main() {
  console.log('🔌 Connexion à MySQL et vérification du schéma…');
  await ensureSchema();

  console.log('⚙️  Chargement des settings globaux…');
  await globalStore.init();

  // Migration : rattache les tenants créés avant le système "1 appli
  // Discord par client" à l'ancienne appli globale (cf. lib/store.js).
  if (globalStore.hasAuthApp()) {
    await tenantManager.migrateLegacyTenantsWithoutApp(globalStore.getAuthConfig());
  }

  const createDashboardServer = require('./dashboard/server');

  const app = createDashboardServer();
  app.use(cors());
  app.use(express.json());

  const server = app.listen(PORT, HOST, () => {
    console.log(`🖥️  Dashboard disponible sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log('👉 Chaque client crée son propre espace (sa propre appli Discord) via /setup.');
  });

  startKeepAlive();

  await startAllTenantBots();
  await startAllStatusBots();

  // ── Watchdog : relance le bot de chaque tenant tombé en erreur ────
  let watchdogBackoffMs = 15_000;
  const scheduleWatchdog = () => {
    setTimeout(async () => {
      let anyRetried = false;
      for (const controller of botManager.allControllers()) {
        const bStatus = controller.getStatus().status;
        const hasToken = !!controller.store.getBot().token;
        if (hasToken && (bStatus === 'offline' || bStatus === 'error')) {
          console.log(`🔄 Watchdog [tenant ${controller.tenantId}] : bot ${bStatus}, tentative de reconnexion…`);
          anyRetried = true;
          try {
            await controller.start();
          } catch (err) {
            console.error(`Watchdog [tenant ${controller.tenantId}]: échec de reconnexion:`, err.message);
          }
        }
      }
      for (const controller of statusBotManager.allControllers()) {
        const sStatus = controller.getStatus().status;
        const hasToken = !!controller.store.getStatusBot().token;
        if (hasToken && (sStatus === 'offline' || sStatus === 'error')) {
          console.log(`🔄 Watchdog [tenant ${controller.tenantId}] : bot status ${sStatus}, tentative de reconnexion…`);
          anyRetried = true;
          try {
            await controller.start();
          } catch (err) {
            console.error(`Watchdog [tenant ${controller.tenantId}]: échec de reconnexion (bot status):`, err.message);
          }
        }
      }
      watchdogBackoffMs = anyRetried ? Math.min(watchdogBackoffMs * 2, 5 * 60_000) : 15_000;
      scheduleWatchdog();
    }, watchdogBackoffMs);
  };
  scheduleWatchdog();

  const shutdown = async (signal) => {
    console.log(`\n👋 Signal ${signal} reçu, arrêt en cours…`);
    server.close();
    await botManager.stopAll();
    await statusBotManager.stopAll();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Échec fatal au démarrage:', err);
  process.exit(1);
});
