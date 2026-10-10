const { WCL, token, limited, send } = require('./_lib');

// POST /wcl  { query, variables, lang }  ->  API v2 de Warcraft Logs (solo consultas, nada de mutation)
module.exports = async (req, res) => {
  if (limited(req)) return send(res, 429, { error: 'rate limit' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { query, variables, lang } = body;
    if (typeof query !== 'string' || query.length > 100000 || /\bmutation\b/i.test(query)) return send(res, 400, { error: 'bad query' });
    const bearer = await token('wcl');
    const host = ['es', 'de', 'fr'].includes(lang) ? `https://${lang}.warcraftlogs.com` : WCL;
    const r = await fetch(`${host}/api/v2/client`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    res.status(r.status).setHeader('content-type', 'application/json');
    res.send(await r.text());
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
};
