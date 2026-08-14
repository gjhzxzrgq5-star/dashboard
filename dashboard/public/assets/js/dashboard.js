--- a/dashboard/public/assets/js/dashboard.js
+++ b/dashboard/public/assets/js/dashboard.js
@@ -100,15 +100,49 @@
 });
 
 // ── Utilisateur connecté (Discord) ─────────────────────────
+const VIEW_ROLES = {
+  overview: ['administrateur', 'moderateur', 'visiteur'],
+  subscription: ['administrateur'],
+  'open-tickets': ['administrateur', 'moderateur', 'visiteur'],
+  livechat: ['administrateur', 'moderateur'],
+  stats: ['administrateur', 'moderateur', 'visiteur'],
+  connection: ['administrateur'],
+  general: ['administrateur'],
+  fivembans: ['administrateur', 'moderateur', 'visiteur'],
+  customization: ['administrateur'],
+  types: ['administrateur'],
+  access: ['administrateur'],
+  changelog: ['administrateur', 'moderateur', 'visiteur'],
+};
+
+function applyRoleRestrictions(role) {
+  const roleLabel = document.getElementById('user-role-label');
+  if (roleLabel) roleLabel.textContent = ROLE_LABELS[role] || role;
+
+  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
+    const allowed = VIEW_ROLES[item.dataset.view];
+    if (allowed && !allowed.includes(role)) item.style.display = 'none';
+  });
+
+  // Si la vue actuellement active vient d'être masquée, on retombe sur l'aperçu.
+  const activeItem = document.querySelector('.nav-item.active');
+  if (activeItem && activeItem.style.display === 'none') {
+    const overviewItem = document.querySelector('.nav-item[data-view="overview"]');
+    overviewItem?.click();
+  }
+}
+
 async function loadMe() {
   try {
     const data = await api('GET', '/api/me');
     state.me = data.user;
     state.admins = data.admins;
+    state.role = data.role;
     const avatar = document.getElementById('user-avatar');
     const name = document.getElementById('user-name');
     if (avatar) avatar.src = data.user.avatar;
     if (name) name.textContent = data.user.username;
+    applyRoleRestrictions(data.role);
   } catch {}
 }
 
@@ -654,6 +688,8 @@
 document.getElementById('refresh-open-tickets-btn')?.addEventListener('click', loadOpenTickets);
 
 // ── Accès admin ─────────────────────────────────────────────
+const ROLE_LABELS = { administrateur: 'Administrateur', moderateur: 'Modérateur', visiteur: 'Visiteur' };
+
 async function loadAdmins() {
   let data;
   try {
@@ -661,23 +697,50 @@
   } catch (err) {
     return toast(err.message, true);
   }
-  state.admins = data.adminIds;
+  state.admins = data.admins.map((a) => a.id);
 
   const list = document.getElementById('admins-list');
   if (!list) return;
 
-  list.innerHTML = data.adminIds
-    .map((id) => {
-      const isSelf = id === data.selfId;
+  const administrateurCount = data.admins.filter((a) => a.role === 'administrateur').length;
+
+  list.innerHTML = data.admins
+    .map((admin) => {
+      const isSelf = admin.id === data.selfId;
+      const isLastAdministrateur = admin.role === 'administrateur' && administrateurCount <= 1;
+      const roleOptions = Object.entries(ROLE_LABELS)
+        .map(
+          ([value, label]) =>
+            `<option value="${value}" ${admin.role === value ? 'selected' : ''}>${label}</option>`
+        )
+        .join('');
       return `
       <div class="admin-row">
-        <span class="mono">${escapeHtml(id)}</span>
+        <span class="mono">${escapeHtml(admin.id)}</span>
         ${isSelf ? '<span class="role-chip">Toi</span>' : ''}
-        <button class="btn-ghost admin-remove-btn" data-id="${escapeHtml(id)}" ${data.adminIds.length <= 1 ? 'disabled' : ''}>Retirer</button>
+        <select class="admin-role-select" data-id="${escapeHtml(admin.id)}" ${isLastAdministrateur ? 'disabled title="Dernier administrateur : rôle verrouillé"' : ''}>
+          ${roleOptions}
+        </select>
+        <button class="btn-ghost admin-remove-btn" data-id="${escapeHtml(admin.id)}" ${data.admins.length <= 1 || isLastAdministrateur ? 'disabled' : ''}>Retirer</button>
       </div>`;
     })
     .join('');
 
+  list.querySelectorAll('.admin-role-select').forEach((select) => {
+    select.addEventListener('change', async () => {
+      const previousValue = select.dataset.currentRole || select.value;
+      try {
+        await api('PATCH', `/api/admins/${select.dataset.id}/role`, { role: select.value });
+        toast('Rôle mis à jour.');
+        loadAdmins();
+      } catch (err) {
+        toast(err.message, true);
+        select.value = previousValue;
+      }
+    });
+    select.dataset.currentRole = select.value;
+  });
+
   list.querySelectorAll('.admin-remove-btn').forEach((btn) => {
     btn.addEventListener('click', async () => {
       if (!confirm("Retirer l'accès de cet administrateur ?")) return;
@@ -694,10 +757,11 @@
 
 document.getElementById('add-admin-btn')?.addEventListener('click', async () => {
   const input = document.getElementById('input-new-admin');
+  const roleSelect = document.getElementById('input-new-admin-role');
   const id = input.value.trim();
   if (!/^\d{15,25}$/.test(id)) return toast('ID Discord invalide.', true);
   try {
-    await api('POST', '/api/admins', { discordId: id });
+    await api('POST', '/api/admins', { discordId: id, role: roleSelect ? roleSelect.value : 'administrateur' });
     input.value = '';
     toast('Administrateur ajouté.');
     loadAdmins();
