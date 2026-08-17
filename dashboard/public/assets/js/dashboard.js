<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — MP MOI</title>
<link rel="stylesheet" href="/assets/css/style.css">
<style>
  .icon-svg {
    vertical-align: middle;
    display: inline-block;
    flex-shrink: 0;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .live-chat-box {
    display: flex;
    flex-direction: column;
    height: 350px;
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.2);
  }
  .chat-messages {
    flex: 1;
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chat-input-row {
    display: flex;
    padding: 8px;
    background: rgba(0, 0, 0, 0.4);
    gap: 8px;
  }
  .changelog-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    margin-right: 8px;
  }
  .tag-feat { background: rgba(0, 223, 216, 0.2); color: #00dfd8; border: 1px solid #00dfd8; }
  .tag-fix { background: rgba(255, 77, 77, 0.2); color: #ff4d4d; border: 1px solid #ff4d4d; }
  .tag-imp { background: rgba(255, 184, 0, 0.2); color: #ffb800; border: 1px solid #ffb800; }
  .changelog-list {
    list-style: none;
    padding: 0;
    margin: 12px 0 0 0;
  }
  .changelog-list li {
    margin-bottom: 8px;
    font-size: 14px;
    display: flex;
    align-items: center;
  }
  .tickets-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  .tickets-table th, .tickets-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  }
  .tickets-table th {
    background: rgba(0, 0, 0, 0.3);
    color: #888;
    font-size: 12px;
    text-transform: uppercase;
  }
  .badge-status {
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 12px;
    background: rgba(46, 204, 113, 0.2);
    color: #2ecc71;
    border: 1px solid #2ecc71;
  }
  .sub-status-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: bold;
  }
  .sub-active { background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid #2ecc71; }
  .sub-inactive { background: rgba(255, 77, 77, 0.2); color: #ff4d4d; border: 1px solid #ff4d4d; }
  .payment-method-card {
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 14px;
    background: rgba(0, 0, 0, 0.15);
  }
  .payment-method-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .payment-method-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: bold;
    font-size: 15px;
  }
  .payment-logo {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: bold;
    color: #fff;
    flex-shrink: 0;
  }
  .payment-logo.revolut { background: #0666EB; }
  .payment-logo.paypal { background: #003087; }
  .renew-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
    color: #ccc;
  }
  /* ── Accordéon "liste Discord" pour Configuration générale ── */
  .settings-accordion {
    border: 1px solid var(--border-color, #333);
    border-radius: 10px;
    margin-bottom: 12px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.15);
  }
  .settings-accordion > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 18px;
    cursor: pointer;
    list-style: none;
    user-select: none;
    transition: background 0.15s ease;
  }
  .settings-accordion > summary::-webkit-details-marker { display: none; }
  .settings-accordion > summary::marker { content: ""; }
  .settings-accordion > summary:hover { background: rgba(255, 255, 255, 0.04); }
  .settings-accordion[open] > summary { border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08)); }

  .accordion-summary-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .accordion-icon {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: rgba(88, 101, 242, 0.15);
    color: var(--primary-color, #5865F2);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .accordion-title-block { min-width: 0; }
  .accordion-title-block .accordion-title {
    font-weight: 700;
    font-size: 15px;
    display: block;
  }
  .accordion-title-block .accordion-sub {
    font-size: 12.5px;
    color: #888;
    margin-top: 2px;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .accordion-chevron {
    flex-shrink: 0;
    color: #888;
    transition: transform 0.2s ease;
  }
  .settings-accordion[open] .accordion-chevron { transform: rotate(90deg); }

  .accordion-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .accordion-badge {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(46, 204, 113, 0.15);
    color: #2ecc71;
    border: 1px solid rgba(46, 204, 113, 0.4);
    margin-left: 8px;
    flex-shrink: 0;
  }
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="mark">
        <svg class="icon-svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/><path d="M12 6v12" stroke-dasharray="2 2"/></svg>
      </div>
      <div class="name">MP MOI</div>
    </div>

    <div class="nav-item active" data-view="overview">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2"/></svg>
      Vue d'ensemble
    </div>
    <div class="nav-item" data-view="subscription">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      Gestion & Abonnement
    </div>
    <div class="nav-item" data-view="open-tickets">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/></svg>
      Tickets ouverts
    </div>
    <div class="nav-item" data-view="livechat">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Live Console & Chat
    </div>
    <div class="nav-item" data-view="stats">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      Statistiques & Performance
    </div>
    <div class="nav-item" data-view="connection">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-2 2l-2 2m2-2l2 2m-4-2l2-2"/><circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.4 11.6L21 2"/></svg>
      Connexion bot
    </div>
    <div class="nav-item" data-view="general">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Configuration générale
    </div>
    <div class="nav-item" data-view="types">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
      Types de tickets
    </div>
    <div class="nav-item" data-view="access">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Accès admin
    </div>
    <div class="nav-item" data-view="parametres">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Paramètres
    </div>
    <div class="nav-item" data-view="changelog">
      <svg class="icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      Patch Notes
    </div>

    <div class="sidebar-footer">
      <div class="user-card" id="user-card">
        <img id="user-avatar" class="user-avatar" alt="">
        <div class="user-meta">
          <div class="user-name" id="user-name">…</div>
          <div class="user-sub">Administrateur</div>
        </div>
      </div>
      <div class="status-pill" id="status-pill">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">Chargement…</span>
      </div>
      <button class="btn-ghost" id="logout-btn" style="width:100%; margin-top:12px;">Déconnexion</button>
    </div>
  </aside>

  <main class="main">

    <section class="view active" id="view-overview">
      <div class="page-header">
        <h1>Vue d'ensemble</h1>
        <p>État de la connexion et actions rapides.</p>
      </div>

      <div class="panel">
        <h3 class="panel-title">Statut du bot</h3>
        <p class="panel-sub">Rafraîchi automatiquement toutes les 5 secondes.</p>
        <div id="overview-status" style="font-size:14px; line-height:1.9;"></div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Actions rapides</h3>
        <p class="panel-sub">Republie le panel de tickets ou force une reconnexion.</p>
        <div style="display:flex; gap:10px;">
          <button id="refresh-panel-btn" style="display:inline-flex; align-items:center; gap:8px;">
            <svg class="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Republier le panel
          </button>
          <button id="restart-bot-btn" style="display:inline-flex; align-items:center; gap:8px;">
            <svg class="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Reconnecter le bot
          </button>
        </div>
      </div>
    </section>

    <section class="view" id="view-subscription">
      <div class="page-header">
        <h1>Gestion & Abonnement</h1>
        <p>Consultez votre identifiant d'acheteur et gérez vos options d'abonnement.</p>
      </div>

      <div class="panel">
        <h3 class="panel-title">Informations de l'Acheteur</h3>
        <p class="panel-sub">Renseignez votre identifiant client/acheteur pour lier vos options souscrites.</p>
        <div class="field">
          <label for="input-customer-id">Identifiant d'acheteur (Customer ID)</label>
          <input type="text" id="input-customer-id" class="mono" placeholder="CUST-12345-XYZ">
          <p class="field-hint">Cet identifiant débloque les fonctionnalités avancées sur votre compte.</p>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Offre & Statut</h3>
        <div class="field-row" style="align-items:center; justify-content:space-between;">
          <div>
            <p style="margin:0; font-weight:bold; font-size:16px;">Statut actuel : <span id="sub-status-badge" class="sub-status-badge sub-inactive">Inactif</span></p>
          </div>
          <div class="field" style="margin:0; min-width: 200px;">
            <label for="select-plan-type">Formule souscrite</label>
            <select id="select-plan-type">
              <option value="none">Aucune offre active</option>
              <option value="standard">Standard (2,50 € / mois)</option>
            </select>
          </div>
        </div>

        <div class="field-row" style="align-items:center; margin-top:15px;">
          <input type="checkbox" id="toggle-auto-renew" style="width:auto;">
          <label for="toggle-auto-renew" style="margin:0;">Renouvellement automatique de l'abonnement</label>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Moyens de paiement</h3>
        <p class="panel-sub">Renseigne tes identifiants Revolut et/ou PayPal pour recevoir les paiements de tes clients, et active le renouvellement automatique par moyen de paiement.</p>

        <div class="payment-method-card">
          <div class="payment-method-header">
            <div class="payment-method-title">
              <span class="payment-logo revolut">R</span>
              Revolut
            </div>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:normal; cursor:pointer;">
              <input type="checkbox" id="toggle-revolut-enabled" style="width:auto;">
              Activer
            </label>
          </div>
          <div class="field">
            <label for="input-revolut-tag">Identifiant Revolut (@RevolutTag)</label>
            <input type="text" id="input-revolut-tag" class="mono" placeholder="@magikarpe">
          </div>
          <div class="field">
            <label for="input-revolut-link">Lien de paiement Revolut.me</label>
            <input type="url" id="input-revolut-link" class="mono" placeholder="https://revolut.me/magikarpe">
            <p class="field-hint">Trouvable dans l'app Revolut → Profil → "Recevoir" → Partager le lien.</p>
          </div>
          <div class="renew-checkbox-row">
            <input type="checkbox" id="toggle-revolut-renew" style="width:auto;">
            <label for="toggle-revolut-renew" style="margin:0;">Autoriser le renouvellement automatique via Revolut</label>
          </div>
        </div>

        <div class="payment-method-card">
          <div class="payment-method-header">
            <div class="payment-method-title">
              <span class="payment-logo paypal">P</span>
              PayPal
            </div>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:normal; cursor:pointer;">
              <input type="checkbox" id="toggle-paypal-enabled" style="width:auto;">
              Activer
            </label>
          </div>
          <div class="field">
            <label for="input-paypal-email">Email PayPal</label>
            <input type="email" id="input-paypal-email" class="mono" placeholder="magikarpedev@outlook.fr">
          </div>
          <div class="field">
            <label for="input-paypal-link">Lien PayPal.me</label>
            <input type="url" id="input-paypal-link" class="mono" placeholder="https://paypal.me/magikarpe">
          </div>
          <div class="renew-checkbox-row">
            <input type="checkbox" id="toggle-paypal-renew" style="width:auto;">
            <label for="toggle-paypal-renew" style="margin:0;">Autoriser le renouvellement automatique via PayPal</label>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Options Incluses</h3>
        <p class="panel-sub">Ces avantages font désormais partie de l'offre Standard.</p>
        
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
            <input type="checkbox" id="opt-priority" style="width:auto;">
            <span><b>Réponse sous 24h</b> — Assistance technique garantie en moins de 24h.</span>
          </label>
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
            <input type="checkbox" id="opt-backups" style="width:auto;">
            <span><b>Sauvegardes Automatiques MySQL</b> — Historique et sauvegardes quotidiennes.</span>
          </label>
        </div>
      </div>

      <button class="btn-primary" id="save-sub-btn" style="margin-top:15px;">Enregistrer les informations d'abonnement</button>
    </section>

    <section class="view" id="view-open-tickets">
      <div class="page-header">
        <h1>Tickets Ouverts</h1>
        <p>Consultez la liste de tous les tickets actuellement actifs.</p>
      </div>

      <div class="panel">
        <div class="toolbar-row" style="margin-bottom: 16px;">
          <h3 class="panel-title">Liste des tickets en cours</h3>
          <button class="btn-ghost" id="refresh-open-tickets-btn">Actualiser</button>
        </div>
        
        <div style="overflow-x: auto;">
          <table class="tickets-table">
            <thead>
              <tr>
                <th>ID / Salon</th>
                <th>Utilisateur</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="open-tickets-list">
              <tr>
                <td colspan="5" style="text-align: center; color: #888; padding: 20px;">
                  Chargement des tickets ouverts...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="view" id="view-livechat">
      <div class="page-header">
        <h1>Live Support Console</h1>
        <p>Réponds en direct aux tickets Discord sans quitter le dashboard.</p>
      </div>

      <div class="panel">
        <div class="field-row">
          <div class="field" style="flex:1;">
            <label for="select-active-ticket">Ticket actif</label>
            <select id="select-active-ticket">
              <option value="">-- Sélectionner un ticket ouvert --</option>
            </select>
          </div>
          <button class="btn-ghost" id="refresh-chat-btn" style="height:42px; align-self: flex-end;">Actualiser</button>
        </div>

        <div class="live-chat-box">
          <div class="chat-messages" id="chat-messages-container">
            <p style="color:#777; text-align:center; margin:auto;">Sélectionne un ticket pour voir le fil de discussion...</p>
          </div>
          <div class="chat-input-row">
            <input type="text" id="live-chat-input" placeholder="Écris ton message ici..." style="flex:1;">
            <button class="btn-primary" id="send-chat-btn">Envoyer</button>
          </div>
        </div>
      </div>
    </section>

    <section class="view" id="view-stats">
      <div class="page-header">
        <h1>Statistiques & Analytics</h1>
        <p>Vue d'ensemble de l'activité des tickets et temps de réponse.</p>
      </div>

      <div class="stat-grid" id="stat-grid"></div>

      <div class="panel">
        <h3 class="panel-title">Efficacité du Staff</h3>
        <p class="panel-sub">Temps moyen de réponse : <b id="avg-response-time" style="color:var(--primary-color, #5865F2);">2 min 14s</b></p>
      </div>

      <div class="panel">
        <div class="toolbar-row" style="margin-bottom:16px;">
          <div>
            <h3 class="panel-title">Répartition par type</h3>
            <p class="panel-sub" style="margin:0;">Nombre de tickets créés, tous statuts confondus.</p>
          </div>
          <button class="btn-ghost" id="export-csv-btn" style="display:inline-flex; align-items:center; gap:8px;">
            <svg class="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exporter en CSV
          </button>
        </div>
        <div id="stat-by-type"></div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Activité récente</h3>
        <p class="panel-sub">Les 8 derniers tickets créés ou fermés.</p>
        <div id="stat-recent"></div>
      </div>
    </section>

    <section class="view" id="view-connection">
      <div class="page-header">
        <h1>Connexion bot</h1>
        <p>Les tokens des bots Discord (Developer Portal → Bot → Reset Token).</p>
      </div>

      <div class="panel">
        <h3 class="panel-title">Bot principal (tickets & modmail)</h3>
        <div class="field">
          <label for="input-token">Token du bot principal</label>
          <input type="password" id="input-token" class="mono" placeholder="Colle ton token ici">
          <p class="field-hint">Le token affiché est masqué pour ta sécurité. Colle un nouveau token pour le remplacer.</p>
        </div>
        <button class="btn-primary" id="save-token-btn">Enregistrer et connecter</button>
      </div>
    </section>

    <section class="view" id="view-general">
      <div class="page-header">
        <h1>Configuration générale</h1>
        <p>Où le panel est envoyé, et sur quel serveur les tickets sont créés.</p>
      </div>

      <details class="settings-accordion" open>
        <summary>
          <span class="accordion-summary-left">
            <span class="accordion-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
            </span>
            <span class="accordion-title-block">
              <span class="accordion-title">Panel de tickets</span>
              <span class="accordion-sub">Serveur, salon et apparence du message avec les boutons</span>
            </span>
          </span>
          <svg class="icon-svg accordion-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </summary>
        <div class="accordion-body">
          <div class="field-row">
            <div class="field">
              <label for="select-panel-guild">Serveur</label>
              <select id="select-panel-guild"></select>
            </div>
            <div class="field">
              <label for="select-panel-channel">Salon</label>
              <select id="select-panel-channel"></select>
            </div>
          </div>
          <div class="field">
            <label for="input-panel-title">Titre du panel</label>
            <input type="text" id="input-panel-title">
          </div>
          <div class="field">
            <label for="input-panel-desc">Description du panel</label>
            <textarea id="input-panel-desc"></textarea>
          </div>
          <div class="field">
            <label for="input-panel-banner">Image bannière (URL, optionnel)</label>
            <input type="url" id="input-panel-banner" placeholder="https://...">
          </div>
          <div class="field-row">
            <div class="field">
              <label for="input-embed-color">Couleur des embeds</label>
              <input type="text" id="input-embed-color" class="mono" placeholder="5865F2" maxlength="6">
            </div>
            <div class="field">
              <label for="input-footer">Texte du pied de page</label>
              <input type="text" id="input-footer">
            </div>
          </div>
        </div>
      </details>

      <details class="settings-accordion">
        <summary>
          <span class="accordion-summary-left">
            <span class="accordion-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            <span class="accordion-title-block">
              <span class="accordion-title">Serveur staff</span>
              <span class="accordion-sub">Où les salons de tickets sont créés par défaut</span>
            </span>
          </span>
          <svg class="icon-svg accordion-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </summary>
        <div class="accordion-body">
          <div class="field-row">
            <div class="field">
              <label for="select-staff-guild">Serveur staff</label>
              <select id="select-staff-guild"></select>
            </div>
            <div class="field">
              <label for="select-staff-category">Catégorie des tickets par défaut (optionnel)</label>
              <select id="select-staff-category"></select>
            </div>
          </div>
        </div>
      </details>

      <button class="btn-primary" id="save-general-btn" style="margin-top:8px;">Enregistrer la configuration générale</button>
    </section>

    <section class="view" id="view-types">
      <div class="page-header">
        <h1>Types de tickets</h1>
        <p>Chaque type définit un bouton du panel, sa catégorie cible et les rôles staff autorisés.</p>
      </div>

      <div class="toolbar-row">
        <div></div>
        <button class="btn-primary" id="add-type-btn" style="display:inline-flex; align-items:center; gap:8px;">
          <svg class="icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nouveau type
        </button>
      </div>

      <div id="types-list"></div>
    </section>

    <section class="view" id="view-access">
      <div class="page-header">
        <h1>Accès admin</h1>
        <p>Comptes Discord autorisés à se connecter à ce dashboard.</p>
      </div>

      <div class="panel">
        <h3 class="panel-title">Ajouter un administrateur</h3>
        <p class="panel-sub">Récupère l'ID Discord de la personne (mode développeur → clic droit sur son profil → "Copier l'ID").</p>
        <div class="field-row" style="align-items:flex-end;">
          <div class="field" style="margin-bottom:0;">
            <label for="input-new-admin">ID Discord</label>
            <input type="text" id="input-new-admin" class="mono" placeholder="123456789012345678">
          </div>
          <button class="btn-primary" id="add-admin-btn" style="height:42px;">Ajouter</button>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Administrateurs actuels</h3>
        <div id="admins-list"></div>
      </div>
    </section>

    <section class="view" id="view-parametres">
      <div class="page-header">
        <h1>Paramètres</h1>
        <p>Gère ton compte (nom d'utilisateur, photo de profil) et l'apparence de ton dashboard.</p>
      </div>

      <div class="panel">
        <h3 class="panel-title">Photo de profil</h3>
        <p class="panel-sub">Formats acceptés : PNG, JPG, GIF, WEBP — 2 Mo maximum.</p>
        <div style="display:flex; align-items:center; gap:20px; margin-top:14px; flex-wrap:wrap;">
          <img id="settings-avatar-preview" class="user-avatar" style="width:84px; height:84px; border-radius:50%; object-fit:cover;" alt="Photo de profil">
          <div style="display:flex; flex-direction:column; gap:10px;">
            <input type="file" id="settings-avatar-input" accept="image/png,image/jpeg,image/gif,image/webp">
            <div style="display:flex; gap:10px;">
              <button class="btn-primary" id="settings-avatar-save" disabled>Enregistrer la photo</button>
              <button class="btn-ghost" id="settings-avatar-cancel" disabled>Annuler</button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Compte</h3>
        <div class="field">
          <label>Nom d'utilisateur</label>
          <input type="text" id="settings-username" class="mono" readonly>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Effets de Transparence (Glassmorphism)</h3>
        <div class="field">
          <label for="range-blur">Flou d'arrière-plan (Blur : <span id="blur-val">10</span>px)</label>
          <input type="range" id="range-blur" min="0" max="30" value="10">
        </div>
        <div class="field">
          <label for="range-opacity">Opacité des panneaux (<span id="opacity-val">80</span>%)</label>
          <input type="range" id="range-opacity" min="20" max="100" value="80">
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Fond d'écran</h3>
        <p class="panel-sub">Mets une image en fond, ou choisis simplement une couleur si tu ne veux pas mettre de photo.</p>
        <div class="field">
          <label for="input-wallpaper-url">URL de l'image</label>
          <input type="url" id="input-wallpaper-url" placeholder="https://exemple.com/image.png">
        </div>
        <div class="field">
          <label for="input-wallpaper-file">Ou importer une image locale</label>
          <input type="file" id="input-wallpaper-file" accept="image/*">
        </div>
        <div class="field">
          <label>Aperçu</label>
          <div id="wallpaper-preview" style="width: 100%; height: 140px; border-radius: 8px; border: 1px dashed var(--border-color, #ccc); background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; color: #888;">
            Aucun fond personnalisé
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:12px; margin: 18px 0;">
          <div style="flex:1; height:1px; background: var(--border-color, rgba(255,255,255,0.1));"></div>
          <span style="font-size:12px; color:#888; text-transform:uppercase;">Pas envie de mettre une photo ?</span>
          <div style="flex:1; height:1px; background: var(--border-color, rgba(255,255,255,0.1));"></div>
        </div>

        <div class="field">
          <label for="input-bg-color">Couleur de fond unie</label>
          <div style="display:flex; align-items:center; gap:12px;">
            <input type="color" id="input-bg-color" value="#0b0714" style="width:52px; height:42px; padding:2px; border-radius:8px; border:1px solid var(--border-color, #333); background:transparent; cursor:pointer;">
            <input type="text" id="input-bg-color-hex" class="mono" placeholder="#0b0714" style="max-width:140px;">
            <button class="btn-ghost" id="clear-bg-color-btn" type="button">Retirer la couleur</button>
          </div>
          <p class="field-hint">Choisis une couleur unie pour le fond du dashboard à la place d'une image. Elle remplace le fond d'écran tant qu'aucune image n'est définie.</p>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">Notifications Sonores</h3>
        <div class="field-row" style="align-items:center;">
          <label for="toggle-sound">Activer le son à l'arrivée d'un nouveau ticket</label>
          <input type="checkbox" id="toggle-sound" style="width:auto;">
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <button class="btn-primary" id="save-theme-btn">Appliquer les modifications</button>
        <button class="btn-ghost" id="reset-theme-btn">Réinitialiser par défaut</button>
      </div>
    </section>

    <section class="view" id="view-changelog">
      <div class="page-header">
        <h1>Patch Notes & Mises à jour</h1>
        <p>Découvre l'historique des nouvelles fonctionnalités, améliorations et correctifs.</p>
      </div>

      <div class="panel">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 class="panel-title">Version 2.7.0</h3>
          <span class="field-hint">Dernière mise à jour</span>
        </div>
        <ul class="changelog-list">
          <li><span class="changelog-tag tag-feat">Nouveau</span> Bot Status FiveM : affiche en direct le nombre de joueurs et l'état du serveur (via code CFX) dans un salon vocal et/ou un embed, avec un second bot Discord dédié.</li>
          <li><span class="changelog-tag tag-feat">Nouveau</span> "Connexion bot" gère maintenant deux tokens distincts : bot principal (tickets/modmail) et bot status (secondaire).</li>
        </ul>
      </div>

      <div class="panel">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 class="panel-title">Version 2.6.0</h3>
        </div>
        <ul class="changelog-list">
          <li><span class="changelog-tag tag-feat">Nouveau</span> Moyens de paiement Revolut & PayPal dans "Gestion & Abonnement", avec renouvellement automatique activable par moyen de paiement.</li>
          <li><span class="changelog-tag tag-fix">Fix</span> "Republier le panel" affichait un succès même quand rien n'était envoyé (bot hors ligne, salon non configuré ou permissions manquantes) — le message d'erreur réel s'affiche désormais.</li>
          <li><span class="changelog-tag tag-fix">Fix</span> L'onglet "Bannis FiveM" et la config FiveM n'étaient reliés à aucun script côté dashboard et restaient inertes — corrigé.</li>
        </ul>
      </div>

      <div class="panel">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 class="panel-title">Version 2.5.0</h3>
        </div>
        <ul class="changelog-list">
          <li><span class="changelog-tag tag-feat">Nouveau</span> Onglet "Gestion & Abonnement" pour administrer les identifiants d'acheteurs.</li>
          <li><span class="changelog-tag tag-feat">Nouveau</span> Intégration des catégories personnalisées par type de ticket.</li>
          <li><span class="changelog-tag tag-feat">Nouveau</span> Messages de bienvenue personnalisés avec variables dynamiques (ex: <code>{user}</code>).</li>
          <li><span class="changelog-tag tag-imp">Amélioration</span> Refonte graphique du Live Console & Support direct.</li>
          <li><span class="changelog-tag tag-fix">Fix</span> Correction d'un bug de chargement lors de la sélection des rôles staff.</li>
        </ul>
      </div>

      <div class="panel">
        <h3 class="panel-title">Version 2.3.0</h3>
        <ul class="changelog-list">
          <li><span class="changelog-tag tag-feat">Nouveau</span> Studio & Customisation avec mode Glassmorphism.</li>
          <li><span class="changelog-tag tag-imp">Amélioration</span> Exportation des métriques et tickets en CSV.</li>
        </ul>
      </div>
    </section>

  </main>
</div>

<div class="modal-backdrop" id="type-modal-backdrop">
  <div class="modal">
    <h2 id="type-modal-title">Nouveau type de ticket</h2>
    <input type="hidden" id="type-original-id">

    <div class="field-row">
      <div class="field" style="max-width:90px;">
        <label for="type-emoji">Icône</label>
        <input type="text" id="type-emoji" maxlength="60" placeholder="🎫 ou <:nom:1234567890>">
      </div>
      <div class="field">
        <label for="type-label">Nom</label>
        <input type="text" id="type-label" placeholder="Support">
      </div>
    </div>

    <div class="field">
      <label for="type-id">Identifiant technique</label>
      <input type="text" id="type-id" class="mono" placeholder="support">
      <p class="field-hint">Minuscules, sans espaces. Ne pas modifier après création si des tickets existent.</p>
    </div>

    <div class="field">
      <label for="type-desc">Description</label>
      <textarea id="type-desc" placeholder="Problème technique ou aide générale"></textarea>
    </div>

    <div class="field">
      <label for="type-color">Couleur (hex sans #)</label>
      <input type="text" id="type-color" class="mono" maxlength="6" placeholder="5865F2">
    </div>

    <div class="field">
      <label for="type-category">Catégorie Discord spécifique (Optionnel)</label>
      <select id="type-category">
        <option value="">Utiliser la catégorie par défaut (Globale)</option>
      </select>
      <p class="field-hint">Laisse vide pour utiliser la catégorie configurée dans "Configuration générale".</p>
    </div>
      
    <div class="field">
      <label for="type-welcome-msg">Message de bienvenue personnalisé</label>
      <textarea id="type-welcome-msg" rows="3" placeholder="Bienvenue {user} ! Un membre de l'équipe {role} va prendre en charge ton ticket."></textarea>
      <p class="field-hint">Variables disponibles : <code>{user}</code> (mentionne l'utilisateur), <code>{server}</code> (nom du serveur).</p>
    </div>

    <div class="field">
      <label>Rôles staff autorisés</label>
      <div class="roles-picker" id="type-roles-picker"></div>
      <p class="field-hint">Sélectionne le serveur staff dans "Configuration générale" pour voir les rôles disponibles.</p>
    </div>

    <div class="modal-actions">
      <button class="btn-ghost" id="type-cancel-btn">Annuler</button>
      <button class="btn-danger" id="type-delete-btn" style="display:none;">Supprimer</button>
      <button class="btn-primary" id="type-save-btn">Enregistrer</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script src="/assets/js/dashboard.js"></script>
</body>
</html>
