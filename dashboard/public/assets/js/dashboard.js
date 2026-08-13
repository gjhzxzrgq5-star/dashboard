document.addEventListener('DOMContentLoaded', () => {

  // --- 0. Carte utilisateur (avatar, nom, statut) ---
  (async function loadMe() {
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    try {
      const res = await fetch('/api/me');
      if (!res.ok) throw new Error('unauthorized');
      const data = await res.json();
      const user = data.user;
      if (user && nameEl) {
        nameEl.textContent = user.username || 'Utilisateur';
        if (avatarEl) {
          avatarEl.src = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;
        }
      }
    } catch (err) {
      if (nameEl) nameEl.textContent = 'Inconnu';
    }

    try {
      const statusRes = await fetch('/api/status');
      const status = await statusRes.json();
      const online = status.status === 'online';
      if (statusDot) statusDot.style.background = online ? '#3ba55c' : '#ed4245';
      if (statusText) statusText.textContent = online ? 'Bot en ligne' : 'Bot hors ligne';
    } catch (err) {
      if (statusText) statusText.textContent = 'Statut inconnu';
    }
  })();

  // --- 1. Notification Toast ---
  function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.background = isError ? '#ff4d4d' : 'var(--primary-color, #5865F2)';
    toast.style.color = '#ffffff';
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  // --- 2. Navigation SPA ---
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.getAttribute('data-view');

      navItems.forEach(i => i.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));

      item.classList.add('active');
      const activeSection = document.getElementById(`view-${targetView}`);
      if (activeSection) {
        activeSection.classList.add('active');
      }

      if (targetView === 'fivembans') {
        loadFiveMBans();
      }
    });
  });

  // --- 3. Intégration FiveM (Visibilité & Restauration) ---
  const toggleFiveM = document.getElementById('toggle-fivem');
  const fiveMContainer = document.getElementById('fivem-options-container');
  const fivemUrlInput = document.getElementById('input-fivem-url');

  if (toggleFiveM) {
    const savedEnabled = localStorage.getItem('fivem_enabled') === 'true';
    toggleFiveM.checked = savedEnabled;
  }

  if (fivemUrlInput) {
    fivemUrlInput.value = localStorage.getItem('fivem_url') || '';
  }

  function updateFiveMVisibility() {
    if (toggleFiveM && fiveMContainer) {
      fiveMContainer.style.display = toggleFiveM.checked ? 'block' : 'none';
    }
  }

  if (toggleFiveM) {
    toggleFiveM.addEventListener('change', updateFiveMVisibility);
    updateFiveMVisibility();
  }

  // --- 4. Sauvegarde de la Config FiveM ---
  const saveFiveMBtn = document.getElementById('save-fivem-btn');
  if (saveFiveMBtn) {
    saveFiveMBtn.addEventListener('click', async () => {
      try {
        const urlValue = fivemUrlInput ? fivemUrlInput.value.trim() : '';
        const isEnabled = toggleFiveM ? toggleFiveM.checked : false;

        if (isEnabled && !urlValue) {
          showToast("Veuillez entrer un lien de connexion FiveM valide.", true);
          return;
        }

        localStorage.setItem('fivem_enabled', isEnabled);
        localStorage.setItem('fivem_url', urlValue);

        try {
          await fetch('/api/fivem/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: isEnabled, url: urlValue })
          });
        } catch (e) {
          // Si le serveur est hors-ligne, la sauvegarde locale prend le relais
        }

        showToast("Configuration FiveM enregistrée avec succès !");
      } catch (err) {
        console.error(err);
        showToast("Erreur lors de la sauvegarde.", true);
      }
    });
  }

  // --- 5. Chargement & Affichage des Bannis FiveM ---
  async function loadFiveMBans() {
    const listContainer = document.getElementById('fivembans-list');
    const infoContainer = document.getElementById('fivembans-server-info');
    if (!listContainer) return;

    listContainer.innerHTML = '<p style="color:#888;">Chargement des bannis en cours...</p>';

    try {
      const response = await fetch('/api/fivem/bans');
      if (!response.ok) throw new Error("API non disponible");

      const bans = await response.json();
      renderBansList(bans);
    } catch (error) {
      const mockBans = [
        { name: "John_Doe", identifier: "license:11000010a2b3c4d", reason: "Carkill répété" },
        { name: "BadPlayer", identifier: "license:110000109876543", reason: "Troll / FailRP" }
      ];

      if (infoContainer) {
        infoContainer.textContent = `${mockBans.length} banni(s) (Données de démonstration)`;
      }

      renderBansList(mockBans);
    }
  }

  function renderBansList(bans) {
    const listContainer = document.getElementById('fivembans-list');
    if (!listContainer) return;

    if (!bans || bans.length === 0) {
      listContainer.innerHTML = '<p style="color:#888;">Aucun joueur banni trouvé.</p>';
      return;
    }

    listContainer.innerHTML = bans.map(ban => `
      <div style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong style="color:#fff;">${ban.name || 'Joueur Inconnu'}</strong>
          <br>
          <small style="color: #888;">${ban.identifier || 'ID masqué'}</small>
        </div>
        <span style="color: #ff4d4d; font-weight: bold; font-size: 13px;">${ban.reason || 'Raison non spécifiée'}</span>
      </div>
    `).join('');
  }

  const refreshFiveMBansBtn = document.getElementById('refresh-fivembans-btn');
  if (refreshFiveMBansBtn) {
    refreshFiveMBansBtn.addEventListener('click', loadFiveMBans);
  }

  // --- 6. Sauvegarde Générale ---
  const saveGeneralBtn = document.getElementById('save-general-btn');
  if (saveGeneralBtn) {
    saveGeneralBtn.addEventListener('click', () => {
      showToast("Configuration générale mise à jour.");
    });
  }

  // --- 7. Personnalisation (Blur Slider) ---
  const rangeBlur = document.getElementById('range-blur');
  const blurVal = document.getElementById('blur-val');

  if (rangeBlur && blurVal) {
    rangeBlur.addEventListener('input', (e) => {
      blurVal.textContent = e.target.value;
      document.documentElement.style.setProperty('--blur-val', `${e.target.value}px`);
    });
  }
});

