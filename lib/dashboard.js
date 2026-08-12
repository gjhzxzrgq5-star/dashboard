document.addEventListener('DOMContentLoaded', () => {

  // 1. Navigation SPA (Single Page Application)
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

      // Si l'utilisateur clique sur la vue des bannis FiveM, on charge automatiquement la liste
      if (targetView === 'fivembans') {
        loadFiveMBans();
      }
    });
  });

  // 2. Gestionnaire d'affichage dynamique des options FiveM
  const toggleFiveM = document.getElementById('toggle-fivem');
  const fiveMContainer = document.getElementById('fivem-options-container');

  function updateFiveMVisibility() {
    if (toggleFiveM && fiveMContainer) {
      fiveMContainer.style.display = toggleFiveM.checked ? 'block' : 'none';
    }
  }

  if (toggleFiveM) {
    toggleFiveM.addEventListener('change', updateFiveMVisibility);
    updateFiveMVisibility(); // État initial au chargement
  }

  // 3. Sauvegarde de la configuration FiveM
  const saveFiveMBtn = document.getElementById('save-fivem-btn');
  if (saveFiveMBtn) {
    saveFiveMBtn.addEventListener('click', async () => {
      const fivemUrlInput = document.getElementById('input-fivem-url');
      const fivemUrl = fivemUrlInput ? fivemUrlInput.value.trim() : '';

      if (toggleFiveM && toggleFiveM.checked && !fivemUrl) {
        showToast("Veuillez entrer un lien de connexion FiveM valide.");
        return;
      }

      try {
        // Optionnel : Envoyez ici la configuration à votre serveur/API via fetch
        /*
        await fetch('/api/fivem/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: toggleFiveM ? toggleFiveM.checked : false, url: fivemUrl })
        });
        */

        showToast("Configuration FiveM enregistrée avec succès !");
      } catch (error) {
        console.error("Erreur de sauvegarde FiveM :", error);
        showToast("Erreur lors de l'enregistrement de la configuration.");
      }
    });
  }

  // 4. Gestion de la liste des bannis FiveM
  async function loadFiveMBans() {
    const listContainer = document.getElementById('fivembans-list');
    const infoContainer = document.getElementById('fivembans-server-info');
    if (!listContainer) return;

    listContainer.innerHTML = '<p style="color:#888;">Chargement des bannis en cours...</p>';

    try {
      // Remplacez '/api/fivem/bans' par l'URL de votre propre API ou endpoint
      const response = await fetch('/api/fivem/bans');
      
      if (!response.ok) {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      const bans = await response.json();

      if (infoContainer) {
        infoContainer.textContent = `${bans.length} banni(s) trouvé(s).`;
      }

      if (!bans || bans.length === 0) {
        listContainer.innerHTML = '<p style="color:#888;">Aucun joueur banni pour le moment.</p>';
        return;
      }

      // Construction du tableau/liste de bannis
      listContainer.innerHTML = bans.map(ban => `
        <div style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${ban.name || 'Joueur Inconnu'}</strong>
            <br>
            <small style="color: #888;">ID: ${ban.identifier || 'Non disponible'}</small>
          </div>
          <span style="color: #ff4d4d; font-weight: bold;">${ban.reason || 'Aucune raison spécifiée'}</span>
        </div>
      `).join('');

    } catch (error) {
      console.error("Impossible de charger les bannis FiveM :", error);
      listContainer.innerHTML = '<p style="color:#ff4d4d;">Erreur lors de la récupération des bannis. Vérifiez votre API ou le lien du serveur.</p>';
    }
  }

  const refreshFiveMBansBtn = document.getElementById('refresh-fivembans-btn');
  if (refreshFiveMBansBtn) {
    refreshFiveMBansBtn.addEventListener('click', loadFiveMBans);
  }

  // 5. Sauvegarde générale
  const saveGeneralBtn = document.getElementById('save-general-btn');
  if (saveGeneralBtn) {
    saveGeneralBtn.addEventListener('click', () => {
      showToast("Configuration générale mise à jour.");
    });
  }

  // 6. Fonction Utilitaire : Notification Toast
  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  // 7. Thème & Studio Sliders (Aperçu en temps réel)
  const rangeBlur = document.getElementById('range-blur');
  const blurVal = document.getElementById('blur-val');

  if (rangeBlur && blurVal) {
    rangeBlur.addEventListener('input', (e) => {
      blurVal.textContent = e.target.value;
      document.documentElement.style.setProperty('--blur-val', `${e.target.value}px`);
    });
  }
});
