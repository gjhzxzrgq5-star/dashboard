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

  // IMPORTANT : Cloudflare peut répondre 403 *ou* 404 pour bloquer une requête
  // qui ressemble à un bot — sans que ça veuille dire que le serveur FiveM est
  // introuvable. On ne se fie donc pas au seul code HTTP : on regarde d'abord
  // si le corps de la réponse est bien du JSON provenant de l'API CFX, ce qui
  // permet de distinguer un vrai "serveur hors ligne" d'un blocage Cloudflare.
  const contentType = res.headers.get('content-type') || '';
  const rawBody = await res.text();

  let json = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
  } else if (rawBody.trim().startsWith('{')) {
    // Certains proxys renvoient du JSON sans le bon content-type.
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
  }

  if (!json) {
    // Pas de JSON exploitable : c'est presque toujours une page de blocage
    // Cloudflare (HTML), quel que soit le code HTTP renvoyé (403, 404, 503…).
    throw new Error(
      `Cfx.re a bloqué ou refusé la requête (HTTP ${res.status}) au lieu de renvoyer les infos du serveur. ` +
        "Ce n'est pas lié à ton code CFX (le serveur peut très bien être en ligne) — c'est une protection anti-bot côté cfx.re qui filtre parfois les requêtes faites depuis un serveur. Réessaie dans quelques minutes."
    );
  }

  const data = json.Data;
  if (!data) {
    // Ici on a bien reçu du JSON de l'API CFX, donc la réponse est fiable :
    // le code ne correspond à aucun serveur actuellement listé/en ligne.
    const errCode = json.error || json.status;
    throw new Error(
      errCode === 'input_not_found'
        ? 'Aucun serveur trouvé avec ce code CFX. Vérifie que le code est bien à jour (il peut changer à chaque redémarrage du serveur).'
        : 'Serveur introuvable ou actuellement hors ligne.'
    );
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
