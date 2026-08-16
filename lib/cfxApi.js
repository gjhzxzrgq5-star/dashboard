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

  // Depuis mi-2025, cfx.re protège cet endpoint avec Cloudflare et bloque
  // (403) les requêtes qui ressemblent à un script/bot (mauvais User-Agent,
  // pas d'en-têtes de navigateur). On imite donc un vrai navigateur qui
  // charge la page servers.fivem.net, ce qui passe le filtre dans la
  // grande majorité des cas.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(`${CFX_API_BASE}/${code}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        Referer: 'https://servers.fivem.net/',
        Origin: 'https://servers.fivem.net',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error("L'API CFX n'a pas répondu à temps (timeout). Réessaie dans quelques instants.");
    }
    throw new Error(`Impossible de joindre l'API CFX : ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 403) {
    throw new Error(
      "Cfx.re a bloqué la requête (HTTP 403). Ce n'est pas lié à ton code : l'API publique de FiveM limite parfois les accès automatisés. Réessaie dans quelques minutes ; si ça persiste, vérifie que le serveur est bien en ligne en ouvrant cfx.re/join/" +
        code +
        ' dans un navigateur.'
    );
  }
  if (res.status === 404) {
    throw new Error('Serveur introuvable ou actuellement hors ligne.');
  }
  if (!res.ok) {
    throw new Error(`L'API CFX a répondu avec une erreur (HTTP ${res.status}).`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Cloudflare renvoie parfois une page HTML de challenge à la place du JSON.
    throw new Error(
      "Réponse inattendue de l'API CFX (pas du JSON) — le serveur est probablement hors ligne, le code est incorrect, ou cfx.re bloque temporairement la requête."
    );
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
