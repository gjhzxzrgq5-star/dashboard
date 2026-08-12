const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const store = require('../lib/store');
const bot = require('../lib/bot');

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const VIEWS_DIR = __dirname;
const TICKETS_FILE = path.join(__dirname, '..', 'data', 'tickets.json');

const DISCORD_API = 'https://discord.com/api/v10';

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

function readTickets() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function computeStats() {
  const tickets = readTickets();
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === 'open').length;
  const closed = tickets.filter((t) => t.status === 'closed').length;

  const byType = {};
  for (const t of tickets) {
    byType[t.typeId] = (byType[t.typeId] || 0) + 1;
  }

  const claimTimes = tickets
    .filter((t) => t.claimedBy && t.createdAt)
    .map((t) => null); // claim timestamp isn't tracked individually; kept for future extension

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
      store: new FileStore({
        path: SESSIONS_DIR,
        ttl: 60 * 60 * 24 * 30, // 30 jours (en secondes pour session-file-store)
        retries: 1,
        logFn: () => {}, // évite le spam dans la console
      }),
      secret: store.getSessionSecret(),
      resave: false,
      saveUninitialized: false,
      rolling: true, // prolonge la session à chaque visite (renouvelle les 30 jours)
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 jours
        httpOnly: true,
        sameSite: 'lax',
        // secure: true, // décommente si le dashboard tourne en HTTPS
      },
    })
  );

  app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

  // ── Routing racine ─────────────────────────────────────
  app.get('/', (req, res) => {
    if (!store.hasAuthApp()) return res.redirect('/setup');
    if (!req.session.discordUser || !store.isAdmin(req.session.discordUser.id)) return res.redirect('/login');
    return res.redirect('/dashboard');
  });

  // ── Setup (premier lancement : configuration de l'appli OAuth Discord) ──
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

      res.redirect('/dashboard');
    } catch (err) {
      console.error('Erreur OAuth Discord:', err.message);
      res.type('html').send(authErrorPage(`Connexion Discord échouée : ${err.message}`));
    }
  });

  app.post('/api/logout', (req, res) => {
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
    // Si le champ token envoyé est le masque affiché, on ne le modifie pas
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
        .filter((r) => r.id !== guild.id) // exclut @everyone
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
      res.json(list);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── ✨ Premium : statistiques & export ──────────────────
  api.get('/stats', (req, res) => {
    res.json(computeStats());
  });

  api.get('/tickets/export.csv', (req, res) => {
    const tickets = readTickets();
    const csv = toCsv(tickets);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${Date.now()}.csv"`);
    res.send(csv);
  });

  // ── ✨ Premium : gestion des administrateurs ─────────────
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
