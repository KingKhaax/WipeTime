// Servidor intermedio de WipeTime en Vercel (plan Hobby, gratis). Mismo comportamiento que server/worker.js.
// Las claves de Warcraft Logs y Blizzard viven como variables de entorno del proyecto (WCL_ID, WCL_SECRET, BNET_ID, BNET_SECRET):
// nunca viajan en la aplicación. Solo se reenvían lecturas de datos públicos; no hay ninguna operación de escritura.

const WCL = 'https://www.warcraftlogs.com';
const tokens = {}; // caché de tokens mientras la instancia siga caliente

async function token(kind) {
  const t = tokens[kind];
  if (t && Date.now() < t.exp - 60000) return t.value;
  const [url, id, secret] = kind === 'wcl'
    ? [`${WCL}/oauth/token`, process.env.WCL_ID, process.env.WCL_SECRET]
    : ['https://oauth.battle.net/token', process.env.BNET_ID, process.env.BNET_SECRET];
  if (!id || !secret) throw new Error('missing secrets');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('auth ' + res.status);
  const j = await res.json();
  tokens[kind] = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

// Límite sencillo por IP y por instancia
const hits = new Map();
function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((x) => now - x < 60000);
  h.push(now);
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 120;
}

const send = (res, status, obj) => { res.status(status).setHeader('content-type', 'application/json'); res.send(JSON.stringify(obj)); };
const BNET_PATH = /^\/(profile\/wow\/character\/[a-z0-9-]+\/[^/?#]+(\/(character-media|appearance|equipment|statistics))?|data\/wow\/(guild\/[a-z0-9-]+\/[^/?#]+(\/roster)?|guild-crest\/[^?#]+|media\/guild-crest\/[^?#]+|media\/item\/\d+|realm\/[^?#]+|connected-realm\/[^?#]+))(\?.*)?$/i;

module.exports = { WCL, token, limited, send, BNET_PATH };
