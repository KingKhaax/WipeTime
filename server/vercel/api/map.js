const { limited, send, cors } = require('./_lib');

// GET /map?p=<ruta>  ->  imagen de mapa de jefe de RaidPlan.io (su CDN no permite CORS, y el replay necesita leer los píxeles)
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (limited(req)) return send(res, 429, { error: 'rate limit' });
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  try {
    const p = String((req.query || {}).p || '');
    if (!/^[A-Za-z0-9_\-./]{1,200}\.(jpg|jpeg|png|webp)$/i.test(p) || p.includes('..')) return send(res, 403, { error: 'path not allowed' });
    const r = await fetch('https://cdn.raidplan.io/' + p, { headers: { 'user-agent': 'Mozilla/5.0 WipeTime' } });
    if (!r.ok) return send(res, r.status === 404 ? 404 : 502, { error: 'upstream ' + r.status });
    res.status(200).setHeader('content-type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};
