const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { EventEmitter } = require('events');

const TicketManager = require('./ticketManager');
const { getTicketTypes, createPanelEmbed, isValidEmoji } = require('./config');

// Délai max qu'on laisse à client.login() pour aboutir (succès OU échec).
// discord.js peut rester en attente indéfiniment côté réseau (WebSocket
// bloqué par un pare-feu/hébergeur, DNS qui ne répond pas, etc.) sans
// jamais résoudre NI rejeter la promesse de login() — dans ce cas le
// statut restait bloqué sur "connecting" pour toujours, sans aucune
// erreur affichée. Ce timeout garantit qu'on sort TOUJOURS de l'état
// "connecting" au bout d'un temps fini, avec un message exploitable.
const CONNECT_TIMEOUT_MS = 15000;

// ── BotController : UN bot Discord pour UN tenant ────────────────────
// Chaque client fournit son propre token (cf. la décision produit :
// "Chaque client doit créer et fournir son propre bot/token Discord").
// Avant ce patch, il n'existait qu'UNE seule instance globale (bot.js),
// donc un seul bot/token pour TOUT le monde — incompatible avec cette
// décision, et une des causes de la fuite de données entre clients.
class BotController extends EventEmitter {
  constructor(tenantId, store) {
    super();
    this.tenantId = tenantId;
    this.store = store;
    this.client = null;
    this.ticketManager = null;
    this.status = 'offline'; // offline | connecting | online | error
    this.lastError = null;
    this._loggedInToken = null;
    this._connectTimer = null;
    this._loginSettled = false;

    store.on('botSettingsChanged', (bot) => this._onBotSettingsChanged(bot));
    store.on('ticketTypesChanged', () => this._refreshPanel());
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      tag: this.client?.user?.tag || null,
      guildCount: this.client?.guilds?.cache?.size ?? 0,
      ping: this.client?.ws?.ping ?? null,
    };
  }

  async _onBotSettingsChanged(bot) {
    const currentToken = this._loggedInToken;
    if (bot.token && bot.token !== currentToken) {
      await this.restart();
    } else if (this.status === 'online') {
      await this._refreshPanel();
    }
  }

  async start() {
    const bot = this.store.getBot();
    if (!bot.token) {
      this.status = 'offline';
      this.lastError = 'Aucun token configuré. Renseigne-le depuis le dashboard.';
      this.emit('statusChanged', this.getStatus());
      return this.getStatus();
    }

    if (this.client) await this.stop();

    this.status = 'connecting';
    this.lastError = null;
    this._loginSettled = false;
    this.emit('statusChanged', this.getStatus());

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    });

    this.ticketManager = new TicketManager(this.client, this.tenantId, this.store);
    this._registerHandlers();

    // Filet de sécurité : si ni un succès (événement ready), ni un échec
    // (rejet de login()) ne se produit dans le délai imparti, on force la
    // sortie de l'état "connecting" nous-mêmes, avec un message qui liste
    // les causes les plus probables, et on détruit le client pendant.
    this._connectTimer = setTimeout(() => {
      if (this._loginSettled) return;
      this._loginSettled = true;
      this.status = 'error';
      this.lastError =
        `Le bot n'a pas réussi à se connecter à Discord en ${CONNECT_TIMEOUT_MS / 1000}s ` +
        `(aucune réponse, ni succès ni erreur). Causes les plus fréquentes : token invalide ` +
        `ou régénéré depuis, intents privilégiés non activés sur le Developer Portal ` +
        `("Server Members Intent" et "Message Content Intent"), ou connexions sortantes ` +
        `WebSocket bloquées par l'hébergeur/pare-feu (vérifie que le port 443 sortant vers ` +
        `gateway.discord.gg n'est pas filtré).`;
      this._loggedInToken = null;
      console.error(`❌ [tenant ${this.tenantId}] Timeout de connexion bot (${CONNECT_TIMEOUT_MS}ms écoulées sans ready ni erreur).`);
      this.emit('statusChanged', this.getStatus());
      this.client?.destroy().catch(() => {});
    }, CONNECT_TIMEOUT_MS);

    try {
      await this.client.login(bot.token);
      this._loggedInToken = bot.token;
    } catch (err) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
      if (!this._loginSettled) {
        this._loginSettled = true;
        this.status = 'error';
        this.lastError = `Connexion échouée : ${err.message}`;
        this._loggedInToken = null;
        console.error(`❌ [tenant ${this.tenantId}] Erreur de connexion bot:`, err.message);
        this.emit('statusChanged', this.getStatus());
      }
      return this.getStatus();
    }

    // NE PAS annuler _connectTimer ici : login() se résout dès que la
    // connexion WebSocket est établie/identifiée, ce qui arrive AVANT
    // l'événement 'ready'/'clientReady'. Si on annule le watchdog à cet
    // instant, un 'ready' qui ne se déclenche jamais (session bloquée,
    // coupure réseau juste après le handshake, etc.) laisse le statut
    // bloqué sur "connecting" pour toujours, sans filet de sécurité.
    // Seuls onReady() (succès) ou le catch ci-dessus (échec de login)
    // doivent arrêter ce timer.
    return this.getStatus();
  }

  async stop() {
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
    this.ticketManager = null;
    this._loggedInToken = null;
    this.status = 'offline';
    this.emit('statusChanged', this.getStatus());
  }

  async restart() {
    // Coalesce concurrent restart() calls onto a single in-flight
    // operation. Sans ça, un restart déclenché par l'écouteur
    // 'botSettingsChanged' (émis par setBot) et un restart explicite
    // lancé juste après par la route /settings/bot s'exécutaient en
    // parallèle : le second stop()/start() détruisait le client créé
    // par le premier pendant sa connexion, laissant le statut bloqué
    // sur "connecting" indéfiniment.
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

    // Écoute 'clientReady' ET l'ancien nom 'ready' : selon la version de
    // discord.js réellement installée, seul l'un des deux peut être émis.
    // Si seul 'clientReady' est écouté et que l'environnement n'émet que
    // 'ready', le bot reste bloqué sur "connecting" pour toujours
    // (WebSocket bien connecté, mais le statut ne passe jamais à
    // "online"). Le flag évite d'exécuter la logique deux fois si les
    // deux événements finissent par être émis.
    let becameReady = false;
    const onReady = async () => {
      if (becameReady) return;
      becameReady = true;
      this._loginSettled = true;
      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }
      console.log(`✅ [tenant ${this.tenantId}] Bot connecté en tant que ${client.user.tag}`);
      this.status = 'online';
      this.lastError = null;
      this.emit('statusChanged', this.getStatus());
      await this.ticketManager.init();
      await this._refreshPanel();
    };
    client.once('clientReady', onReady);
    client.once('ready', onReady);

    client.on('error', (err) => {
      console.error(`Erreur client Discord (tenant ${this.tenantId}):`, err.message);
      this.lastError = err.message;
      this.emit('statusChanged', this.getStatus());
    });

    // Erreurs spécifiques à un shard (ex. websocket coupé pendant le
    // handshake) : distinctes de 'error', et parfois la seule trace qu'on
    // ait quand une connexion reste bloquée.
    client.on('shardError', (err, shardId) => {
      console.error(`❌ [tenant ${this.tenantId}] Erreur shard ${shardId}:`, err.message);
      this.lastError = err.message;
      this.emit('statusChanged', this.getStatus());
    });

    client.on('warn', (info) => {
      console.warn(`⚠️ [tenant ${this.tenantId}] Avertissement discord.js:`, info);
    });

    // Logs bruts du cycle de vie de la connexion. Actif uniquement avec
    // DEBUG_DISCORD=true dans l'environnement, pour ne pas noyer les logs
    // en temps normal — mais indispensable pour diagnostiquer un blocage
    // silencieux (proxy/pare-feu qui coupe la connexion sans erreur claire).
    if (process.env.DEBUG_DISCORD === 'true') {
      client.on('debug', (info) => console.log(`[debug tenant ${this.tenantId}]`, info));
    }

    client.on('shardDisconnect', (event) => {
      console.warn(`⚠️ [tenant ${this.tenantId}] Shard déconnecté (code ${event?.code}), tentative de reconnexion…`);
    });
    client.on('shardReconnecting', () => {
      console.log(`🔄 [tenant ${this.tenantId}] Reconnexion du shard en cours…`);
    });
    client.on('shardResume', () => {
      console.log(`✅ [tenant ${this.tenantId}] Shard reconnecté.`);
      this.status = 'online';
      this.emit('statusChanged', this.getStatus());
    });
    client.on('invalidated', () => {
      console.error(`❌ [tenant ${this.tenantId}] Session Discord invalidée, relance par le watchdog.`);
      this.status = 'error';
      this.lastError = 'Session invalidée par Discord.';
      this.client = null;
      this.emit('statusChanged', this.getStatus());
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      const { customId, user } = interaction;

      if (customId.startsWith('open_ticket_')) {
        const typeId = customId.replace('open_ticket_', '');
        const ticketType = getTicketTypes(this.store).find((t) => t.id === typeId);
        if (!ticketType) return;

        await interaction.deferReply({ ephemeral: true });

        if (this.ticketManager.hasOpenTicket(user.id)) {
          return interaction.editReply({
            content: "❌ Tu as déjà un ticket ouvert ! Termine-le avant d'en ouvrir un nouveau.",
          });
        }

        try {
          await this.ticketManager.createTicket(user, ticketType, interaction.guild);
          await interaction.editReply({
            content: `✅ Ton ticket **${ticketType.label}** a été ouvert ! Vérifie tes messages privés 📬`,
          });
        } catch (err) {
          console.error('Erreur création ticket:', err);
          await interaction.editReply({
            content: `❌ Erreur lors de la création du ticket : ${err.message}`,
          });
        }
        return;
      }

      if (customId.startsWith('ticket_')) {
        const parts = customId.split('_');
        const action = parts[1];
        const ticketId = parts[2];
        const ticket = this.ticketManager.getTicketById(ticketId);

        if (!ticket) {
          return interaction.reply({ content: '❌ Ticket introuvable ou déjà supprimé.', ephemeral: true });
        }

        switch (action) {
          case 'claim':
            await this.ticketManager.claimTicket(interaction, ticket);
            break;
          case 'close':
            await this.ticketManager.closeTicket(interaction, ticket);
            break;
          case 'delete':
            await this.ticketManager.deleteTicket(interaction, ticket);
            break;
          default:
            await interaction.reply({ content: '❌ Action inconnue.', ephemeral: true });
        }
      }
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      if (!message.guild) {
        await this.ticketManager.relayUserToStaff(message);
        return;
      }

      const { staffGuildId } = this.store.getBot();
      if (staffGuildId && message.guild.id === staffGuildId) {
        await this.ticketManager.relayStaffToUser(message);
      }
    });
  }

  _buildTypeRows() {
    const rows = [];
    const types = getTicketTypes(this.store);
    for (let i = 0; i < types.length; i += 5) {
      const chunk = types.slice(i, i + 5);
      const row = new ActionRowBuilder();
      for (const type of chunk) {
        const button = new ButtonBuilder()
          .setCustomId(`open_ticket_${type.id}`)
          .setLabel(type.label)
          .setStyle(ButtonStyle.Secondary);

        if (isValidEmoji(type.emoji)) {
          button.setEmoji(type.emoji);
        } else {
          console.warn(`⚠️ Emoji invalide pour le type de ticket "${type.id}" ("${type.emoji}"), utilisation de 🎫 à la place.`);
          button.setEmoji('🎫');
        }

        row.addComponents(button);
      }
      rows.push(row);
    }
    return rows;
  }

  async _refreshPanel() {
    if (!this.client || this.status !== 'online') {
      return { ok: false, reason: 'Le bot est hors ligne, impossible de republier le panel.' };
    }

    const { panelChannelId } = this.store.getBot();
    if (!panelChannelId) {
      return { ok: false, reason: "Aucun salon de panel configuré (onglet \"Configuration générale\")." };
    }

    try {
      const channel = await this.client.channels.fetch(panelChannelId);
      if (!channel) {
        return { ok: false, reason: 'Le salon configuré pour le panel est introuvable (a-t-il été supprimé ?).' };
      }

      const messages = await channel.messages.fetch({ limit: 50 });
      const existing = messages.find((m) => m.author.id === this.client.user.id && m.embeds.length > 0);
      if (existing) await existing.delete().catch(() => {});

      const rows = this._buildTypeRows();
      const embed = createPanelEmbed(this.store);

      await channel.send({ embeds: [embed], components: rows });
      console.log(`📨 [tenant ${this.tenantId}] Panel envoyé/mis à jour dans le salon`);
      return { ok: true };
    } catch (err) {
      console.error('Erreur panel:', err.message);
      return { ok: false, reason: `Erreur Discord lors de l'envoi du panel : ${err.message} (vérifie les permissions du bot dans ce salon).` };
    }
  }

  async refreshPanel() {
    return this._refreshPanel();
  }
}

// ── BotManager : Map<tenantId, BotController> ────────────────────────
// Point d'entrée unique pour obtenir/démarrer/arrêter le bot d'un tenant.
class BotManager {
  constructor() {
    this._controllers = new Map();
  }

  // Ne démarre RIEN — retourne juste le contrôleur (le crée s'il n'existe
  // pas encore). Le démarrage effectif est explicite (voir `start`) pour
  // ne pas connecter un bot juste parce qu'on a consulté son statut.
  get(tenantId, store) {
    if (!this._controllers.has(tenantId)) {
      if (!store) throw new Error(`botManager.get(${tenantId}) appelé sans store alors qu'aucun contrôleur n'existe encore.`);
      this._controllers.set(tenantId, new BotController(tenantId, store));
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

module.exports = new BotManager();
