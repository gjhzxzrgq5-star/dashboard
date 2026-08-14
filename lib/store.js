--- a/lib/store.js
+++ b/lib/store.js
@@ -164,8 +164,9 @@
     delete defaults.auth?.clientSecret;
     delete defaults.auth?.redirectUri;
     delete defaults.sessionSecret;
-    if (!defaults.auth) defaults.auth = { adminIds: [], guildId: '' };
+    if (!defaults.auth) defaults.auth = { adminIds: [], adminRoles: {}, guildId: '' };
     if (!('adminIds' in defaults.auth)) defaults.auth.adminIds = [];
+    if (!('adminRoles' in defaults.auth)) defaults.auth.adminRoles = {};
 
     let current = {};
     try {
@@ -202,24 +203,67 @@
     return [...this.settings.auth.adminIds];
   }
 
+  // ── Rôles (administrateur / moderateur / visiteur) ───────────────
+  // Un compte présent dans adminIds mais absent de adminRoles est
+  // considéré "administrateur" (comptes créés avant l'introduction
+  // des rôles → on ne change pas leur niveau d'accès existant).
+  static ROLES = ['administrateur', 'moderateur', 'visiteur'];
+
+  getAdminRole(discordId) {
+    this._assertReady();
+    if (!this.settings.auth.adminIds.includes(discordId)) return null;
+    return this.settings.auth.adminRoles[discordId] || 'administrateur';
+  }
+
+  getAdminsWithRoles() {
+    this._assertReady();
+    return this.settings.auth.adminIds.map((id) => ({
+      id,
+      role: this.settings.auth.adminRoles[id] || 'administrateur',
+    }));
+  }
+
+  countAdministrateurs() {
+    this._assertReady();
+    return this.getAdminsWithRoles().filter((a) => a.role === 'administrateur').length;
+  }
+
+  setAdminRole(discordId, role) {
+    this._assertReady();
+    if (!TenantStore.ROLES.includes(role)) throw new Error('Rôle invalide.');
+    if (!this.settings.auth.adminIds.includes(discordId)) throw new Error('Ce compte n\'a pas accès au dashboard.');
+
+    const current = this.getAdminRole(discordId);
+    if (current === 'administrateur' && role !== 'administrateur' && this.countAdministrateurs() <= 1) {
+      throw new Error('Impossible de retirer le dernier administrateur.');
+    }
+
+    this.settings.auth.adminRoles[discordId] = role;
+    this.save();
+    return this.getAdminsWithRoles();
+  }
+
   // NB: la mise à jour de la table tenant_admins (utilisée pour retrouver
   // à quel tenant appartient un discord_id à la connexion) est faite par
   // l'appelant (tenantManager.addAdminToTenant) en plus de cet appel, pour
   // garder ce fichier indépendant de la connexion DB "métier".
-  addAdmin(discordId) {
+  addAdmin(discordId, role = 'administrateur') {
     this._assertReady();
+    if (!TenantStore.ROLES.includes(role)) role = 'administrateur';
     if (!this.settings.auth.adminIds.includes(discordId)) {
       this.settings.auth.adminIds.push(discordId);
-      this.save();
     }
-    return this.getAdminIds();
+    this.settings.auth.adminRoles[discordId] = role;
+    this.save();
+    return this.getAdminsWithRoles();
   }
 
   removeAdmin(discordId) {
     this._assertReady();
     this.settings.auth.adminIds = this.settings.auth.adminIds.filter((id) => id !== discordId);
+    delete this.settings.auth.adminRoles[discordId];
     this.save();
-    return this.getAdminIds();
+    return this.getAdminsWithRoles();
   }
 
   getGuildId() {
@@ -362,14 +406,14 @@
     return tenantId;
   }
 
-  async addAdminToTenant(tenantId, discordId) {
+  async addAdminToTenant(tenantId, discordId, role = 'administrateur') {
     await ensureSchema();
     await pool.query(
       'INSERT IGNORE INTO tenant_admins (tenant_id, discord_id) VALUES (?, ?)',
       [tenantId, discordId]
     );
     const store = await this.getStore(tenantId);
-    store.addAdmin(discordId);
+    store.addAdmin(discordId, role);
   }
 
   async removeAdminFromTenant(tenantId, discordId) {
@@ -383,4 +427,5 @@
 module.exports = {
   globalStore: new GlobalStore(),
   tenantManager: new TenantManager(),
+  TenantStore,
 };
