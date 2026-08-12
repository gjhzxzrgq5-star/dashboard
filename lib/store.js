const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const DEFAULT_PATH = path.join(DATA_DIR, 'settings.default.json');

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
    this.settings = this._load();
  }

  _load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));

    let current = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      try {
        current = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      } catch (err) {
        console.error('⚠️ settings.json corrompu, réinitialisation partielle:', err.message);
      }
    }

    const merged = deepMerge(defaults, current);

    if (!merged.sessionSecret) {
      merged.sessionSecret = crypto.randomBytes(32).toString('hex');
    }

    this._write(merged);
    return merged;
  }

  _write(data) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  save() {
    this._write(this.settings);
  }

  // ── Auth (Discord OAuth2) ───────────────────────────────
  hasAuthApp() {
    return !!(this.settings.auth.clientId && this.settings.auth.clientSecret);
  }

  getAuthConfig() {
    return { ...this.settings.auth };
  }

  setAuthConfig(patch) {
    this.settings.auth = deepMerge(this.settings.auth, patch);
    this.save();
    return this.getAuthConfig();
  }

  getSessionSecret() {
    return this.settings.sessionSecret;
  }

  isAdmin(discordId) {
    return this.settings.auth.adminIds.includes(discordId);
  }

  hasAnyAdmin() {
    return this.settings.auth.adminIds.length > 0;
  }

  addAdmin(discordId) {
    if (!this.settings.auth.adminIds.includes(discordId)) {
      this.settings.auth.adminIds.push(discordId);
      this.save();
    }
    return this.getAuthConfig();
  }

  removeAdmin(discordId) {
    this.settings.auth.adminIds = this.settings.auth.adminIds.filter((id) => id !== discordId);
    this.save();
    return this.getAuthConfig();
  }

  // ── Bot settings ──────────────────────────────────────
  getBot() {
    return { ...this.settings.bot };
  }

  setBot(patch) {
    const before = JSON.stringify(this.settings.bot);
    this.settings.bot = deepMerge(this.settings.bot, patch);
    this.save();
    const after = JSON.stringify(this.settings.bot);
    if (before !== after) this.emit('botSettingsChanged', this.getBot());
    return this.getBot();
  }

  // ── Ticket types ──────────────────────────────────────
  getTicketTypes() {
    return this.settings.ticketTypes.map((t) => ({ ...t }));
  }

  setTicketTypes(types) {
    this.settings.ticketTypes = types;
    this.save();
    this.emit('ticketTypesChanged', this.getTicketTypes());
    return this.getTicketTypes();
  }

  getAllKnownRoleIds() {
    const ids = new Set();
    for (const t of this.settings.ticketTypes) {
      for (const r of t.allowedRoles || []) ids.add(r);
    }
    return [...ids];
  }
}

module.exports = new Store();
