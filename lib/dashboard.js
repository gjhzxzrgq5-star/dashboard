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
    });
  });

  // 2. Gestionnaire d'affichage dynamiques des options FiveM
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

  // 3. Gestionnaire des boutons de Sauvegarde
  const saveFiveMBtn = document.getElementById('save-fivem-btn');
  if (saveFiveMBtn) {
    saveFiveMBtn.addEventListener('click', () => {
      const fivemUrlInput = document.getElementById('input-fivem-url');
      const fivemUrl = fivemUrlInput ? fivemUrlInput.value.trim() : '';

      if (toggleFiveM && toggleFiveM.checked && !fivemUrl) {
        showToast("Veuillez entrer un lien de connexion FiveM valide.");
        return;
      }

      // Traitement du lien de connexion
      showToast("Lien de connexion FiveM enregistré avec succès !");
    });
  }

  const saveGeneralBtn = document.getElementById('save-general-btn');
  if (saveGeneralBtn) {
    saveGeneralBtn.addEventListener('click', () => {
      showToast("Configuration générale mise à jour.");
    });
  }

  // 4. Fonction Utilitaire : Notification Toast
  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  // 5. Thème & Studio Sliders (Aperçu temps réel)
  const rangeBlur = document.getElementById('range-blur');
  const blurVal = document.getElementById('blur-val');

  if (rangeBlur && blurVal) {
    rangeBlur.addEventListener('input', (e) => {
      blurVal.textContent = e.target.value;
      document.documentElement.style.setProperty('--blur-val', `${e.target.value}px`);
    });
  }
});
