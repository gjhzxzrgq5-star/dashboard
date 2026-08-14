--- a/dashboard/server.js
+++ b/dashboard/server.js
@@ -5,7 +5,7 @@
 const session = require('express-session');
 const MySQLStore = require('express-mysql-session')(session);
 
-const { globalStore, tenantManager } = require('../lib/store');
+const { globalStore, tenantManager, TenantStore } = require('../lib/store');
 const botManager = require('../lib/botManager');
 const statusBotManager = require('../lib/statusBot');
 const { pool: db } = require('../lib/db');
@@ -53,6 +53,7 @@
 
     req.tenantStore = store;
     req.tenantId = tenantId;
+    req.adminRole = store.getAdminRole(req.session.discordUser.id);
     req.bot = botManager.get(tenantId, store);
     req.statusBot = statusBotManager.get(tenantId, store);
     next();
@@ -62,6 +63,15 @@
   }
 }
 
+// ── Contrôle d'accès par rôle : à placer APRÈS resolveTenant (a besoin
+// de req.adminRole). Un rôle non listé dans `allowed` reçoit un 403.
+function requireRole(...allowed) {
+  return (req, res, next) => {
+    if (allowed.includes(req.adminRole)) return next();
+    return res.status(403).json({ error: 'Accès refusé pour ton rôle.' });
+  };
+}
+
 function requireNoAuthAppYet(req, res, next) {
   if (!globalStore.hasAuthApp()) return next();
   return res.redirect('/login');
@@ -396,7 +406,7 @@
     }
   });
 
-  app.get('/api/admin/customer-codes', requireAuth, resolveTenant, async (req, res) => {
+  app.get('/api/admin/customer-codes', requireAuth, resolveTenant, requireRole('administrateur'), async (req, res) => {
     try {
       const codes = await customerCodes.listCodes();
       res.json({ codes });
@@ -433,7 +443,11 @@
   api.use(requireAuth, resolveTenant);
 
   api.get('/me', (req, res) => {
-    res.json({ user: req.session.discordUser, admins: req.tenantStore.getAdminIds() });
+    res.json({
+      user: req.session.discordUser,
+      admins: req.tenantStore.getAdminIds(),
+      role: req.adminRole,
+    });
   });
 
   // ── FiveM (déjà correctement scopé par dbUserId, inchangé) ───────
@@ -490,7 +504,7 @@
     res.json(req.bot.getStatus());
   });
 
-  api.get('/settings', (req, res) => {
+  api.get('/settings', requireRole('administrateur'), (req, res) => {
     const b = req.tenantStore.getBot();
     res.json({
       bot: { ...b, token: b.token ? maskToken(b.token) : '' },
@@ -499,7 +513,7 @@
     });
   });
 
-  api.post('/settings/bot', async (req, res) => {
+  api.post('/settings/bot', requireRole('administrateur'), async (req, res) => {
     const patch = { ...req.body };
     const isTokenChange = !!(patch.token && !patch.token.includes('•'));
     if (patch.token && patch.token.includes('•')) delete patch.token;
@@ -522,7 +536,7 @@
   });
 
   // ── Bot status FiveM (second bot, distinct du bot principal) ───────
-  api.get('/settings/status-bot', (req, res) => {
+  api.get('/settings/status-bot', requireRole('administrateur'), (req, res) => {
     const s = req.tenantStore.getStatusBot();
     const live = req.statusBot.getStatus();
     res.json({
@@ -537,7 +551,7 @@
     });
   });
 
-  api.post('/settings/status-bot', async (req, res) => {
+  api.post('/settings/status-bot', requireRole('administrateur'), async (req, res) => {
     const patch = { ...req.body };
     const isTokenChange = !!(patch.token && !patch.token.includes('•'));
     if (patch.token && patch.token.includes('•')) delete patch.token;
@@ -554,11 +568,11 @@
     });
   });
 
-  api.get('/statusbot/guilds', (req, res) => {
+  api.get('/statusbot/guilds', requireRole('administrateur'), (req, res) => {
     res.json(req.statusBot.listGuilds());
   });
 
-  api.get('/statusbot/guilds/:guildId/channels', async (req, res) => {
+  api.get('/statusbot/guilds/:guildId/channels', requireRole('administrateur'), async (req, res) => {
     try {
       res.json(await req.statusBot.listChannels(req.params.guildId));
     } catch (err) {
@@ -566,7 +580,7 @@
     }
   });
 
-  api.post('/cfx/test', async (req, res) => {
+  api.post('/cfx/test', requireRole('administrateur'), async (req, res) => {
     const code = String(req.body?.code || '').trim();
     if (!code) return res.status(400).json({ error: 'Code CFX manquant.' });
     try {
@@ -577,7 +591,7 @@
     }
   });
 
-  api.post('/settings/ticket-types', (req, res) => {
+  api.post('/settings/ticket-types', requireRole('administrateur'), (req, res) => {
     const types = req.body?.ticketTypes;
     if (!Array.isArray(types)) return res.status(400).json({ error: 'Format invalide.' });
 
@@ -600,24 +614,24 @@
     res.json({ ok: true, ticketTypes: saved });
   });
 
-  api.post('/bot/restart', async (req, res) => {
+  api.post('/bot/restart', requireRole('administrateur'), async (req, res) => {
     await req.bot.restart();
     res.json({ ok: true, status: req.bot.getStatus() });
   });
 
-  api.post('/bot/refresh-panel', async (req, res) => {
+  api.post('/bot/refresh-panel', requireRole('administrateur'), async (req, res) => {
     const result = await req.bot.refreshPanel();
     if (!result.ok) return res.status(400).json({ error: result.reason });
     res.json({ ok: true });
   });
 
-  api.get('/discord/guilds', async (req, res) => {
+  api.get('/discord/guilds', requireRole('administrateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
     const guilds = [...req.bot.client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name }));
     res.json(guilds);
   });
 
-  api.get('/discord/guilds/:guildId/channels', async (req, res) => {
+  api.get('/discord/guilds/:guildId/channels', requireRole('administrateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
     try {
       const guild = await req.bot.client.guilds.fetch(req.params.guildId);
@@ -631,7 +645,7 @@
     }
   });
 
-  api.get('/discord/guilds/:guildId/categories', async (req, res) => {
+  api.get('/discord/guilds/:guildId/categories', requireRole('administrateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
     try {
       const guild = await req.bot.client.guilds.fetch(req.params.guildId);
@@ -645,7 +659,7 @@
     }
   });
 
-  api.get('/discord/guilds/:guildId/roles', async (req, res) => {
+  api.get('/discord/guilds/:guildId/roles', requireRole('administrateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online') return res.json([]);
     try {
       const guild = await req.bot.client.guilds.fetch(req.params.guildId);
@@ -683,7 +697,7 @@
     res.json(open);
   });
 
-  api.get('/tickets/:id/messages', async (req, res) => {
+  api.get('/tickets/:id/messages', requireRole('administrateur', 'moderateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online') {
       return res.status(503).json({ error: 'Le bot est hors ligne, impossible de lire les messages.' });
     }
@@ -705,7 +719,7 @@
     }
   });
 
-  api.post('/tickets/:id/reply', async (req, res) => {
+  api.post('/tickets/:id/reply', requireRole('administrateur', 'moderateur'), async (req, res) => {
     if (!req.bot.client || req.bot.status !== 'online' || !req.bot.ticketManager) {
       return res.status(503).json({ error: "Le bot est hors ligne, impossible d'envoyer un message." });
     }
@@ -725,7 +739,7 @@
     }
   });
 
-  api.get('/tickets/export.csv', async (req, res) => {
+  api.get('/tickets/export.csv', requireRole('administrateur', 'moderateur'), async (req, res) => {
     const tickets = await readTickets(req.tenantId);
     const csv = toCsv(tickets);
     res.setHeader('Content-Type', 'text/csv; charset=utf-8');
@@ -733,14 +747,20 @@
     res.send(csv);
   });
 
-  api.get('/admins', (req, res) => {
-    res.json({ adminIds: req.tenantStore.getAdminIds(), selfId: req.session.discordUser.id });
+  // Gestion des accès admin : réservée au rôle "administrateur" (un
+  // modérateur ou visiteur ne doit pas pouvoir voir/modifier qui a
+  // accès au dashboard, ni changer les rôles).
+  api.get('/admins', requireRole('administrateur'), (req, res) => {
+    res.json({ admins: req.tenantStore.getAdminsWithRoles(), selfId: req.session.discordUser.id });
   });
 
-  api.post('/admins', async (req, res) => {
+  api.post('/admins', requireRole('administrateur'), async (req, res) => {
     const id = String(req.body?.discordId || '').trim();
     if (!/^\d{15,25}$/.test(id)) return res.status(400).json({ error: "ID Discord invalide (identifiant numérique attendu)." });
 
+    let role = String(req.body?.role || 'administrateur').trim();
+    if (!TenantStore.ROLES.includes(role)) role = 'administrateur';
+
     // Un discord_id ne peut appartenir qu'à un seul tenant : on refuse
     // d'ajouter comme admin quelqu'un qui gère déjà un autre dashboard,
     // plutôt que de le faire basculer silencieusement vers celui-ci.
@@ -749,15 +769,32 @@
       return res.status(400).json({ error: 'Cet identifiant Discord est déjà administrateur sur un autre dashboard.' });
     }
 
-    await tenantManager.addAdminToTenant(req.tenantId, id);
-    res.json({ ok: true, adminIds: req.tenantStore.getAdminIds() });
+    await tenantManager.addAdminToTenant(req.tenantId, id, role);
+    res.json({ ok: true, admins: req.tenantStore.getAdminsWithRoles() });
+  });
+
+  api.patch('/admins/:id/role', requireRole('administrateur'), (req, res) => {
+    const role = String(req.body?.role || '').trim();
+    if (!TenantStore.ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
+    try {
+      const admins = req.tenantStore.setAdminRole(req.params.id, role);
+      res.json({ ok: true, admins });
+    } catch (err) {
+      res.status(400).json({ error: err.message });
+    }
   });
 
-  api.delete('/admins/:id', async (req, res) => {
+  api.delete('/admins/:id', requireRole('administrateur'), async (req, res) => {
     const adminIds = req.tenantStore.getAdminIds();
     if (adminIds.length <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
+    if (
+      req.tenantStore.getAdminRole(req.params.id) === 'administrateur' &&
+      req.tenantStore.countAdministrateurs() <= 1
+    ) {
+      return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur.' });
+    }
     await tenantManager.removeAdminFromTenant(req.tenantId, req.params.id);
-    res.json({ ok: true, adminIds: req.tenantStore.getAdminIds() });
+    res.json({ ok: true, admins: req.tenantStore.getAdminsWithRoles() });
   });
 
   app.use('/api', api);
