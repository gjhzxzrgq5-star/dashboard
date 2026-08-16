const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const { globalStore, tenantManager, TenantStore } = require('../lib/store');
const botManager = require('../lib/botManager');
const statusBotManager = require('../lib/statusBot');
const { pool: db } = require('../lib/db');
const { isValidEmoji } = require('../lib/config');
const customerCodes = require('../lib/customerCodes');
const { fetchServerStatus } = require('../lib/cfxApi');

const VIEWS_DIR = __dirname;
const DISCORD_API = 'https://discord.com/api/v10';

const sessionStore = new MySQLStore({}, db);

function readView(name) {
  return fs.readFileSync(path.join(VIEWS_DIR, 'public', name), 'utf8');
}

// ── Auth : vérifie juste qu'on a une session Discord + un tenantId ──
function requireAuth(req, res, next) {
  if (req.session && req.session.discordUser && req.session.tenantId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

// ── Résout le TenantStore + le BotController DU TENANT DE LA SESSION ──
async function resolveTenant(req, res, next) {
  try {
    const tenantId = req.session.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'unauthorized' });

    const store = await tenantManager.getStore(tenantId);
    if (!store.isAdmin(req.session.discordUser.id)) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.tenantStore = store;
    req.tenantId = tenantId;
    req.adminRole = store.getAdminRole(req.session.discordUser.id);
    req.bot = botManager.get(tenantId, store);
    req.statusBot = statusBotManager.get(tenantId, store);
    next();
  } catch (err) {
    console.error('Erreur resolveTenant:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// ── Contrôle d'accès par rôle ──
function requireRole(...allowed) {
  return (req, res, next) => {
    if (allowed.includes(req.adminRole)) return next();
    return res.status(403).json({ error: 'Accès refusé pour ton rôle.' });
  };
}

function requireNoAuthAppYet(req, res, next) {
  if (!globalStore.hasAuthApp()) return next();
  return res.redirect('/login');
}

function requireAuthAppSet(req, res, next) {
  if (globalStore.hasAuthApp()) return next();
  return res.redirect('/setup');
}

async function readTickets(tenantId) {
  try {
    const [rows] = await db.query('SELECT data FROM tickets WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
    return rows.map((r) => JSON.parse(r.data));
  } catch (err) {
    console.error('Erreur lecture tickets MySQL:', err.message);
    return [];
  }
}

async function computeStats(tenantId) {
  const tickets = await readTickets(tenantId);
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

function mapTicketMessage(m) {
  const time = m.createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (!m.author.bot) {
    return { sender: m.author.username, text: m.content, time, from: 'staff' };
  }

  if (m.content.startsWith('**[Dashboard]')) {
    const match = m.content.match(/^\*\*\[Dashboard\]\s*(.+?)\s*:\*\*\s*([\s\S]*)$/);
    return {
      sender: match ? `Staff (Dashboard) · ${match[1]}` : 'Staff (Dashboard)',
      text: match ? match[2] : m.content,
      time,
      from: 'staff',
    };
  }

  const embed = m.embeds?.[0];
  if (embed?.author?.name) {
    const isStaffRelay = embed.author.name.startsWith('Staff · ');
    return {
      sender: isStaffRelay ? embed.author.name : `${embed.author.name} (joueur)`,
      text: embed.description || '*[pièce jointe uniquement]*',
      time,
      from: isStaffRelay ? 'staff' : 'user',
    };
  }

  if (embed) {
    return { sender: 'Système', text: embed.title || embed.description || '[notification]', time, from: 'system' };
  }

  return { sender: 'Bot', text: m.content || '[message vide]', time, from: 'system' };
}

function createDashboardServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(
    session({
      store: sessionStore,
      secret: globalStore.getSessionSecret(),
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

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, tenants: botManager.allControllers().length, uptime: process.uptime() });
  });

  app.get('/accueil', (req, res) => {
    res.type('html').send(readView('index.html'));
  });

  app.get('/', (req, res) => {
    if (!globalStore.hasAuthApp()) return res.redirect('/setup');
    if (req.session.discordUser && req.session.tenantId) return res.redirect('/dashboard');
    return res.redirect('/accueil');
  });

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
    globalStore.setAuthConfig({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: redirectUri.trim() });
    res.json({ ok: true });
  });

  // ── Login via Discord OAuth2 ────────────────────────────
  app.get('/login', requireAuthAppSet, (req, res) => {
    if (req.session.discordUser && req.session.tenantId) return res.redirect('/dashboard');
    res.type('html').send(readView('login.html'));
  });

 app.get('/api/auth/discord', requireAuthAppSet, (req, res) => {
    // Réinitialise la session pour éviter les conflits d'état
    req.session.oauthState = null;

    const { clientId, redirectUri } = globalStore.getAuthConfig();
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'consent'); // Force l'écran d'autorisation Discord

    res.redirect(url.toString());
  });

  app.get('/api/auth/discord/callback', requireAuthAppSet, async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res.type('html').send(authErrorPage('Requête invalide ou expirée. Réessaie de te connecter.'));
    }
    delete req.session.oauthState;

    const { clientId, clientSecret, redirectUri } = globalStore.getAuthConfig();

    try {
      // Authentification Basic Auth + URLSearchParams encodé en chaîne de caractères
      const credentials = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri.trim(),
      });

      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        console.error('Erreur détaillée échange token Discord :', errorData);
        throw new Error(`Échange du code refusé par Discord (${tokenRes.status})`);
      }

      const tokenData = await tokenRes.json();

      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) throw new Error("Impossible de récupérer ton profil Discord.");
      const user = await userRes.json();

      const discordProfile = {
        id: user.id,
        username: user.global_name || user.username,
        handle: user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
          : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`,
      };

      const tenantId = await tenantManager.findTenantIdForDiscordUser(user.id);

      if (!tenantId) {
        req.session.pendingUser = discordProfile;
        return res.redirect('/activate');
      }

      req.session.discordUser = discordProfile;
      req.session.tenantId = tenantId;

      try {
        await db.query(
          `INSERT INTO users (discord_id, username, tenant_id) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE username = VALUES(username), tenant_id = VALUES(tenant_id)`,
          [user.id, user.global_name || user.username, tenantId]
        );

        const [userRows] = await db.query('SELECT id FROM users WHERE discord_id = ?', [user.id]);
        const dbUserId = userRows[0].id;
        req.session.discordUser.dbId = dbUserId;

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

  // ── Activation du code client ──────────
  app.get('/activate', requireAuthAppSet, (req, res) => {
    if (req.session.discordUser && req.session.tenantId) return res.redirect('/dashboard');
    if (!req.session.pendingUser) return res.redirect('/login');
    res.type('html').send(readView('activate.html'));
  });

  app.get('/api/activate/me', (req, res) => {
    if (!req.session.pendingUser) return res.status(401).json({ error: 'no_pending_user' });
    res.json({ user: req.session.pendingUser });
  });

  app.post('/api/activate', async (req, res) => {
    if (!req.session.pendingUser) return res.status(401).json({ error: 'no_pending_user' });
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Merci de saisir ton code client.' });

    const pending = req.session.pendingUser;

    try {
      const result = await customerCodes.redeemCode(code, pending.id, pending.username);
      if (!result.ok) {
        const messages = {
          not_found: "Ce code client n'existe pas. Vérifie ta saisie.",
          already_used: 'Ce code a déjà été utilisé.',
          empty: 'Merci de saisir ton code client.',
        };
        return res.status(400).json({ error: messages[result.reason] || 'Code invalide.' });
      }

      const tenantId = await tenantManager.createTenantForDiscordUser(pending.id, pending.username);
      const store = await tenantManager.getStore(tenantId);

      req.session.discordUser = pending;
      req.session.tenantId = tenantId;
      delete req.session.pendingUser;

      if (result.planType) {
        store.setSubscription({ planType: result.planType, active: true });
      }

      try {
        await db.query('UPDATE customer_codes SET tenant_id = ? WHERE code = ?', [tenantId, customerCodes.normalizeCode(code)]);
        await db.query(
          `INSERT INTO users (discord_id, username, tenant_id) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE username = VALUES(username), tenant_id = VALUES(tenant_id)`,
          [pending.id, pending.username, tenantId]
        );
        const [userRows] = await db.query('SELECT id FROM users WHERE discord_id = ?', [pending.id]);
        const dbUserId = userRows[0].id;
        req.session.discordUser.dbId = dbUserId;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await db.query(
          `INSERT INTO connection_logs (user_id, event_type, ip_address, user_agent) VALUES (?, 'LOGIN', ?, ?)`,
          [dbUserId, ip, req.headers['user-agent'] || '']
        );
      } catch (sqlErr) {
        console.error("Erreur SQL lors de l'activation :", sqlErr.message);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Erreur activation code client:', err.message);
      res.status(500).json({ error: "Erreur serveur, réessaie dans un instant." });
    }
  });

  app.get('/api/admin/customer-codes', requireAuth, resolveTenant, requireRole('administrateur'), async (req, res) => {
    try {
      const codes = await customerCodes.listCodes();
      res.json({ codes });
    } catch (err) {
      res.status(500).json({ error: err.message });
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

  // ── Dashboard ──────────
  app.get('/dashboard', requireAuthAppSet, requireAuth, (req, res) => {
    res.type('html').send(readView('dashboard.html'));
  });

  const api = express.Router();
  api.use(requireAuth, resolveTenant);

  api.get('/me', (req, res) => {
    res.json({
      user: req.session.discordUser,
      admins: req.tenantStore.getAdminIds(),
      role: req.adminRole,
    });
  });

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

  api.get('/fivem/bans', async (req, res) => {
    try {
      const dbUserId = req.session.discordUser.dbId;
      const [rows] = await db.query('SELECT fivem_url FROM user_configs WHERE user_id = ?', [dbUserId]);
      if (!rows.length || !rows[0].fivem_url) return res.json([]);
      res.json([]);
    } catch (err) {
      res.status(500).json({ error: "Erreur lors de la récupération des bannis." });
    }
  });

  api.get('/status', (req, res) => {
    res.json(req.bot.getStatus());
  });

  api.get('/settings', requireRole('administrateur'), (req, res) => {
    const b = req.tenantStore.getBot();
    res.json({
      bot: { ...b, token: b.token ? maskToken(b.token) : '' },
      hasToken: !!b.token,
      ticketTypes: req.tenantStore.getTicketTypes(),
    });
  });

  api.post('/settings/bot', requireRole('administrateur'), async (req, res) => {
    const patch = { ...req.body };
    const isTokenChange = !!(patch.token && !patch.token.includes('•'));
    if (patch.token && patch.token.includes('•')) delete patch.token;
    const updated = req.tenantStore.setBot(patch);

    let panel = null;
    if (!isTokenChange) {
      panel = await req.bot.refreshPanel();
    } else if (patch.token) {
      await req.bot.restart();
    }

    res.json({
      ok: true,
      bot: { ...updated, token: updated.token ? maskToken(updated.token) : '' },
      panel,
    });
  });

  api.get('/settings/status-bot', requireRole('administrateur'), (req, res) => {
    const s = req.tenantStore.getStatusBot();
    const live = req.statusBot.getStatus();
    res.json({
      statusBot: {
        ...s,
        token: s.token ? maskToken(s.token) : '',
        lastServerStatus: live.lastServerStatus || s.lastServerStatus || null,
        connectionStatus: live.status,
        connectionError: live.lastError,
      },
      hasToken: !!s.token,
    });
  });

  api.post('/settings/status-bot', requireRole('administrateur'), async (req, res) => {
    const patch = { ...req.body };
    const isTokenChange = !!(patch.token && !patch.token.includes('•'));
    if (patch.token && patch.token.includes('•')) delete patch.token;
    const updated = req.tenantStore.setStatusBot(patch);

    if (isTokenChange) {
      await req.statusBot.restart();
    }

    res.json({
      ok: true,
      statusBot: { ...updated, token: updated.token ? maskToken(updated.token) : '' },
    });
  });

  api.get('/statusbot/guilds', requireRole('administrateur'), (req, res) => {
    res.json(req.statusBot.listGuilds());
  });

  api.get('/statusbot/guilds/:guildId/channels', requireRole('administrateur'), async (req, res) => {
    try {
      res.json(await req.statusBot.listChannels(req.params.guildId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.post('/cfx/test', requireRole('administrateur'), async (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Code CFX manquant.' });
    try {
      const status = await fetchServerStatus(code);
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.post('/settings/ticket-types', requireRole('administrateur'), (req, res) => {
    const types = req.body?.ticketTypes;
    if (!Array.isArray(types)) return res.status(400).json({ error: 'Format invalide.' });

    for (const t of types) {
      if (!t.id || !t.label || !t.emoji) {
        return res.status(400).json({ error: 'Chaque type de ticket doit avoir un id, un label et un emoji.' });
      }
      if (!isValidEmoji(t.emoji)) {
        return res.status(400).json({
          error: `Emoji invalide pour "${t.label}" : "${t.emoji}". Utilise un emoji Unicode (ex: 🎫) ou un emoji personnalisé du serveur (ex: <:nom:1234567890>).`,
        });
      }
    }
    const ids = types.map((t) => t.id);
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Les identifiants de types de tickets doivent être uniques.' });
    }

    const saved = req.tenantStore.setTicketTypes(types);
    res.json({ ok: true, ticketTypes: saved });
  });

  api.post('/bot/restart', requireRole('administrateur'), async (req, res) => {
    await req.bot.restart();
    res.json({ ok: true, status: req.bot.getStatus() });
  });

  api.post('/bot/refresh-panel', requireRole('administrateur'), async (req, res) => {
    const result = await req.bot.refreshPanel();
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json({ ok: true });
  });

  api.get('/discord/guilds', requireRole('administrateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
    const guilds = [...req.bot.client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name }));
    res.json(guilds);
  });

  api.get('/discord/guilds/:guildId/channels', requireRole('administrateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
    try {
      const guild = await req.bot.client.guilds.fetch(req.params.guildId);
      const channels = await guild.channels.fetch();
      const textChannels = [...channels.values()]
        .filter((c) => c && c.type === 0)
        .map((c) => ({ id: c.id, name: c.name }));
      res.json(textChannels);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/discord/guilds/:guildId/categories', requireRole('administrateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
    try {
      const guild = await req.bot.client.guilds.fetch(req.params.guildId);
      const channels = await guild.channels.fetch();
      const categories = [...channels.values()]
        .filter((c) => c && c.type === 4)
        .map((c) => ({ id: c.id, name: c.name }));
      res.json(categories);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/discord/guilds/:guildId/roles', requireRole('administrateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
    try {
      const guild = await req.bot.client.guilds.fetch(req.params.guildId);
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
    res.json(await computeStats(req.tenantId));
  });

  api.get('/tickets/open', async (req, res) => {
    const tickets = await readTickets(req.tenantId);
    const open = tickets
      .filter((t) => t.status === 'open')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((t) => ({
        id: t.id,
        channelId: t.channelId,
        guildId: t.guildId,
        userTag: t.userTag,
        userId: t.userId,
        typeId: t.typeId,
        status: t.status,
        claimedByTag: t.claimedByTag || null,
        createdAt: t.createdAt,
      }));
    res.json(open);
  });

  api.get('/tickets/:id/messages', requireRole('administrateur', 'moderateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online') {
      return res.status(503).json({ error: 'Le bot est hors ligne, impossible de lire les messages.' });
    }
    try {
      const [rows] = await db.query('SELECT data FROM tickets WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      if (!rows.length) return res.status(404).json({ error: 'Ticket introuvable.' });
      const ticket = JSON.parse(rows[0].data);

      const channel = await req.bot.client.channels.fetch(ticket.channelId);
      const messages = await channel.messages.fetch({ limit: 30 });
      const list = [...messages.values()].reverse().map((m) => mapTicketMessage(m));

      res.json({
        ticket: { id: ticket.id, userTag: ticket.userTag, typeId: ticket.typeId, status: ticket.status },
        messages: list,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.post('/tickets/:id/reply', requireRole('administrateur', 'moderateur'), async (req, res) => {
    if (!req.bot.client || req.bot.status !== 'online' || !req.bot.ticketManager) {
      return res.status(503).json({ error: "Le bot est hors ligne, impossible d'envoyer un message." });
    }
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message vide.' });

    try {
      const [rows] = await db.query('SELECT data FROM tickets WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      if (!rows.length) return res.status(404).json({ error: 'Ticket introuvable.' });
      const ticket = JSON.parse(rows[0].data);

      const staffLabel = req.session.discordUser?.username || 'Staff';
      await req.bot.ticketManager.sendDashboardReply(ticket, staffLabel, message);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.get('/tickets/export.csv', requireRole('administrateur', 'moderateur'), async (req, res) => {
    const tickets = await readTickets(req.tenantId);
    const csv = toCsv(tickets);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${Date.now()}.csv"`);
    res.send(csv);
  });

  api.get('/admins', requireRole('administrateur'), (req, res) => {
    res.json({ admins: req.tenantStore.getAdminsWithRoles(), selfId: req.session.discordUser.id });
  });

  api.post('/admins', requireRole('administrateur'), async (req, res) => {
    const id = String(req.body?.discordId || '').trim();
    if (!/^\d{15,25}$/.test(id)) return res.status(400).json({ error: "ID Discord invalide (identifiant numérique attendu)." });

    let role = String(req.body?.role || 'administrateur').trim();
    if (!TenantStore.ROLES.includes(role)) role = 'administrateur';

    const existingTenant = await tenantManager.findTenantIdForDiscordUser(id);
    if (existingTenant && existingTenant !== req.tenantId) {
      return res.status(400).json({ error: 'Cet identifiant Discord est déjà administrateur sur un autre dashboard.' });
    }

    await tenantManager.addAdminToTenant(req.tenantId, id, role);
    res.json({ ok: true, admins: req.tenantStore.getAdminsWithRoles() });
  });

  api.patch('/admins/:id/role', requireRole('administrateur'), (req, res) => {
    const role = String(req.body?.role || '').trim();
    if (!TenantStore.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
    try {
      const admins = req.tenantStore.setAdminRole(req.params.id, role);
      res.json({ ok: true, admins });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  api.delete('/admins/:id', requireRole('administrateur'), async (req, res) => {
    const adminIds = req.tenantStore.getAdminIds();
    if (adminIds.length <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
    if (
      req.tenantStore.getAdminRole(req.params.id) === 'administrateur' &&
      req.tenantStore.countAdministrateurs() <= 1
    ) {
      return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
    }
    await tenantManager.removeAdminFromTenant(req.tenantId, req.params.id);
    res.json({ ok: true, admins: req.tenantStore.getAdminsWithRoles() });
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
<div class="auth-error">${message}</div>
<a href="/login" class="btn btn-primary btn-block">Retour à la connexion</a>
</div></div></body></html>`;
}

module.exports = createDashboardServer;
