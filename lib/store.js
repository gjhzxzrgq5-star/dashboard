const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { pool, ensureSchema } = require('./db');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'settings.default.json');
const GLOBAL_KEY = 'global_settings';

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function kvGet(key) {
  const [rows] = await pool.query('SELECT value FROM kv_store WHERE `key` = ?', [key]);
  return rows.length ? JSON.parse(rows[0].value) : null;
}

async function kvSet(key, data) {
  const json = JSON.stringify(data);
  await pool.query(
    'INSERT INTO kv_store (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [key, json]
  );
}

// ─────────────────────────────────────────────────────────────────
// GlobalStore : config UNIQUE à toute l'application.
// Ne contient QUE ce qui sert à authentifier les gens (l'app OAuth2
// Discord utilisée pour le bouton "Se connecter") + le secret de
// session. Ne contient PLUS jamais de données propres à un client
// (bot, tickets, adminIds) : c'était le mélange qui causait la fuite.
// ─────────────────────────────────────────────────────────────────
class GlobalStore {
  constructor() {
    this.settings = null;
    this.ready = false;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._load();
    await this._initPromise;
    this.ready = true;
    return this.settings;
  }

  _assertReady() {
    if (!this.ready) {
      throw new Error('GlobalStore non initialisé — appelle await globalStore.init() au démarrage.');
    }
  }

  async _load() {
    await ensureSchema();

    const defaults = {
      auth: { clientId: '', clientSecret: '', redirectUri: '' },
      sessionSecret: null,
    };

    let current = {};
    try {
      current = (await kvGet(GLOBAL_KEY)) || {};
    } catch (err) {
      console.error('⚠️ Impossible de lire global_settings depuis MySQL, valeurs par défaut:', err.message);
    }

    const merged = deepMerge(defaults, current);
    if (!merged.sessionSecret) {
      merged.sessionSecret = crypto.randomBytes(32).toString('hex');
    }

    this.settings = merged;
    await kvSet(GLOBAL_KEY, merged);
    return merged;
  }

  save() {
    kvSet(GLOBAL_KEY, this.settings).catch((err) =>
      console.error('❌ Échec sauvegarde global_settings:', err.message)
    );
  }

  hasAuthApp() {
    this._assertReady();
    return !!(this.settings.auth.clientId && this.settings.auth.clientSecret);
  }

  getAuthConfig() {
    this._assertReady();
    return { ...this.settings.auth };
  }

  setAuthConfig(patch) {
    this._assertReady();
    this.settings.auth = deepMerge(this.settings.auth, patch);
    this.save();
    return this.getAuthConfig();
  }

  getSessionSecret() {
    this._assertReady();
    return this.settings.sessionSecret;
  }
}

// ─────────────────────────────────────────────────────────────────
// TenantStore : config PROPRE à un client (un dashboard = un tenant).
// Une instance par tenant_id, jamais partagée entre clients.
// ─────────────────────────────────────────────────────────────────
class TenantStore extends EventEmitter {
  constructor(tenantId) {
    super();
    this.tenantId = tenantId;
    this.settings = null;
    this.ready = false;
    this._initPromise = null;
  }

  get _key() {
    return `tenant:${this.tenantId}`;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._load();
    await this._initPromise;
    this.ready = true;
    return this.settings;
  }

  _assertReady() {
    if (!this.ready) {
      throw new Error(`TenantStore(${this.tenantId}) non initialisé — appelle await store.init() d'abord.`);
    }
  }

  async _load() {
    await ensureSchema();
    const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
    // Le default global n'a plus besoin des champs OAuth ni sessionSecret
    // (déplacés dans GlobalStore) : on les retire s'ils traînent encore
    // dans data/settings.default.json pour éviter toute confusion.
    delete defaults.auth?.clientId;
    delete defaults.auth?.clientSecret;
    delete defaults.auth?.redirectUri;
    delete defaults.sessionSecret;
    if (!defaults.auth) defaults.auth = { adminIds: [], adminRoles: {}, guildId: '' };
    if (!('adminIds' in defaults.auth)) defaults.auth.adminIds = [];
    if (!('adminRoles' in defaults.auth)) defaults.auth.adminRoles = {};

    let current = {};
    try {
      current = (await kvGet(this._key)) || {};
    } catch (err) {
      console.error(`⚠️ Impossible de lire ${this._key} depuis MySQL, valeurs par défaut:`, err.message);
    }

    const merged = deepMerge(defaults, current);
    this.settings = merged;
    await kvSet(this._key, merged);
    return merged;
  }

  save() {
    kvSet(this._key, this.settings).catch((err) =>
      console.error(`❌ Échec sauvegarde ${this._key}:`, err.message)
    );
  }

  // ── Admins (scopés à CE tenant uniquement) ──────────────────────
  isAdmin(discordId) {
    this._assertReady();
    return this.settings.auth.adminIds.includes(discordId);
  }

  hasAnyAdmin() {
    this._assertReady();
    return this.settings.auth.adminIds.length > 0;
  }

  getAdminIds() {
    this._assertReady();
    return [...this.settings.auth.adminIds];
  }

  // ── Rôles (administrateur / moderateur / visiteur) ───────────────
  // Un compte présent dans adminIds mais absent de adminRoles est
  // considéré "administrateur" (comptes créés avant l'introduction
  // des rôles → on ne change pas leur niveau d'accès existant).
  static ROLES = ['administrateur', 'moderateur', 'visiteur'];

  getAdminRole(discordId) {
    this._assertReady();
    if (!this.settings.auth.adminIds.includes(discordId)) return null;
    return this.settings.auth.adminRoles[discordId] || 'administrateur';
  }

  getAdminsWithRoles() {
    this._assertReady();
    return this.settings.auth.adminIds.map((id) => ({
      id,
      role: this.settings.auth.adminRoles[id] || 'administrateur',
    }));
  }

  countAdministrateurs() {
    this._assertReady();
    return this.getAdminsWithRoles().filter((a) => a.role === 'administrateur').length;
  }

  setAdminRole(discordId, role) {
    this._assertReady();
    if (!TenantStore.ROLES.includes(role)) throw new Error('Rôle invalide.');
    if (!this.settings.auth.adminIds.includes(discordId)) throw new Error('Ce compte n\'a pas accès au dashboard.');

    const current = this.getAdminRole(discordId);
    if (current === 'administrateur' && role !== 'administrateur' && this.countAdministrateurs() <= 1) {
      throw new Error('Impossible de retirer le dernier administrateur.');
    }

    this.settings.auth.adminRoles[discordId] = role;
    this.save();
    return this.getAdminsWithRoles();
  }

  // NB: la mise à jour de la table tenant_admins (utilisée pour retrouver
  // à quel tenant appartient un discord_id à la connexion) est faite par
  // l'appelant (tenantManager.addAdminToTenant) en plus de cet appel, pour
  // garder ce fichier indépendant de la connexion DB "métier".
  addAdmin(discordId, role = 'administrateur') {
    this._assertReady();
    if (!TenantStore.ROLES.includes(role)) role = 'administrateur';
    if (!this.settings.auth.adminIds.includes(discordId)) {
      this.settings.auth.adminIds.push(discordId);
    }
    this.settings.auth.adminRoles[discordId] = role;
    this.save();
    return this.getAdminsWithRoles();
  }

  removeAdmin(discordId) {
    this._assertReady();
    this.settings.auth.adminIds = this.settings.auth.adminIds.filter((id) => id !== discordId);
    delete this.settings.auth.adminRoles[discordId];
    this.save();
    return this.getAdminsWithRoles();
  }

  getGuildId() {
    this._assertReady();
    return this.settings.auth.guildId || '';
  }

  setGuildId(guildId) {
    this._assertReady();
    this.settings.auth.guildId = guildId;
    this.save();
  }

  // ── Bot settings ──────────────────────────────────────
  getBot() {
    this._assertReady();
    return { ...this.settings.bot };
  }

  setBot(patch) {
    this._assertReady();
    const before = JSON.stringify(this.settings.bot);
    this.settings.bot = deepMerge(this.settings.bot, patch);
    this.save();
    const after = JSON.stringify(this.settings.bot);
    if (before !== after) this.emit('botSettingsChanged', this.getBot());
    return this.getBot();
  }

  // ── Bot status FiveM (second bot, distinct du bot principal) ──
  getStatusBot() {
    this._assertReady();
    if (!this.settings.statusBot) {
      this.settings.statusBot = {
        token: '',
        enabled: false,
        cfxCode: '',
        mode: 'voice-name',
        refreshSeconds: 60,
        guildId: '',
        statusChannelId: '',
        nameFormat: '🟢 {players}/{maxplayers} joueurs',
        lastServerStatus: null,
      };
    }
    return { ...this.settings.statusBot };
  }

  setStatusBot(patch) {
    this._assertReady();
    const before = this.getStatusBot();
    this.settings.statusBot = deepMerge(before, patch);
    this.save();
    const after = this.getStatusBot();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.emit('statusBotSettingsChanged', after);
    }
    return after;
  }

  // ── Abonnement & paiement ───────────────────────────────
  getSubscription() {
    this._assertReady();
    return JSON.parse(JSON.stringify(this.settings.subscription));
  }

  setSubscription(patch) {
    this._assertReady();
    this.settings.subscription = deepMerge(this.settings.subscription, patch);
    this.save();
    return this.getSubscription();
  }

  // ── Ticket types ──────────────────────────────────────
  getTicketTypes() {
    this._assertReady();
    return this.settings.ticketTypes.map((t) => ({ ...t }));
  }

  setTicketTypes(types) {
    this._assertReady();
    this.settings.ticketTypes = types;
    this.save();
    this.emit('ticketTypesChanged', this.getTicketTypes());
    return this.getTicketTypes();
  }

  getAllKnownRoleIds() {
    this._assertReady();
    const ids = new Set();
    for (const t of this.settings.ticketTypes) {
      for (const r of t.allowedRoles || []) ids.add(r);
    }
    return [...ids];
  }
}

// ─────────────────────────────────────────────────────────────────
// TenantManager : résout/crée les tenants, met en cache une instance
// TenantStore par tenant_id (jamais deux instances pour le même id).
// ─────────────────────────────────────────────────────────────────
class TenantManager {
  constructor() {
    this._cache = new Map(); // tenantId -> TenantStore (initialisé)
  }

  async getStore(tenantId) {
    if (!tenantId) throw new Error('getStore appelé sans tenantId.');
    if (this._cache.has(tenantId)) return this._cache.get(tenantId);
    const store = new TenantStore(tenantId);
    await store.init();
    this._cache.set(tenantId, store);
    return store;
  }

  // Retourne le tenant_id auquel appartient ce discord_id (admin), ou null.
  // Un discord_id n'appartient qu'à UN SEUL tenant (contrainte volontaire :
  // pas de compte "multi-client" pour l'instant — évite toute ambiguïté
  // de session comme celle qui a causé le bug initial).
  async findTenantIdForDiscordUser(discordId) {
    await ensureSchema();
    const [rows] = await pool.query('SELECT tenant_id FROM tenant_admins WHERE discord_id = ? LIMIT 1', [discordId]);
    return rows.length ? rows[0].tenant_id : null;
  }

  // Crée un tenant tout neuf (dashboard vierge) pour ce discord_id, à
  // partir des defaults de data/settings.default.json. C'est LE point
  // d'entrée qui garantit qu'un nouveau client ne voit JAMAIS les
  // données d'un autre : chaque activation crée sa propre ligne isolée.
  async createTenantForDiscordUser(discordId, name) {
    await ensureSchema();
    const [result] = await pool.query(
      'INSERT INTO tenants (owner_discord_id, name) VALUES (?, ?)',
      [discordId, name || null]
    );
    const tenantId = result.insertId;
    await this.addAdminToTenant(tenantId, discordId);
    // Force la création du document de settings par défaut en base.
    await this.getStore(tenantId);
    return tenantId;
  }

  async addAdminToTenant(tenantId, discordId, role = 'administrateur') {
    await ensureSchema();
    await pool.query(
      'INSERT IGNORE INTO tenant_admins (tenant_id, discord_id) VALUES (?, ?)',
      [tenantId, discordId]
    );
    const store = await this.getStore(tenantId);
    store.addAdmin(discordId, role);
  }

  async removeAdminFromTenant(tenantId, discordId) {
    await ensureSchema();
    await pool.query('DELETE FROM tenant_admins WHERE tenant_id = ? AND discord_id = ?', [tenantId, discordId]);
    const store = await this.getStore(tenantId);
    store.removeAdmin(discordId);
  }
}

module.exports = {
  globalStore: new GlobalStore(),
  tenantManager: new TenantManager(),
  TenantStore,
};
