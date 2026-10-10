const { send } = require('./_lib');

module.exports = (req, res) => send(res, 200, { ok: true, service: 'wipetime-proxy' });
