--- a/dashboard/server.js
+++ b/dashboard/server.js
@@ -410,9 +410,27 @@
 
   api.post('/settings/bot', async (req, res) => {
     const patch = { ...req.body };
+    const isTokenChange = !!(patch.token && !patch.token.includes('•'));
     if (patch.token && patch.token.includes('•')) delete patch.token;
     const updated = store.setBot(patch);
-    res.json({ ok: true, bot: { ...updated, token: updated.token ? maskToken(updated.token) : '' } });
+
+    // Si on ne touche pas au token, le bot (s'il est en ligne) n'a pas besoin
+    // de se reconnecter : on peut republier le panel tout de suite et renvoyer
+    // le vrai résultat au dashboard. Avant, cette republication se faisait en
+    // tâche de fond via l'event `botSettingsChanged` sans jamais informer
+    // l'admin en cas d'échec (salon supprimé, permissions manquantes...).
+    // Si le token vient de changer, le bot doit d'abord se reconnecter
+    // (asynchrone, cf. `_onBotSettingsChanged`) donc on ne tente rien ici.
+    let panel = null;
+    if (!isTokenChange) {
+      panel = await bot.refreshPanel();
+    }
+
+    res.json({
+      ok: true,
+      bot: { ...updated, token: updated.token ? maskToken(updated.token) : '' },
+      panel,
+    });
   });
 
   api.post('/settings/ticket-types', (req, res) => {
@@ -439,7 +457,12 @@
   });
 
   api.post('/bot/refresh-panel', async (req, res) => {
-    await bot.refreshPanel();
+    // Avant : le résultat de bot.refreshPanel() (qui renvoie { ok, reason }
+    // en cas d'échec — bot hors ligne, salon supprimé, permissions...) était
+    // ignoré, et on répondait toujours { ok: true }. Le dashboard affichait
+    // donc "Panel republié" même quand rien n'avait été envoyé.
+    const result = await bot.refreshPanel();
+    if (!result.ok) return res.status(400).json({ error: result.reason });
     res.json({ ok: true });
   });
