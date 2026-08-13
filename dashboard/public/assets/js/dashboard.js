// ── État global ───────────────────────────────────────────
let state = {
  bot: {},
  ticketTypes: [],
  guilds: [],
  panelChannels: [],
  staffCategories: [],
  staffRoles: [],
  me: null,
  admins: [],
};

// ── Utilitaires ───────────────────────────────────────────
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function fillSelect(select, items, { value, label, placeholder }) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = value(item);
    opt.textContent = label(item);
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── LAZY LOADING DES VUES & NAVIGATION ────────────────────
const LAZY_LOADERS = { 
  stats: loadStats, 
  access: loadAdmins,
  livechat: loadTickets,
  'open-tickets': loadOpenTickets,
};
const loadedViews = new Set(['overview']);

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      
      item.classList.add('active');
      const viewName = item.dataset.view;
      const targetView = document.getElementById(`view-${viewName}`);
      if (targetView) targetView.classList.add('active');

      if (!loadedViews.has(viewName) && LAZY_LOADERS[viewName]) {
        loadedViews.add(viewName);
        LAZY_LOADERS[viewName]();
      }
    });
  });
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await api('POST', '/api/logout');
  window.location.href = '/login';
});

// ── Utilisateur connecté (Discord) ─────────────────────────
async function loadMe() {
  try {
    const data = await api('GET', '/api/me');
    state.me = data.user;
    state.admins = data.admins;
    const avatar = document.getElementById('user-avatar');
    const name = document.getElementById('user-name');
    if (avatar) avatar.src = data.user.avatar;
    if (name) name.textContent = data.user.username;
  } catch {}
}

// ── Statut du bot ─────────────────────────────────────────
const STATUS_LABELS = {
  online: 'En ligne',
  connecting: 'Connexion…',
  offline: 'Hors ligne',
  error: 'Erreur',
};

async function refreshStatus() {
  try {
    const s = await api('GET', '/api/status');
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) dot.className = `status-dot ${s.status}`;
    if (text) text.textContent = STATUS_LABELS[s.status] || s.status;

    const lines = [];
    lines.push(`<strong>Statut :</strong> ${STATUS_LABELS[s.status] || s.status}`);
    if (s.tag) lines.push(`<strong>Compte :</strong> <span class="mono">${escapeHtml(s.tag)}</span>`);
    if (s.guildCount) lines.push(`<strong>Serveurs :</strong> ${s.guildCount}`);
    if (s.ping !== null && s.ping >= 0) lines.push(`<strong>Latence :</strong> ${s.ping} ms`);
    if (s.lastError) lines.push(`<strong style="color:var(--coral)">Dernière erreur :</strong> ${escapeHtml(s.lastError)}`);
    
    const overviewStatus = document.getElementById('overview-status');
    if (overviewStatus) overviewStatus.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  } catch {}
}

// ── Chargement des settings ───────────────────────────────
async function loadSettings() {
  const data = await api('GET', '/api/settings');
  state.bot = data.bot;
  state.ticketTypes = data.ticketTypes;

  const tokenInput = document.getElementById('input-token');
  if (tokenInput) tokenInput.placeholder = data.hasToken ? data.bot.token : 'Colle ton token ici';

  const setInputValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setInputValue('input-panel-title', data.bot.panelTitle);
  setInputValue('input-panel-desc', data.bot.panelDescription);
  setInputValue('input-panel-banner', data.bot.panelBanner);
  setInputValue('input-embed-color', data.bot.embedColor);
  setInputValue('input-footer', data.bot.footerText);

  renderTicketTypes();
}

async function loadGuilds() {
  state.guilds = await api('GET', '/api/discord/guilds');

  const panelGuildSelect = document.getElementById('select-panel-guild');
  const staffGuildSelect = document.getElementById('select-staff-guild');

  const opts = { value: (g) => g.id, label: (g) => g.name, placeholder: 'Sélectionner un serveur…' };
  fillSelect(panelGuildSelect, state.guilds, opts);
  fillSelect(staffGuildSelect, state.guilds, opts);

  if (panelGuildSelect) panelGuildSelect.value = state.bot.panelGuildId || '';
  if (staffGuildSelect) staffGuildSelect.value = state.bot.staffGuildId || '';

  if (state.guilds.length === 0) {
    toast("Le bot n'est connecté à aucun serveur pour l'instant.", true);
  }

  await Promise.all([onPanelGuildChange(false), onStaffGuildChange(false)]);
}

async function onPanelGuildChange(fromUser = true) {
  const guildSelect = document.getElementById('select-panel-guild');
  const channelSelect = document.getElementById('select-panel-channel');
  if (!guildSelect || !channelSelect) return;

  const guildId = guildSelect.value;
  if (!guildId) return fillSelect(channelSelect, [], { value: () => '', label: () => '', placeholder: 'Choisis un serveur d\'abord' });

  state.panelChannels = await api('GET', `/api/discord/guilds/${guildId}/channels`);
  fillSelect(channelSelect, state.panelChannels, {
    value: (c) => c.id,
    label: (c) => `#${c.name}`,
    placeholder: 'Sélectionner un salon…',
  });
  if (!fromUser) channelSelect.value = state.bot.panelChannelId || '';
  else channelSelect.value = '';
}

async function onStaffGuildChange(fromUser = true) {
  const guildSelect = document.getElementById('select-staff-guild');
  const categorySelect = document.getElementById('select-staff-category');
  if (!guildSelect || !categorySelect) return;

  const guildId = guildSelect.value;
  if (!guildId) {
    fillSelect(categorySelect, [], { value: () => '', label: () => '', placeholder: 'Choisis un serveur d\'abord' });
    state.staffRoles = [];
    state.staffCategories = [];
    renderTicketTypes();
    return;
  }

  const [categories, roles] = await Promise.all([
    api('GET', `/api/discord/guilds/${guildId}/categories`),
    api('GET', `/api/discord/guilds/${guildId}/roles`),
  ]);

  state.staffCategories = categories;
  state.staffRoles = roles;

  fillSelect(categorySelect, categories, {
    value: (c) => c.id,
    label: (c) => c.name,
    placeholder: 'Aucune catégorie (Par défaut)',
  });
  if (!fromUser) categorySelect.value = state.bot.staffCategoryId || '';
  else categorySelect.value = '';

  renderTicketTypes();
}

document.getElementById('select-panel-guild')?.addEventListener('change', () => onPanelGuildChange(true));
document.getElementById('select-staff-guild')?.addEventListener('change', () => onStaffGuildChange(true));

// ── Enregistrement token & config ─────────────────────────
document.getElementById('save-token-btn')?.addEventListener('click', async () => {
  const token = document.getElementById('input-token').value.trim();
  if (!token) return toast('Colle un token avant de sauvegarder.', true);
  try {
    await api('POST', '/api/settings/bot', { token });
    toast('Token enregistré, connexion en cours…');
    document.getElementById('input-token').value = '';
    setTimeout(async () => {
      await loadSettings();
      await loadGuilds();
    }, 2500);
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('save-general-btn')?.addEventListener('click', async () => {
  const patch = {
    panelGuildId: document.getElementById('select-panel-guild').value,
    panelChannelId: document.getElementById('select-panel-channel').value,
    staffGuildId: document.getElementById('select-staff-guild').value,
    staffCategoryId: document.getElementById('select-staff-category').value,
    panelTitle: document.getElementById('input-panel-title').value,
    panelDescription: document.getElementById('input-panel-desc').value,
    panelBanner: document.getElementById('input-panel-banner').value,
    embedColor: document.getElementById('input-embed-color').value.replace('#', ''),
    footerText: document.getElementById('input-footer').value,
  };
  try {
    const res = await api('POST', '/api/settings/bot', patch);
    state.bot = { ...state.bot, ...res.bot };
    toast('Configuration enregistrée.');
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Actions rapides ────────────────────────────────────────
document.getElementById('refresh-panel-btn')?.addEventListener('click', async () => {
  try {
    await api('POST', '/api/bot/refresh-panel');
    toast('Panel republié.');
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('restart-bot-btn')?.addEventListener('click', async () => {
  try {
    toast('Reconnexion en cours…');
    await api('POST', '/api/bot/restart');
    setTimeout(refreshStatus, 1500);
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Types de tickets ───────────────────────────────────────
function roleNameById(id) {
  const r = state.staffRoles.find((r) => r.id === id);
  return r ? r.name : id;
}

function categoryNameById(id) {
  const c = state.staffCategories.find((cat) => cat.id === id);
  return c ? c.name : null;
}

function renderTicketTypes() {
  const container = document.getElementById('types-list');
  if (!container) return;
  container.innerHTML = '';

  if (state.ticketTypes.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🎟️</div>Aucun type de ticket. Clique sur "+ Nouveau type" pour commencer.</div>`;
    return;
  }

  for (const type of state.ticketTypes) {
    const el = document.createElement('div');
    el.className = 'ticket-stub';
    const roleChips = (type.allowedRoles || [])
      .map((rid) => `<span class="role-chip">${escapeHtml(roleNameById(rid))}</span>`)
      .join('');

    const specificCategory = type.categoryId ? categoryNameById(type.categoryId) : null;
    const catBadge = specificCategory 
      ? `<span class="badge-ultra" style="margin-left:8px;">📁 ${escapeHtml(specificCategory)}</span>` 
      : '';

    el.innerHTML = `
      <div class="stub-emoji">${escapeHtml(type.emoji) || '🎫'}</div>
      <div class="stub-body">
        <div class="stub-title-row">
          <span class="color-dot" style="background:#${(type.color || '5865F2').replace('#', '')}"></span>
          <span class="stub-title">${escapeHtml(type.label)}</span>
          <span class="stub-id mono">${escapeHtml(type.id)}</span>
          ${catBadge}
        </div>
        <div class="stub-desc">${escapeHtml(type.description || '')}</div>
        <div class="stub-roles">${roleChips || '<span class="field-hint">Aucun rôle assigné — personne ne verra ce ticket.</span>'}</div>
      </div>
      <div class="stub-actions">
        <button class="btn-ghost edit-type-btn">✏️ Modifier</button>
      </div>
    `;
    el.querySelector('.edit-type-btn').addEventListener('click', () => openTypeModal(type));
    container.appendChild(el);
  }
}

// ── Modal type de ticket ───────────────────────────────────
let selectedRoleIds = new Set();

function renderRolesPicker() {
  const picker = document.getElementById('type-roles-picker');
  if (!picker) return;
  picker.innerHTML = '';

  if (state.staffRoles.length === 0) {
    picker.innerHTML = `<span class="field-hint">Aucun rôle disponible — sélectionne d'abord un serveur staff connecté dans "Configuration générale".</span>`;
    return;
  }

  for (const role of state.staffRoles) {
    const label = document.createElement('label');
    label.className = 'role-option' + (selectedRoleIds.has(role.id) ? ' selected' : '');
    label.innerHTML = `<input type="checkbox" value="${role.id}" ${selectedRoleIds.has(role.id) ? 'checked' : ''}> ${escapeHtml(role.name)}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) selectedRoleIds.add(role.id);
      else selectedRoleIds.delete(role.id);
      label.classList.toggle('selected', e.target.checked);
    });
    picker.appendChild(label);
  }
}

function openTypeModal(type = null) {
  document.getElementById('type-modal-title').textContent = type ? 'Modifier le type de ticket' : 'Nouveau type de ticket';
  document.getElementById('type-original-id').value = type ? type.id : '';
  document.getElementById('type-emoji').value = type ? type.emoji : '';
  document.getElementById('type-label').value = type ? type.label : '';
  document.getElementById('type-id').value = type ? type.id : '';
  document.getElementById('type-id').disabled = !!type;
  document.getElementById('type-desc').value = type ? type.description : '';
  document.getElementById('type-color').value = type ? type.color : '5865F2';
  document.getElementById('type-delete-btn').style.display = type ? 'inline-flex' : 'none';

  const categorySelect = document.getElementById('type-category');
  if (categorySelect) {
    categorySelect.innerHTML = '<option value="">Utiliser la catégorie par défaut (Globale)</option>';
    
    if (state.staffCategories && state.staffCategories.length > 0) {
      state.staffCategories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = `📁 ${cat.name}`;
        categorySelect.appendChild(opt);
      });
    }
    categorySelect.value = type ? (type.categoryId || '') : '';
  }

  const welcomeInput = document.getElementById('type-welcome-msg');
  if (welcomeInput) {
    welcomeInput.value = type ? (type.welcomeMessage || '') : '';
  }

  selectedRoleIds = new Set(type ? type.allowedRoles || [] : []);
  renderRolesPicker();

  document.getElementById('type-modal-backdrop')?.classList.add('show');
}

function closeTypeModal() {
  document.getElementById('type-modal-backdrop')?.classList.remove('show');
}

document.getElementById('add-type-btn')?.addEventListener('click', () => openTypeModal());
document.getElementById('type-cancel-btn')?.addEventListener('click', closeTypeModal);

document.getElementById('type-save-btn')?.addEventListener('click', async () => {
  const originalId = document.getElementById('type-original-id').value;
  const id = document.getElementById('type-id').value.trim().toLowerCase().replace(/\s+/g, '-');
  const label = document.getElementById('type-label').value.trim();
  const emoji = document.getElementById('type-emoji').value.trim();
  const description = document.getElementById('type-desc').value.trim();
  const color = document.getElementById('type-color').value.trim().replace('#', '') || '5865F2';
  
  const categoryId = document.getElementById('type-category')?.value || '';
  const welcomeMessage = document.getElementById('type-welcome-msg')?.value.trim() || '';

  if (!id || !label || !emoji) {
    return toast('Emoji, nom et identifiant sont obligatoires.', true);
  }

  const newType = { 
    id, 
    label, 
    emoji, 
    description, 
    color, 
    categoryId,
    welcomeMessage,
    allowedRoles: [...selectedRoleIds] 
  };

  let updated;
  if (originalId) {
    updated = state.ticketTypes.map((t) => (t.id === originalId ? newType : t));
  } else {
    if (state.ticketTypes.some((t) => t.id === id)) {
      return toast('Cet identifiant est déjà utilisé.', true);
    }
    updated = [...state.ticketTypes, newType];
  }

  try {
    const res = await api('POST', '/api/settings/ticket-types', { ticketTypes: updated });
    state.ticketTypes = res.ticketTypes;
    renderTicketTypes();
    closeTypeModal();
    toast('Type de ticket enregistré !');
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('type-delete-btn')?.addEventListener('click', async () => {
  const originalId = document.getElementById('type-original-id').value;
  if (!confirm('Supprimer ce type de ticket ? Les boutons du panel seront mis à jour.')) return;

  const updated = state.ticketTypes.filter((t) => t.id !== originalId);
  try {
    const res = await api('POST', '/api/settings/ticket-types', { ticketTypes: updated });
    state.ticketTypes = res.ticketTypes;
    renderTicketTypes();
    closeTypeModal();
    toast('Type de ticket supprimé.');
  } catch (err) {
    toast(err.message, true);
  }
});

// ── Statistiques ───────────────────────────────────────────
function typeLabel(typeId) {
  const t = state.ticketTypes.find((t) => t.id === typeId);
  return t ? `${t.emoji} ${t.label}` : typeId;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} h ${remMins} min`;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

async function loadStats() {
  let stats;
  try {
    stats = await api('GET', '/api/stats');
  } catch (err) {
    return toast(err.message, true);
  }

  const grid = document.getElementById('stat-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Tickets créés</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--green)">${stats.open}</div>
        <div class="stat-label">Actuellement ouverts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.closed}</div>
        <div class="stat-label">Fermés</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:${stats.unclaimedOpen > 0 ? 'var(--amber)' : 'var(--text)'}">${stats.unclaimedOpen}</div>
        <div class="stat-label">Ouverts non pris en charge</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatDuration(stats.avgResolutionMs)}</div>
        <div class="stat-label">Temps de résolution moyen</div>
      </div>
    `;
  }

  const byTypeEl = document.getElementById('stat-by-type');
  if (byTypeEl) {
    const entries = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      byTypeEl.innerHTML = `<div class="empty-state"><div class="icon">📊</div>Aucun ticket pour l'instant.</div>`;
    } else {
      const max = Math.max(...entries.map(([, count]) => count));
      byTypeEl.innerHTML = entries
        .map(
          ([typeId, count]) => `
          <div class="bar-row">
            <div class="bar-label">${escapeHtml(typeLabel(typeId))}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div>
            <div class="bar-count">${count}</div>
          </div>`
        )
        .join('');
    }
  }

  const recentEl = document.getElementById('stat-recent');
  if (recentEl) {
    if (stats.recent.length === 0) {
      recentEl.innerHTML = `<div class="empty-state"><div class="icon">🕓</div>Rien à afficher pour l'instant.</div>`;
    } else {
      recentEl.innerHTML = stats.recent
        .map(
          (t) => `
          <div class="activity-row">
            <span class="status-dot ${t.status === 'open' ? 'online' : 'offline'}"></span>
            <div class="activity-body">
              <div><strong>${escapeHtml(typeLabel(t.typeId))}</strong> — ${escapeHtml(t.userTag || 'inconnu')} <span class="stub-id mono">#${escapeHtml(t.id)}</span></div>
              <div class="field-hint" style="margin-top:2px;">
                ${t.status === 'open' ? `Ouvert le ${formatDate(t.createdAt)}` : `Fermé le ${formatDate(t.closedAt)}`}
                ${t.claimedByTag ? ` · pris en charge par ${escapeHtml(t.claimedByTag)}` : ''}
              </div>
            </div>
          </div>`
        )
        .join('');
    }
  }
}

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  window.location.href = '/api/tickets/export.csv';
});

// ── Tickets ouverts ─────────────────────────────────────────
function ticketStatusBadge(t) {
  const base = 'display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;';
  if (t.claimedByTag) {
    return `<span style="${base}background:var(--green);">Pris en charge · ${escapeHtml(t.claimedByTag)}</span>`;
  }
  return `<span style="${base}background:var(--amber);">Ouvert · non pris en charge</span>`;
}

async function loadOpenTickets() {
  const tbody = document.getElementById('open-tickets-list');
  if (!tbody) return;

  let tickets;
  try {
    tickets = await api('GET', '/api/tickets/open');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#e04b4b;padding:20px;">Erreur de chargement : ${escapeHtml(err.message)}</td></tr>`;
    return;
  }

  if (!tickets.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">Aucun ticket ouvert pour l'instant.</td></tr>`;
    return;
  }

  tbody.innerHTML = tickets
    .map((t) => {
      const discordLink =
        t.guildId && t.channelId ? `https://discord.com/channels/${t.guildId}/${t.channelId}` : null;
      return `
        <tr>
          <td class="mono">#${escapeHtml(t.id)}</td>
          <td>${escapeHtml(t.userTag || 'inconnu')}</td>
          <td>${escapeHtml(typeLabel(t.typeId))}</td>
          <td>${ticketStatusBadge(t)}</td>
          <td>${discordLink ? `<a class="btn-ghost" href="${discordLink}" target="_blank" rel="noopener">Ouvrir sur Discord</a>` : '—'}</td>
        </tr>`;
    })
    .join('');
}

document.getElementById('refresh-open-tickets-btn')?.addEventListener('click', loadOpenTickets);

// ── Accès admin ─────────────────────────────────────────────
async function loadAdmins() {
  let data;
  try {
    data = await api('GET', '/api/admins');
  } catch (err) {
    return toast(err.message, true);
  }
  state.admins = data.adminIds;

  const list = document.getElementById('admins-list');
  if (!list) return;

  list.innerHTML = data.adminIds
    .map((id) => {
      const isSelf = id === data.selfId;
      return `
      <div class="admin-row">
        <span class="mono">${escapeHtml(id)}</span>
        ${isSelf ? '<span class="role-chip">Toi</span>' : ''}
        <button class="btn-ghost admin-remove-btn" data-id="${escapeHtml(id)}" ${data.adminIds.length <= 1 ? 'disabled' : ''}>Retirer</button>
      </div>`;
    })
    .join('');

  list.querySelectorAll('.admin-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm("Retirer l'accès de cet administrateur ?")) return;
      try {
        await api('DELETE', `/api/admins/${btn.dataset.id}`);
        toast('Administrateur retiré.');
        loadAdmins();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

document.getElementById('add-admin-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('input-new-admin');
  const id = input.value.trim();
  if (!/^\d{15,25}$/.test(id)) return toast('ID Discord invalide.', true);
  try {
    await api('POST', '/api/admins', { discordId: id });
    input.value = '';
    toast('Administrateur ajouté.');
    loadAdmins();
  } catch (err) {
    toast(err.message, true);
  }
});

// ── LIVE CONSOLE & SUPPORT DIRECT ─────────────────────────
window.activeTicketsData = {};

async function loadTickets() {
  const ticketSelect = document.getElementById('select-active-ticket');
  if (!ticketSelect) return;

  try {
    const response = await fetch('/api/tickets');
    const tickets = await response.json();

    ticketSelect.innerHTML = '<option value="">-- Sélectionner un ticket ouvert --</option>';
    window.activeTicketsData = {};

    tickets.forEach((ticket) => {
      window.activeTicketsData[ticket.id] = ticket;
      const option = document.createElement('option');
      option.value = ticket.id;
      option.textContent = `#${ticket.name}`;
      ticketSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Erreur de connexion au bot :', err);
  }
}

function renderMessages(ticketId) {
  const chatMessages = document.getElementById('chat-messages-container');
  if (!chatMessages) return;

  chatMessages.innerHTML = '';
  const ticket = window.activeTicketsData[ticketId];

  if (!ticketId || !ticket || !ticket.messages) {
    chatMessages.innerHTML = '<p style="color:#777; text-align:center; margin:auto;">Sélectionne un ticket pour voir le fil de discussion...</p>';
    return;
  }

  ticket.messages.forEach((msg) => {
    const msgDiv = document.createElement('div');
    msgDiv.style.padding = '8px 12px';
    msgDiv.style.borderRadius = '6px';
    msgDiv.style.marginBottom = '6px';
    msgDiv.style.maxWidth = '80%';
    msgDiv.style.fontSize = '13px';

    if (msg.sender === 'Staff' || msg.sender === 'Bot') {
      msgDiv.style.background = 'rgba(88, 101, 242, 0.2)';
      msgDiv.style.borderLeft = '3px solid #5865f2';
      msgDiv.style.alignSelf = 'flex-end';
    } else {
      msgDiv.style.background = 'rgba(255, 255, 255, 0.08)';
      msgDiv.style.borderLeft = '3px solid #aaa';
      msgDiv.style.alignSelf = 'flex-start';
    }

    msgDiv.innerHTML = `<strong>${escapeHtml(msg.sender)}</strong> <span style="font-size:10px; color:#aaa; margin-left:6px;">${escapeHtml(msg.time)}</span><br>${escapeHtml(msg.text)}`;
    chatMessages.appendChild(msgDiv);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
  const ticketSelect = document.getElementById('select-active-ticket');
  const chatInput = document.getElementById('live-chat-input');
  
  const activeTicketId = ticketSelect?.value;
  const text = chatInput?.value.trim();

  if (!activeTicketId || !text) return;

  try {
    const response = await fetch('/api/tickets/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: activeTicketId, message: text }),
    });

    if (response.ok) {
      chatInput.value = '';
      await loadTickets();
      renderMessages(activeTicketId);
    }
  } catch (err) {
    alert("Impossible d'envoyer le message sur Discord.");
  }
}

// ── STUDIO, THÈMES & FOND D'ÉCRAN ─────────────────────────
function applyThemeConfig(config) {
  const previewBox = document.getElementById('wallpaper-preview');
  const wallpaperUrlInput = document.getElementById('input-wallpaper-url');
  const blurRange = document.getElementById('range-blur');
  const blurVal = document.getElementById('blur-val');
  const opacityRange = document.getElementById('range-opacity');
  const opacityVal = document.getElementById('opacity-val');

  if (config.wallpaper) {
    document.body.style.backgroundImage = `url('${config.wallpaper}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';

    if (previewBox) {
      previewBox.style.backgroundImage = `url('${config.wallpaper}')`;
      previewBox.textContent = '';
    }
    if (wallpaperUrlInput) wallpaperUrlInput.value = config.wallpaper;
  }

  if (config.blur !== undefined) {
    if (blurRange) blurRange.value = config.blur;
    if (blurVal) blurVal.textContent = config.blur;
    document.querySelectorAll('.panel, .sidebar').forEach((el) => {
      el.style.backdropFilter = `blur(${config.blur}px)`;
    });
  }

  if (config.opacity !== undefined) {
    if (opacityRange) opacityRange.value = config.opacity;
    if (opacityVal) opacityVal.textContent = config.opacity;
    const opacityHex = Math.round((config.opacity / 100) * 255).toString(16).padStart(2, '0');
    document.querySelectorAll('.panel').forEach((el) => {
      el.style.backgroundColor = `#18191c${opacityHex}`;
    });
  }
}

// ── INITIALISATION COMPLÈTE AU DOM ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();

  // Live Console Events
  const ticketSelect = document.getElementById('select-active-ticket');
  const chatInput = document.getElementById('live-chat-input');
  const sendBtn = document.getElementById('send-chat-btn');
  const refreshChatBtn = document.getElementById('refresh-chat-btn');

  ticketSelect?.addEventListener('change', (e) => renderMessages(e.target.value));
  sendBtn?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  refreshChatBtn?.addEventListener('click', () => {
    loadTickets();
    if (ticketSelect?.value) renderMessages(ticketSelect.value);
  });

  // Theme Controls
  const blurRange = document.getElementById('range-blur');
  const opacityRange = document.getElementById('range-opacity');
  const wallpaperUrlInput = document.getElementById('input-wallpaper-url');
  const wallpaperFileInput = document.getElementById('input-wallpaper-file');
  const previewBox = document.getElementById('wallpaper-preview');

  blurRange?.addEventListener('input', (e) => {
    const val = e.target.value;
    const blurVal = document.getElementById('blur-val');
    if (blurVal) blurVal.textContent = val;
    document.querySelectorAll('.panel, .sidebar').forEach((el) => {
      el.style.backdropFilter = `blur(${val}px)`;
    });
  });

  opacityRange?.addEventListener('input', (e) => {
    const val = e.target.value;
    const opacityVal = document.getElementById('opacity-val');
    if (opacityVal) opacityVal.textContent = val;
    const opacityHex = Math.round((val / 100) * 255).toString(16).padStart(2, '0');
    document.querySelectorAll('.panel').forEach((el) => {
      el.style.backgroundColor = `#18191c${opacityHex}`;
    });
  });

  wallpaperUrlInput?.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url && previewBox) {
      previewBox.style.backgroundImage = `url('${url}')`;
      previewBox.textContent = '';
    }
  });

  wallpaperFileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target.result;
        if (previewBox) {
          previewBox.style.backgroundImage = `url('${result}')`;
          previewBox.textContent = '';
        }
        if (wallpaperUrlInput) wallpaperUrlInput.value = result;
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('save-theme-btn')?.addEventListener('click', () => {
    const config = {
      blur: blurRange?.value || 10,
      opacity: opacityRange?.value || 80,
      wallpaper: wallpaperUrlInput?.value || '',
    };
    localStorage.setItem('dashboard_theme_config', JSON.stringify(config));
    applyThemeConfig(config);
    toast('Thème enregistré avec succès !');
  });

  document.getElementById('reset-theme-btn')?.addEventListener('click', () => {
    localStorage.removeItem('dashboard_theme_config');
    location.reload();
  });

  // Restauration du thème sauvegardé
  const savedTheme = localStorage.getItem('dashboard_theme_config');
  if (savedTheme) {
    try {
      applyThemeConfig(JSON.parse(savedTheme));
    } catch {}
  }
});

// ── Démarrage Système ──────────────────────────────────────
(async function init() {
  await loadMe();
  await refreshStatus();
  await loadSettings();
  await loadGuilds();
  setInterval(refreshStatus, 5000);
})();
