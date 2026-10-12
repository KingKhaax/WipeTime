'use strict';

// Service worker de la versión web: sirve los iconos "ic/<nombre>" (los que la app de escritorio pide con wcicon://)
// redirigiéndolos al CDN de Warcraft Logs. Todo lo demás pasa tal cual.
const SPEC_KEYS = '__SPEC_KEYS__'.split(',');

function iconCdn(name) {
  name = name.toLowerCase();
  if (name.startsWith('class-')) return `https://assets.rpglogs.com/img/warcraft/icons/${name.slice(6).replace(/[^a-z]/g, '')}.jpg`;
  if (name.startsWith('spec-')) return `https://assets.rpglogs.com/img/warcraft/icons/${SPEC_KEYS.find((k) => k.toLowerCase() === name.slice(5)) || name.slice(5)}.jpg`;
  // Wowhead no pasa por Cloudflare, que en España se bloquea a ratos (fútbol) y rompía los iconos de Warcraft Logs
  return `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const m = url.pathname.match(/\/ic\/([^/]+)$/);
  if (!m) return;
  try {
    const name = decodeURIComponent(m[1]).replace(/\.(jpg|png|tga|blp)$/i, '');
    if (!/^[a-z0-9_\-+. ']{1,120}$/i.test(name)) return;
    e.respondWith(Response.redirect(iconCdn(name), 302));
  } catch { /* nombre no válido: sigue su camino */ }
});
