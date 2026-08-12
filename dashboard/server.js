const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const store = require('../lib/store');
const bot = require('../lib/bot');
const { pool: db } = require('../lib/db');

const VIEWS_DIR = __dirname;
const DISCORD_API = 'https://discord.com/api/v10';

// ── Sessions stockées en MySQL ───────────────────────────────
// Avant : session-file-store écrivait sur le disque local du conteneur,
// qui est réinitialisé à chaque redeploy/redémarrage Render → tout le monde
// était déconnecté et devait tout reconfigurer. Maintenant les sessions
// (donc les connexions Discord des admins) survivent aux redeploys.
const sessionStore = new MySQLStore({}, db);

function readView(name) {
  return fs.readFileSync(path.join(VIEWS_DIR, 'public', name), 'utf8');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.discordUser && store.isAdmin(req.session.discordUser.id)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

function requireNoAuthAppYet(req, res, next) {
  if (!store.hasAuthApp()) return next();
  return res.redirect('/login');
}

function requireAuthAppSet(req, res, next) {
  if (store.hasAuthApp()) return next();
  return res.redirect('/setup');
}

// Les tickets vivent désormais en MySQL (table `tickets`, gérée par
// lib/ticketManager.js) plutôt que dans data/tickets.json.
async function readTickets() {
  try {
    const [rows] = await db.query('SELECT data FROM tickets ORDER BY created_at DESC');
    return rows.map((r) => JSON.parse(r.data));
  } catch (err) {
    console.error('Erreur lecture tickets MySQL:', err.message);
    return [];
  }
}

async function computeStats() {
  const tickets = await readTickets();
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === 'open').length;
  const closed = tickets.filter((t) => t.status === 'closed').length;

  const byType = {};
  for (const t of tickets) {
    byType[t.typeId] = (byType[t.typeId] || 0) + 1;
  }

  const closedWithDuration = tickets.filter((t) => t.status === 'closed' && t.createdAt && t.closedAt);
  const avgResolutionMs = closedWithDuration.length
    ? closedWithDuration.reduce((sum, t) => sum + (t.closedAt - t.createdAt), 0) / closedWithDuration.length
    : null;

  const claimedCount = tickets.filter((t) => t.claimedBy).length;
  const unclaimedOpen = tickets.filter((t) => t.status === 'open' && !t.claimedBy).length;

  const recent = [...tickets]
    .sort((a, b) => (b.closedAt || b.createdAt || 0) - (a.closedAt || a.createdAt || 0))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      userTag: t.userTag,
      typeId: t.typeId,
      status: t.status,
      createdAt: t.createdAt,
      closedAt: t.closedAt || null,
      claimedByTag: t.claimedByTag || null,
    }));

  return { total, open, closed, byType, avgResolutionMs, claimedCount, unclaimedOpen, recent };
}

function toCsv(tickets) {
  const headers = ['id', 'userTag', 'userId', 'typeId', 'status', 'claimedByTag', 'createdAt', 'closedAt', 'closedBy'];
  const rows = tickets.map((t) =>
    headers
      .map((h) => {
        const v = t[h] ?? '';
        const s = String(v).replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

function createDashboardServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(
    session({
      store: sessionStore,
      secret: store.getSessionSecret(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: 'lax',
      },
    })
  );

  app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

  // ── Healthcheck ──────────────────────────────────────────
  // À pinger toutes les 5-10 min par un service externe gratuit (UptimeRobot,
  // cron-job.org...) pour empêcher Render de mettre le service en veille sur
  // le plan gratuit. Sans requête HTTP entrante, Render endort le process
  // après ~15 min d'inactivité, ce qui coupe le bot avec.
  app.get('/healthz', (req, res) => {
    res.json({ ok: true, bot: bot.getStatus().status, uptime: process.uptime() });
  });

  // ── Routing racine ─────────────────────────────────────
  app.get('/', (req, res) => {
    if (!store.hasAuthApp()) return res.redirect('/setup');
    if (!req.session.discordUser || !store.isAdmin(req.session.discordUser.id)) return res.redirect('/login');
    return res.redirect('/dashboard');
  });

  // ── Setup ──────────────────────────────────────────────
  app.get('/setup', requireNoAuthAppYet, (req, res) => {
    res.type('html').send(readView('setup.html'));
  });

  app.get('/api/setup/default-redirect', requireNoAuthAppYet, (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    res.json({ redirectUri: `${proto}://${req.get('host')}/api/auth/discord/callback` });
  });

  app.post('/api/setup', requireNoAuthAppYet, (req, res) => {
    const { clientId, clientSecret, redirectUri } = req.body || {};
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(400).json({ error: "Client ID, Client Secret et Redirect URI sont obligatoires." });
    }
    store.setAuthConfig({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: redirectUri.trim() });
    res.json({ ok: true });
  });

  // ── Login via Discord OAuth2 ────────────────────────────
  app.get('/login', requireAuthAppSet, (req, res) => {
    if (req.session.discordUser && store.isAdmin(req.session.discordUser.id)) return res.redirect('/dashboard');
    res.type('html').send(readView('login.html'));
  });

  app.get('/api/auth/discord', requireAuthAppSet, (req, res) => {
    const { clientId, redirectUri } = store.getAuthConfig();
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'consent');
    res.redirect(url.toString());
  });

  app.get('/api/auth/discord/callback', requireAuthAppSet, async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res.type('html').send(authErrorPage('Requête invalide ou expirée. Réessaie de te connecter.'));
    }
    delete req.session.oauthState;

    const { clientId, clientSecret, redirectUri } = store.getAuthConfig();

    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error(`Échange du code refusé par Discord (${tokenRes.status})`);
      const tokenData = await tokenRes.json();

      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) throw new Error("Impossible de récupérer ton profil Discord.");
      const user = await userRes.json();

      const isFirstEver = !store.hasAnyAdmin();
      if (isFirstEver) {
        store.addAdmin(user.id);
      }

      if (!store.isAdmin(user.id)) {
        return res.type('html').send(authErrorPage("Ton compte Discord n'a pas accès à ce dashboard. Demande à un administrateur existant de t'ajouter."));
      }

      req.session.discordUser = {
        id: user.id,
        username: user.global_name || user.username,
        handle: user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
          : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`,
      };

      // ── SAUVEGARDE EN BASE DE DONNÉES (SQL) ────────────────
      try {
        // 1. Ajouter ou Mettre à jour l'utilisateur
        await db.query(
          `INSERT INTO users (discord_id, username) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE username = VALUES(username)`,
          [user.id, user.global_name || user.username]
        );

        // Récupérer l'ID de l'utilisateur en BDD
        const [userRows] = await db.query('SELECT id FROM users WHERE discord_id = ?', [user.id]);
        const dbUserId = userRows[0].id;
        req.session.discordUser.dbId = dbUserId;

        // 2. Enregistrer le log de connexion
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await db.query(
          `INSERT INTO connection_logs (user_id, event_type, ip_address, user_agent) VALUES (?, 'LOGIN', ?, ?)`,
          [dbUserId, ip, req.headers['user-agent'] || '']
        );
      } catch (sqlErr) {
        console.error('Erreur SQL lors de la connexion :', sqlErr.message);
      }

      res.redirect('/dashboard');
    } catch (err) {
      console.error('Erreur OAuth Discord:', err.message);
      res.type('html').send(authErrorPage(`Connexion Discord échouée : ${err.message}`));
    }
  });

  app.post('/api/logout', async (req, res) => {
    if (req.session.discordUser && req.session.discordUser.dbId) {
      try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await db.query(
          `INSERT INTO connection_logs (user_id, event_type, ip_address, user_agent) VALUES (?, 'LOGOUT', ?, ?)`,
          [req.session.discordUser.dbId, ip, req.headers['user-agent'] || '']
        );
      } catch (sqlErr) {
        console.error('Erreur SQL Déconnexion :', sqlErr.message);
      }
    }
    req.session.destroy(() => res.json({ ok: true }));
  });

  // ── Dashboard (protégé) ────────────────────────────────
  app.get('/dashboard', requireAuthAppSet, requireAuth, (req, res) => {
    res.type('html').send(readView('dashboard.html'));
  });

  // ── API protégée ────────────────────────────────────────
  const api = express.Router();
  api.use(requireAuth);

  api.get('/me', (req, res) => {
    res.json({ user: req.session.discordUser, admins: store.getAuthConfig().adminIds });
  });

  // ── 🔧 ROUTES API FIVEM & CONFIGURATION SQL ─────────────

  // Obtenir la configuration utilisateur depuis SQL
  api.get('/fivem/config', async (req, res) => {
    try {
      const dbUserId = req.session.discordUser.dbId;
      const [rows] = await db.query('SELECT fivem_enabled, fivem_url, blur_val FROM user_configs WHERE user_id = ?', [dbUserId]);
      if (rows.length > 0) {
        return res.json({
          enabled: Boolean(rows[0].fivem_enabled),
          url: rows[0].fivem_url,
          blurVal: rows[0].blur_val
        });
      }
      res.json({ enabled: false, url: '', blurVal: 5 });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erreur serveur lors de la récupération SQL." });
    }
  });

  // Sauvegarder la configuration FiveM dans SQL
  api.post('/fivem/config', async (req, res) => {
    try {
      const dbUserId = req.session.discordUser.dbId;
      const { enabled, url } = req.body;

      await db.query(`
        INSERT INTO user_configs (user_id, fivem_enabled, fivem_url)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE fivem_enabled = VALUES(fivem_enabled), fivem_url = VALUES(fivem_url)
      `, [dbUserId, enabled ? 1 : 0, url || '']);

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Impossible d'enregistrer la configuration dans MySQL." });
    }
  });

  // Liste des bannis FiveM (depuis le serveur FiveM ou données par défaut)
  api.get('/fivem/bans', async (req, res) => {
    try {
      const dbUserId = req.session.discordUser.dbId;
      const [rows] = await db.query('SELECT fivem_url FROM user_configs WHERE user_id = ?', [dbUserId]);

      if (!rows.length || !rows[0].fivem_url) {
        return res.json([]);
      }

      // Exemple : Si vous avez un endpoint d'API externe sur votre serveur FiveM pour récupérer les bans :
      /*
      const fetch = require('node-fetch');
      const response = await fetch(`${rows[0].fivem_url}/bans.json`);
      const bans = await response.json();
      return res.json(bans);
      */

      // Envoi de données si tout est configuré correctement
      res.json([]);
    } catch (err) {
      res.status(500).json({ error: "Erreur lors de la récupération des bannis." });
    }
  });

  // ── Routes d'origine de l'application ─────────────────
  api.get('/status', (req, res) => {
    res.json(bot.getStatus());
  });

  api.get('/settings', (req, res) => {
    const b = store.getBot();
    res.json({
      bot: { ...b, token: b.token ? maskToken(b.token) : '' },
      hasToken: !!b.token,
      ticketTypes: store.getTicketTypes(),
    });
  });

  api.post('/settings/bot', async (req, res) => {
    const patch = { ...req.body };
    if (patch.token && patch.token.includes('•')) delete patch.token;
    const updated = store.setBot(patch);
    res.json({ ok: true, bot: { ...updated, token: updated.token ? maskToken(updated.token) : '' } });
  });

  api.post('/settings/ticket-types', (req, res) => {
    const types = req.body?.ticketTypes;
    if (!Array.isArray(types)) return res.status(400).json({ error: 'Format invalide.' });

    for (const t of types) {
      if (!t.id || !t.label || !t.emoji) {
        return res.status(400).json({ error: 'Chaque type de ticket doit avoir un id, un label et un emoji.' });
      }
    }
    const ids = types.map((t) => t.id);
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Les identifiants de types de tickets doivent être uniques.' });
    }

    const saved = store.setTicketTypes(types);
    res.json({ ok: true, ticketTypes: saved });
  });

  api.post('/bot/restart', async (req, res) => {
    await bot.restart();
    res.json({ ok: true, status: bot.getStatus() });
  });

  api.post('/bot/refresh-panel', async (req, res) => {
    await bot.refreshPanel();
    res.json({ ok: true });
  });

  api.get('/discord/guilds', async (req, res) => {
    if (!bot.client || bot.status !== 'online') return res.json([]);
    const guilds = [...bot.client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name }));
    res.json(guilds);
  });

  api.get('/discord/guilds/:guildId/channels', async (req, res) => {
    if (!bot.client || bot.status !== 'online') return res.json([]);
    try {
      const guild = await bot.client.guilds.fetch(req.params.guildId);
      const channels = await guild.channels.fetch();
      const textChannels = [...channels.values()]
        .filter((c) => c && c.type === 0)
        .map((c) => ({ id: c.id, name: c.name }));
      res.json(textChannels);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/discord/guilds/:guildId/categories', async (req, res) => {
    if (!bot.client || bot.status !== 'online') return res.json([]);
    try {
      const guild = await bot.client.guilds.fetch(req.params.guildId);
      const channels = await guild.channels.fetch();
      const categories = [...channels.values()]
        .filter((c) => c && c.type === 4)
        .map((c) => ({ id: c.id, name: c.name }));
      res.json(categories);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/discord/guilds/:guildId/roles', async (req, res) => {
    if (!bot.client || bot.status !== 'online') return res.json([]);
    try {
      const guild = await bot.client.guilds.fetch(req.params.guildId);
      const roles = await guild.roles.fetch();
      const list = [...roles.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
      res.json(list);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/stats', async (req, res) => {
    res.json(await computeStats());
  });

  api.get('/tickets/export.csv', async (req, res) => {
    const tickets = await readTickets();
    const csv = toCsv(tickets);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${Date.now()}.csv"`);
    res.send(csv);
  });

  api.get('/admins', (req, res) => {
    res.json({ adminIds: store.getAuthConfig().adminIds, selfId: req.session.discordUser.id });
  });

  api.post('/admins', (req, res) => {
    const id = String(req.body?.discordId || '').trim();
    if (!/^\d{15,25}$/.test(id)) return res.status(400).json({ error: "ID Discord invalide (identifiant numérique attendu)." });
    store.addAdmin(id);
    res.json({ ok: true, adminIds: store.getAuthConfig().adminIds });
  });

  api.delete('/admins/:id', (req, res) => {
    const { adminIds } = store.getAuthConfig();
    if (adminIds.length <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
    store.removeAdmin(req.params.id);
    res.json({ ok: true, adminIds: store.getAuthConfig().adminIds });
  });

  app.use('/api', api);

  return app;
}

function maskToken(token) {
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 6)}${'•'.repeat(18)}${token.slice(-4)}`;
}

function authErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Connexion refusée</title>
<link rel="stylesheet" href="/assets/css/style.css"></head>
<body><div class="auth-page"><div class="auth-card">
<div class="auth-logo">🎫</div>
<h1>Connexion refusée</h1>
<div class="auth-error show">${message.replace(/</g, '&lt;')}</div>
<a class="btn-primary" style="display:block;text-align:center;text-decoration:none;" href="/login">Retour à la connexion</a>
</div></div></body></html>`;
}

module.exports = createDashboardServer;
