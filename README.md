# Ticket Bot — avec dashboard de configuration

Bot Discord de tickets (modmail) entièrement configurable depuis un dashboard web :
token, salon du panel, serveur staff, catégorie, et **tous les types de tickets avec
leurs rôles, couleurs et emojis** — sans toucher au code. Toute modification s'applique
à chaud, sans redémarrer le processus.

Le dashboard se protège désormais par **connexion Discord (OAuth2)** — plus de mot
de passe à retenir ni à faire fuiter : seuls les comptes Discord que tu autorises
explicitement peuvent y accéder.

## Installation

```bash
npm install
npm start
```

Au démarrage, le dashboard s'ouvre sur `http://localhost:3000` (configurable via
`DASHBOARD_PORT` dans un fichier `.env`, voir `.env.example`).

## Premier lancement

1. Ouvre `http://localhost:3000` → tu arrives sur `/setup`.
2. Crée une application Discord dédiée au dashboard (gratuit, 1 minute) :
   - [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
   - Onglet **OAuth2** → copie le **Client ID** et génère le **Client Secret**.
   - Ajoute l'URL "Redirect URI" affichée sur la page `/setup` dans **OAuth2 → Redirects**
     du portail (elle doit être identique des deux côtés).
   - Colle Client ID / Client Secret / Redirect URI dans le formulaire et valide.
3. Tu es redirigé vers `/login` → clique sur **"Se connecter avec Discord"**.
   Le tout premier compte à se connecter devient automatiquement administrateur.
   Tu peux ensuite en ajouter/retirer d'autres depuis l'onglet **👥 Accès admin**.
4. Va dans **🔑 Connexion bot** :
   - Colle le token de ton **bot** Discord (différent de l'appli OAuth ci-dessus —
     Developer Portal → ton appli bot → Bot → "Reset Token").
   - Clique sur "Enregistrer et connecter". Le bot se connecte automatiquement.
5. Va dans **⚙️ Configuration générale** :
   - Choisis le **serveur** et le **salon** où le panel de tickets doit être
     envoyé (menus déroulants, remplis automatiquement une fois le bot connecté).
   - Choisis le **serveur staff** (celui où les salons de tickets seront créés)
     et éventuellement une **catégorie**.
   - Personnalise titre, description, bannière, couleur et pied de page du panel.
6. Va dans **🎟️ Types de tickets** pour ajouter/modifier/supprimer des types
   (bouton du panel). Pour chaque type : emoji, nom, description, couleur, et
   les **rôles staff autorisés** à voir ce type de ticket (liste tirée en direct
   des rôles du serveur staff choisi à l'étape précédente).

Tout est sauvegardé dans `data/settings.json` et pris en compte immédiatement —
le panel Discord est republié automatiquement dès qu'un type de ticket ou la
config générale change.

## ✨ Fonctionnalités premium

- **📊 Statistiques** : total de tickets, ouverts/fermés, tickets en attente de
  prise en charge, temps de résolution moyen, répartition par type et activité
  récente — le tout calculé en direct depuis `data/tickets.json`.
- **⬇️ Export CSV** : exporte l'historique complet des tickets en un clic depuis
  l'onglet Statistiques, pour l'archiver ou l'analyser ailleurs.
- **👥 Accès admin multi-comptes** : ajoute ou retire des administrateurs Discord
  directement depuis le dashboard, sans toucher aux fichiers.
- **🔐 Connexion Discord OAuth2** : plus de mot de passe partagé — chaque
  administrateur se connecte avec son propre compte Discord.

## ⚠️ Sécurité — à faire avant toute mise en vente/partage

Si tu réutilises un `data/settings.json` d'une installation précédente, son
token de bot doit être considéré comme compromis dès qu'il a pu être vu par
un tiers. **Régénère-le** depuis le Discord Developer Portal (Bot → Reset
Token) avant de redéployer, et ne colle que le **nouveau** token dans le
dashboard. Ne redistribue jamais le dossier `data/` (il contient le token du
bot, le Client Secret OAuth, la liste des administrateurs et les tickets en
cours) — il est déjà exclu par `.gitignore`.

Le Client Secret OAuth (étape de `/setup`) est aussi sensible qu'un mot de
passe : ne le partage jamais et régénère-le depuis le Developer Portal si tu
penses qu'il a fuité.

Si tu exposes le dashboard sur Internet (pas juste en local), mets-le derrière
un reverse proxy HTTPS (Caddy/Nginx) — l'échange OAuth2 avec Discord l'exige
généralement en production — et pense à retirer l'accès admin d'un compte
depuis l'onglet **👥 Accès admin** si tu doutes de sa sécurité.

## Revente à des tiers

Comme c'est pensé pour être installé par n'importe quel acheteur :

- Chaque installation a son propre `data/settings.json` (créé au premier lancement,
  vide par défaut — sauf la tienne qui a été pré-remplie avec la config White FA
  actuelle, token excepté).
- Un acheteur n'a besoin de rien éditer dans le code : `npm install`, `npm start`,
  puis tout se fait dans le dashboard (mot de passe, token, salons, rôles, types).
- Les menus déroulants (serveur/salon/catégorie/rôles) ne se remplissent qu'une
  fois le bot connecté (après avoir collé un token valide et invité le bot sur
  ses serveurs).

## Structure du projet

```
index.js                  → point d'entrée (démarre dashboard + bot)
lib/store.js               → lecture/écriture de data/settings.json
lib/config.js               → construction des embeds, lit le store en direct
lib/bot.js                  → client Discord, (re)connexion pilotée par le dashboard
lib/ticketManager.js        → logique des tickets (création, claim, close, relay)
dashboard/server.js         → serveur Express (auth Discord OAuth2 + API de configuration)
dashboard/public/           → pages HTML + JS + CSS du dashboard
data/settings.json          → config (OAuth, admins, token bot, salons, rôles, types)
data/tickets.json           → tickets actifs/historique (source des statistiques)
```
