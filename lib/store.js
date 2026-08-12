const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { pool, ensureSchema } = require('./db');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'settings.default.json');
const SETTINGS_KEY = 'settings';

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

class Store extends EventEmitter {
  constructor() {
    super();
    this.settings = null;
    this.ready = false;
    this._initPromise = null;
  }

  // Doit être attendu (await store.init()) avant de démarrer le serveur/le bot.
  // C'est ici qu'on charge (ou crée) les settings depuis MySQL, qui lui,
  // contrairement au disque du conteneur, survit aux redeploys/redémarrages.
  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._load();
    await this._initPromise;
    this.ready = true;
    return this.settings;
  }

  _assertReady() {
    if (!this.ready) {
      throw new Error('Store non initialisé — appelle await store.init() au démarrage avant toute autre opération.');
    }
  }

  async _load() {
    await ensureSchema();

    const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));

    let current = {};
    try {
      const [rows] = await pool.query('SELECT value FROM kv_store WHERE `key` = ?', [SETTINGS_KEY]);
      if (rows.length) current = JSON.parse(rows[0].value);
    } catch (err) {
      console.error('⚠️ Impossible de lire les settings depuis MySQL, utilisation des valeurs par défaut:', err.message);
    }

    const merged = deepMerge(defaults, current);

    if (!merged.sessionSecret) {
      merged.sessionSecret = crypto.randomBytes(32).toString('hex');
    }

    this.settings = merged;
    await this._write(merged);
    return merged;
  }

  async _write(data) {
    const json = JSON.stringify(data);
    try {
      await pool.query(
        'INSERT INTO kv_store (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [SETTINGS_KEY, json]
      );
    } catch (err) {
      console.error('❌ Échec de sauvegarde des settings en base MySQL:', err.message);
      throw err;
    }
  }

  // Sauvegarde synchrone (API conservée) qui déclenche l'écriture async en base
  // et loggue si jamais ça échoue, pour ne jamais perdre silencieusement une donnée.
  save() {
    this._write(this.settings).catch(() => {});
  }

  // ── Auth (Discord OAuth2) ───────────────────────────────
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

  isAdmin(discordId) {
    this._assertReady();
    return this.settings.auth.adminIds.includes(discordId);
  }

  hasAnyAdmin() {
    this._assertReady();
    return this.settings.auth.adminIds.length > 0;
  }

  addAdmin(discordId) {
    this._assertReady();
    if (!this.settings.auth.adminIds.includes(discordId)) {
      this.settings.auth.adminIds.push(discordId);
      this.save();
    }
    return this.getAuthConfig();
  }

  removeAdmin(discordId) {
    this._assertReady();
    this.settings.auth.adminIds = this.settings.auth.adminIds.filter((id) => id !== discordId);
    this.save();
    return this.getAuthConfig();
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

module.exports = new Store();
