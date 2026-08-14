// ── cfxApi.js ──────────────────────────────────────────────
// Petit wrapper autour de l'API publique CFX pour récupérer le statut
// (joueurs en ligne, nom du serveur, etc.) à partir du code de connexion
// (ex: cfx.re/join/abcd12 → code = "abcd12").

const CFX_API_BASE = 'https://servers-frontend.fivem.net/api/servers/single';

// Accepte soit le code brut ("abcd12"), soit l'URL complète
// ("https://cfx.re/join/abcd12" ou "cfx.re/join/abcd12").
function extractCfxCode(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/cfx\.re\/join\/([A-Za-z0-9]+)/i);
  if (match) return match[1];
  // Pas d'URL détectée : on suppose que c'est déjà un code brut.
  return /^[A-Za-z0-9]{3,12}$/.test(trimmed) ? trimmed : null;
}

// Retire les codes couleur FiveM (^0 à ^9) d'un hostname.
function stripColorCodes(str) {
  return (str || '').replace(/\^[0-9]/g, '').trim();
}

async function fetchServerStatus(rawCode) {
  const code = extractCfxCode(rawCode);
  if (!code) {
    throw new Error('Code CFX invalide. Colle le code après cfx.re/join/ ou l\'URL complète.');
  }

  let res;
  try {
    res = await fetch(`${CFX_API_BASE}/${code}`, {
      headers: { 'User-Agent': 'MP-MOI-Dashboard-StatusBot' },
    });
  } catch (err) {
    throw new Error(`Impossible de joindre l'API CFX : ${err.message}`);
  }

  if (res.status === 404) {
    throw new Error('Serveur introuvable ou actuellement hors ligne.');
  }
  if (!res.ok) {
    throw new Error(`L'API CFX a répondu avec une erreur (HTTP ${res.status}).`);
  }

  const json = await res.json().catch(() => null);
  const data = json?.Data;
  if (!data) {
    throw new Error('Réponse CFX invalide — le serveur est probablement hors ligne ou le code est incorrect.');
  }

  return {
    online: true,
    code,
    hostname: stripColorCodes(data.hostname || data.vars?.sv_projectName) || 'Serveur FiveM',
    players: Array.isArray(data.players) ? data.players.length : 0,
    maxPlayers: Number(data.svMaxclients || data.vars?.sv_maxClients || 0) || 0,
    resourcesCount: Array.isArray(data.resources) ? data.resources.length : null,
  };
}

module.exports = { fetchServerStatus, extractCfxCode };
