const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { EventEmitter } = require('events');

const { fetchServerStatus } = require('./cfxApi');

// Cf. botManager.js : évite un blocage indéfini sur "connecting" si
// client.login() ne résout ni ne rejette jamais (réseau/pare-feu).
const CONNECT_TIMEOUT_MS = 15000;

// Plancher dur : Discord n'autorise que ~2 renommages de salon toutes les
// 10 minutes. Même si l'utilisateur configure un intervalle de poll plus
// court, on ne renomme jamais le salon vocal plus souvent que ça.
const MIN_VOICE_RENAME_INTERVAL_MS = 5 * 60 * 1000;
const MIN_REFRESH_SECONDS = 30;

// ── StatusBotController : UN bot Discord "statut FiveM" pour UN tenant ──
// Volontairement séparé de BotController (bot.js) : c'est une application
// Discord distincte (token distinct), avec des permissions et un rôle très
// différents (uniquement lecture d'API CFX + renommage de salon / édition
// d'embed, pas de tickets/modmail).
class StatusBotController extends EventEmitter {
  constructor(tenantId, store) {
    super();
    this.tenantId = tenantId;
    this.store = store;
    this.client = null;
    this.status = 'offline'; // offline | connecting | online | error
    this.lastError = null;
    this._loggedInToken = null;
    this._pollTimer = null;
    this._lastVoiceRenameAt = 0;
    this._lastKnownStatus = null;
    this._connectTimer = null;
    this._loginSettled = false;

    store.on('statusBotSettingsChanged', (cfg) => this._onSettingsChanged(cfg));
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      tag: this.client?.user?.tag || null,
      lastServerStatus: this._lastKnownStatus,
    };
  }

  async _onSettingsChanged(cfg) {
    const currentToken = this._loggedInToken;
    if (cfg.token && cfg.token !== currentToken) {
      await this.restart();
      return;
    }
    if (!cfg.enabled) {
      this._stopPolling();
      return;
    }
    if (this.status === 'online') this._startPolling();
  }

  async start() {
    const cfg = this.store.getStatusBot();
    if (!cfg?.token) {
      this.status = 'offline';
      this.lastError = 'Aucun token de bot status configuré (onglet "Connexion bot").';
      this.emit('statusChanged', this.getStatus());
      return this.getStatus();
    }

    if (this.client) await this.stop();

    this.status = 'connecting';
    this.lastError = null;
    this._loginSettled = false;
    this.emit('statusChanged', this.getStatus());

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    this._registerHandlers();

    // Cf. botManager.js : filet de sécurité contre un blocage indéfini
    // sur "connecting" si login() ne résout ni ne rejette jamais.
    this._connectTimer = setTimeout(() => {
      if (this._loginSettled) return;
      this._loginSettled = true;
      this.status = 'error';
      this.lastError =
        `Le bot status n'a pas réussi à se connecter à Discord en ${CONNECT_TIMEOUT_MS / 1000}s ` +
        `(aucune réponse, ni succès ni erreur). Causes les plus fréquentes : token invalide ` +
        `ou régénéré depuis, ou connexions sortantes WebSocket bloquées par l'hébergeur/pare-feu.`;
      this._loggedInToken = null;
      console.error(`❌ [tenant ${this.tenantId}] Timeout de connexion bot status (${CONNECT_TIMEOUT_MS}ms écoulées).`);
      this.emit('statusChanged', this.getStatus());
      this.client?.destroy().catch(() => {});
    }, CONNECT_TIMEOUT_MS);

    try {
      await this.client.login(cfg.token);
      this._loggedInToken = cfg.token;
    } catch (err) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
      if (!this._loginSettled) {
        this._loginSettled = true;
        this.status = 'error';
        this.lastError = `Connexion échouée : ${err.message}`;
        this._loggedInToken = null;
        console.error(`❌ [tenant ${this.tenantId}] Erreur de connexion bot status:`, err.message);
        this.emit('statusChanged', this.getStatus());
      }
      return this.getStatus();
    }

    clearTimeout(this._connectTimer);
    this._connectTimer = null;
    return this.getStatus();
  }

  async stop() {
    this._stopPolling();
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
    this._loginSettled = true;
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch {}
    this.client = null;
    this._loggedInToken = null;
    this.status = 'offline';
    this.emit('statusChanged', this.getStatus());
  }

  async restart() {
    // Cf. botManager.js : coalesce les restart() concurrents pour éviter
    // qu'un stop()/start() en écrase un autre en plein milieu de la
    // connexion et laisse le statut bloqué sur "connecting".
    if (this._restarting) return this._restarting;
    this._restarting = (async () => {
      await this.stop();
      return this.start();
    })();
    try {
      return await this._restarting;
    } finally {
      this._restarting = null;
    }
  }

  _registerHandlers() {
    const client = this.client;

    // Écoute 'clientReady' ET 'ready' (cf. botManager.js) pour ne pas
    // rester bloqué sur "connecting" selon la version de discord.js.
    let becameReady = false;
    const onReady = () => {
      if (becameReady) return;
      becameReady = true;
      this._loginSettled = true;
      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }
      console.log(`✅ [tenant ${this.tenantId}] Bot status connecté en tant que ${client.user.tag}`);
      this.status = 'online';
      this.lastError = null;
      this.emit('statusChanged', this.getStatus());
      this._startPolling();
    };
    client.once('clientReady', onReady);
    client.once('ready', onReady);

    client.on('error', (err) => {
      console.error(`Erreur client Discord status (tenant ${this.tenantId}):`, err.message);
      this.lastError = err.message;
      this.emit('statusChanged', this.getStatus());
    });

    client.on('shardError', (err, shardId) => {
      console.error(`❌ [tenant ${this.tenantId}] Erreur shard status ${shardId}:`, err.message);
      this.lastError = err.message;
      this.emit('statusChanged', this.getStatus());
    });

    client.on('warn', (info) => {
      console.warn(`⚠️ [tenant ${this.tenantId}] Avertissement discord.js (status):`, info);
    });

    if (process.env.DEBUG_DISCORD === 'true') {
      client.on('debug', (info) => console.log(`[debug tenant ${this.tenantId} status]`, info));
    }

    client.on('shardReconnecting', () => {
      console.log(`🔄 [tenant ${this.tenantId}] Reconnexion du shard (bot status) en cours…`);
    });
    client.on('shardResume', () => {
      this.status = 'online';
      this.emit('statusChanged', this.getStatus());
    });
    client.on('invalidated', () => {
      console.error(`❌ [tenant ${this.tenantId}] Session Discord invalidée (bot status).`);
      this.status = 'error';
      this.lastError = 'Session invalidée par Discord.';
      this.client = null;
      this._stopPolling();
      this.emit('statusChanged', this.getStatus());
    });
  }

  // ── Récupération des serveurs/salons visibles par CE bot (distinct du
  // bot principal — il faut l'inviter séparément sur le serveur staff). ──
  listGuilds() {
    if (!this.client || this.status !== 'online') return [];
    return this.client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
  }

  async listChannels(guildId) {
    if (!this.client || this.status !== 'online') return [];
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return [];
    const channels = await guild.channels.fetch();
    return channels
      .filter((c) => c && (c.isVoiceBased?.() || c.isTextBased?.()))
      .map((c) => ({ id: c.id, name: c.name, type: c.isVoiceBased?.() ? 'voice' : 'text' }));
  }

  _startPolling() {
    this._stopPolling();
    const cfg = this.store.getStatusBot();
    if (!cfg.enabled || !cfg.cfxCode) return;

    const intervalMs = Math.max(cfg.refreshSeconds || 60, MIN_REFRESH_SECONDS) * 1000;
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), intervalMs);
  }

  _stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  async _poll() {
    const cfg = this.store.getStatusBot();
    if (!cfg.enabled || !cfg.cfxCode) return;

    try {
      const data = await fetchServerStatus(cfg.cfxCode);
      this._lastKnownStatus = { ...data, checkedAt: Date.now() };
    } catch (err) {
      this._lastKnownStatus = { online: false, error: err.message, checkedAt: Date.now() };
    }

    this.emit('serverStatusUpdate', this._lastKnownStatus);

    if (cfg.mode === 'voice-name' || cfg.mode === 'both') {
      await this._updateVoiceChannel(cfg, this._lastKnownStatus);
    }
    if (cfg.mode === 'embed' || cfg.mode === 'both') {
      await this._updateEmbed(cfg, this._lastKnownStatus);
    }
  }

  _formatName(template, data) {
    const tpl = template || '🟢 {players}/{maxplayers} joueurs';
    if (!data.online) {
      return tpl
        .replaceAll('{status}', '🔴 Hors ligne')
        .replaceAll('{players}', '0')
        .replaceAll('{maxplayers}', '?')
        .replaceAll('{hostname}', 'Hors ligne');
    }
    return tpl
      .replaceAll('{status}', '🟢 En ligne')
      .replaceAll('{players}', String(data.players))
      .replaceAll('{maxplayers}', String(data.maxPlayers))
      .replaceAll('{hostname}', data.hostname);
  }

  async _updateVoiceChannel(cfg, data) {
    if (!this.client || this.status !== 'online' || !cfg.statusChannelId) return;

    const now = Date.now();
    if (now - this._lastVoiceRenameAt < MIN_VOICE_RENAME_INTERVAL_MS) return;

    try {
      const channel = await this.client.channels.fetch(cfg.statusChannelId);
      if (!channel || !channel.isVoiceBased?.()) return;

      const newName = this._formatName(cfg.nameFormat, data).slice(0, 100);
      if (channel.name === newName) return;

      await channel.setName(newName);
      this._lastVoiceRenameAt = now;
    } catch (err) {
      console.error(`Erreur renommage salon status (tenant ${this.tenantId}):`, err.message);
      this.lastError = `Renommage du salon impossible : ${err.message}`;
      this.emit('statusChanged', this.getStatus());
    }
  }

  async _updateEmbed(cfg, data) {
    if (!this.client || this.status !== 'online' || !cfg.statusChannelId) return;

    try {
      const channel = await this.client.channels.fetch(cfg.statusChannelId);
      if (!channel || channel.isVoiceBased?.()) return;

      const embed = new EmbedBuilder()
        .setTitle(data.online ? `🟢 ${data.hostname}` : '🔴 Serveur hors ligne')
        .setColor(data.online ? 0x2ecc71 : 0xff4d4d)
        .setTimestamp();

      if (data.online) {
        embed.addFields({ name: 'Joueurs connectés', value: `${data.players} / ${data.maxPlayers}`, inline: true });
      } else if (data.error) {
        embed.setDescription(`Erreur : ${data.error}`);
      }

      const messages = await channel.messages.fetch({ limit: 50 });
      const existing = messages.find((m) => m.author.id === this.client.user.id && m.embeds.length > 0);

      if (existing) {
        await existing.edit({ embeds: [embed] });
      } else {
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error(`Erreur embed status (tenant ${this.tenantId}):`, err.message);
      this.lastError = `Mise à jour de l'embed impossible : ${err.message}`;
      this.emit('statusChanged', this.getStatus());
    }
  }
}

// ── StatusBotManager : Map<tenantId, StatusBotController> ───────────────
class StatusBotManager {
  constructor() {
    this._controllers = new Map();
  }

  get(tenantId, store) {
    if (!this._controllers.has(tenantId)) {
      if (!store) throw new Error(`statusBotManager.get(${tenantId}) appelé sans store alors qu'aucun contrôleur n'existe encore.`);
      this._controllers.set(tenantId, new StatusBotController(tenantId, store));
    }
    return this._controllers.get(tenantId);
  }

  has(tenantId) {
    return this._controllers.has(tenantId);
  }

  async stopAll() {
    await Promise.all([...this._controllers.values()].map((c) => c.stop().catch(() => {})));
  }

  allControllers() {
    return [...this._controllers.values()];
  }
}

module.exports = new StatusBotManager();
