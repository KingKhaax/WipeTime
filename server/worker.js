// Servidor intermedio de WipeTime (Cloudflare Workers, plan gratuito).
// Guarda las claves de Warcraft Logs y Blizzard como secretos del Worker: nunca viajan en la aplicación,
// así que quien instale WipeTime no puede extraerlas. La app solo conoce la dirección de este Worker.
//
// Secretos (wrangler secret put ...): WCL_ID, WCL_SECRET, BNET_ID, BNET_SECRET
// Solo se reenvían consultas de LECTURA de datos públicos; no hay ninguna operación de escritura.

const WCL = 'https://www.warcraftlogs.com';
const tokens = {}; // caché de tokens por isolate

async function token(kind, env) {
  const t = tokens[kind];
  if (t && Date.now() < t.exp - 60000) return t.value;
  const [url, id, secret] = kind === 'wcl'
    ? [`${WCL}/oauth/token`, env.WCL_ID, env.WCL_SECRET]
    : ['https://oauth.battle.net/token', env.BNET_ID, env.BNET_SECRET];
  if (!id || !secret) throw new Error('missing secrets');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${id}:${secret}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('auth ' + res.status);
  const j = await res.json();
  tokens[kind] = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

// Límite sencillo por IP (por instancia del Worker); para algo más estricto añade una regla de Rate Limiting en el panel de Cloudflare
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((x) => now - x < 60000);
  h.push(now);
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 120;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const BNET_PATH = /^\/(profile\/wow\/character\/[a-z0-9-]+\/[^/?#]+(\/(character-media|appearance|equipment|statistics|encounters\/raids))?|data\/wow\/(guild\/[a-z0-9-]+\/[^/?#]+(\/roster)?|guild-crest\/[^?#]+|media\/guild-crest\/[^?#]+|media\/item\/\d+|realm\/[^?#]+|connected-realm\/[^?#]+))(\?.*)?$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'x';
    if (limited(ip)) return json({ error: 'rate limit' }, 429);
    try {
      if (url.pathname === '/wcl' && request.method === 'POST') {
        const raw = await request.text();
        if (raw.length > 100000) return json({ error: 'too large' }, 413);
        const { query, variables, lang } = JSON.parse(raw);
        if (typeof query !== 'string' || /\bmutation\b/i.test(query)) return json({ error: 'bad query' }, 400);
        const bearer = await token('wcl', env);
        const host = ['es', 'de', 'fr'].includes(lang) ? `https://${lang}.warcraftlogs.com` : WCL;
        const res = await fetch(`${host}/api/v2/client`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
        return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/bnet' && request.method === 'GET') {
        const region = ['eu', 'us', 'kr', 'tw'].includes(url.searchParams.get('region')) ? url.searchParams.get('region') : 'eu';
        const path = url.searchParams.get('path') || '';
        if (!BNET_PATH.test(path)) return json({ error: 'path not allowed' }, 403);
        const bearer = await token('bnet', env);
        const res = await fetch(`https://${region}.api.blizzard.com${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
        return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/') return json({ ok: true, service: 'wipetime-proxy' });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
