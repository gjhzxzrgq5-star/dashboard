require('dotenv').config();

const createDashboardServer = require('./dashboard/server');
const bot = require('./lib/bot');
const store = require('./lib/store');

const PORT = process.env.DASHBOARD_PORT || 3000;
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

const app = createDashboardServer();

const express = require('express');
const cors = require('cors'); 
<<<<<<< HEAD

=======
>>>>>>> 193a48b (Mise à jour du dashboard)

app.use(cors()); 
app.use(express.json());

//--------------
app.get('/api/tickets', async (req, res) => {
  const guild = bot.guilds.cache.get("ID_DE_TON_SERVEUR");
  if (!guild) return res.json([]);


  const ticketChannels = guild.channels.cache.filter(c => c.parentId === "ID_CATEGORIE_TICKETS" && c.isTextBased());
  
  const tickets = [];
  for (const [id, channel] of ticketChannels) {
    const messages = await channel.messages.fetch({ limit: 10 });
    tickets.push({
      id: channel.id,
      name: channel.name,
      messages: messages.reverse().map(m => ({
        sender: m.author.username,
        text: m.content,
        time: m.createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      }))
    });
  }
  
  res.json(tickets);
});


app.post('/api/tickets/reply', async (req, res) => {
  const { channelId, message } = req.body;
  const channel = bot.channels.cache.get(channelId);
  

 //________________________________


  if (channel) {
    await channel.send(`**[Staff Web]** ${message}`);
    return res.json({ success: true });
  }
  res.status(404).json({ error: "Salon introuvable" });
});

app.listen(PORT, HOST, () => {
  console.log(`🖥️  Dashboard disponible sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (!store.hasAuthApp()) {
    console.log("👉 Ouvre le dashboard pour configurer la connexion via Discord (/setup).");
  }
});

// Si un token est déjà configuré (ex: migration depuis une install existante), on démarre direct.
if (store.getBot().token) {
  bot.start();
} else {
  console.log('🔑 Aucun token configuré — renseigne-le depuis l\'onglet "Connexion bot" du dashboard.');
}

process.on('SIGINT', async () => {
  console.log('\n👋 Arrêt en cours…');
  await bot.stop();
  process.exit(0);
});
