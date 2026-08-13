const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { EventEmitter } = require('events');

const store = require('./store');
const TicketManager = require('./ticketManager');
const { getTicketTypes, createPanelEmbed, isValidEmoji } = require('./config');

class BotController extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.ticketManager = null;
    this.status = 'offline'; // offline | connecting | online | error
    this.lastError = null;

    store.on('botSettingsChanged', (bot, prevToken) => this._onBotSettingsChanged(bot));
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
    // Si le token a changé (ou qu'on n'est pas connecté), on relance le client.
    const currentToken = this._loggedInToken;
    if (bot.token && bot.token !== currentToken) {
      await this.restart();
    } else if (this.status === 'online') {
      // Rafraîchit le panel si le salon/couleur/texte ont changé mais pas le token
      await this._refreshPanel();
    }
  }

  async start() {
    const bot = store.getBot();
    if (!bot.token) {
      this.status = 'offline';
      this.lastError = 'Aucun token configuré. Renseigne-le depuis le dashboard.';
      this.emit('statusChanged', this.getStatus());
      return this.getStatus();
    }

    if (this.client) await this.stop();

    this.status = 'connecting';
    this.lastError = null;
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

    this.ticketManager = new TicketManager(this.client);
    this._registerHandlers();

    try {
      await this.client.login(bot.token);
      this._loggedInToken = bot.token;
    } catch (err) {
      this.status = 'error';
      this.lastError = `Connexion échouée : ${err.message}`;
      this._loggedInToken = null;
      console.error('❌ Erreur de connexion bot:', err.message);
      this.emit('statusChanged', this.getStatus());
    }

    return this.getStatus();
  }

  async stop() {
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
    await this.stop();
    await this.start();
  }

  _registerHandlers() {
    const client = this.client;

    client.once('clientReady', async () => {
      console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
      this.status = 'online';
      this.lastError = null;
      this.emit('statusChanged', this.getStatus());
      await this.ticketManager.init();
      await this._refreshPanel();
    });

    client.on('error', (err) => {
      console.error('Erreur client Discord:', err.message);
      this.lastError = err.message;
      this.emit('statusChanged', this.getStatus());
    });

    // discord.js gère déjà la reconnexion automatique du websocket la plupart
    // du temps. On journalise ces événements et on ne marque "offline" que
    // sur une déconnexion vraiment définitive (session invalidée) — le
    // watchdog d'index.js se chargera alors de relancer le client.
    client.on('shardDisconnect', (event) => {
      console.warn(`⚠️ Shard déconnecté (code ${event?.code}), tentative de reconnexion par discord.js…`);
    });
    client.on('shardReconnecting', () => {
      console.log('🔄 Reconnexion du shard en cours…');
    });
    client.on('shardResume', () => {
      console.log('✅ Shard reconnecté.');
      this.status = 'online';
      this.emit('statusChanged', this.getStatus());
    });
    client.on('invalidated', () => {
      console.error('❌ Session Discord invalidée, le client va être relancé par le watchdog.');
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
        const ticketType = getTicketTypes().find((t) => t.id === typeId);
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

      const { staffGuildId } = store.getBot();
      if (staffGuildId && message.guild.id === staffGuildId) {
        await this.ticketManager.relayStaffToUser(message);
      }
    });
  }

  _buildTypeRows() {
    const rows = [];
    const types = getTicketTypes();
    for (let i = 0; i < types.length; i += 5) {
      const chunk = types.slice(i, i + 5);
      const row = new ActionRowBuilder();
      for (const type of chunk) {
        const button = new ButtonBuilder()
          .setCustomId(`open_ticket_${type.id}`)
          .setLabel(type.label)
          .setStyle(ButtonStyle.Secondary);

        // Un emoji invalide (texte libre saisi côté dashboard) faisait
        // planter TOUT l'envoi du panel avec une erreur Discord
        // COMPONENT_INVALID_EMOJI, y compris pour les types de ticket
        // dont l'emoji était correct. On retombe sur un emoji par défaut
        // plutôt que de bloquer tout le panel pour une seule entrée cassée.
        if (isValidEmoji(type.emoji)) {
          button.setEmoji(type.emoji);
        } else {
          console.warn(`⚠️ Emoji invalide pour le type de ticket "${type.id}" ("${type.emoji}"), utilisation de 🎫 à la place. Corrige-le depuis le dashboard.`);
          button.setEmoji('🎫');
        }

        row.addComponents(button);
      }
      rows.push(row);
    }
    return rows;
  }

  // Retourne { ok, reason } au lieu d'échouer en silence : avant, un bot
  // hors ligne, un salon panel non configuré ou une erreur Discord (permissions,
  // salon supprimé...) faisaient tous "return" sans rien signaler, donc le
  // dashboard affichait "Panel republié" alors que rien n'avait été envoyé.
  async _refreshPanel() {
    if (!this.client || this.status !== 'online') {
      return { ok: false, reason: 'Le bot est hors ligne, impossible de republier le panel.' };
    }

    const { panelChannelId } = store.getBot();
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
      const embed = createPanelEmbed();

      await channel.send({ embeds: [embed], components: rows });
      console.log('📨 Panel envoyé/mis à jour dans le salon');
      return { ok: true };
    } catch (err) {
      console.error('Erreur panel:', err.message);
      return { ok: false, reason: `Erreur Discord lors de l'envoi du panel : ${err.message} (vérifie les permissions du bot dans ce salon).` };
    }
  }

  // Utilisé par le dashboard pour republier manuellement le panel
  async refreshPanel() {
    return this._refreshPanel();
  }
}

module.exports = new BotController();
