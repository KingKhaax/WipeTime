const { send, cors } = require('./_lib');

module.exports = (req, res) => cors(req, res) || send(res, 200, { ok: true, service: 'wipetime-proxy' });
