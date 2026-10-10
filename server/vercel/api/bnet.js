const { token, limited, send, BNET_PATH } = require('./_lib');

// GET /bnet?region=eu&path=/profile/wow/character/...  ->  API pública de Blizzard (solo unas pocas rutas permitidas)
module.exports = async (req, res) => {
  if (limited(req)) return send(res, 429, { error: 'rate limit' });
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  try {
    const q = req.query || {};
    const region = ['eu', 'us', 'kr', 'tw'].includes(q.region) ? q.region : 'eu';
    const path = String(q.path || '');
    if (!BNET_PATH.test(path)) return send(res, 403, { error: 'path not allowed' });
    const bearer = await token('bnet');
    const r = await fetch(`https://${region}.api.blizzard.com${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
    res.status(r.status).setHeader('content-type', 'application/json');
    res.send(await r.text());
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};
