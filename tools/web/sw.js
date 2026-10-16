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

// Caché de la web: lo estático (scripts, estilos, imágenes, fuentes) se sirve al instante desde el equipo y se actualiza por detrás;
// la página principal se pide primero a la red (así una versión nueva se ve enseguida) y solo si falla se usa la copia guardada.
// El nombre de la caché lleva la versión: al publicar una nueva se borra la anterior.
const CACHE = 'wt-__VERSION__';
const cacheable = (res) => res && res.ok && res.type === 'basic';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('wt-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const m = url.pathname.match(/\/ic\/([^/]+)$/);
  if (!m) {
    if (req.method !== 'GET' || req.headers.has('range') || /\/sw\.js$/.test(url.pathname)) return;
    const isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      if (isPage) {
        try {
          const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 5000))]);
          if (cacheable(res)) cache.put(req, res.clone());
          return res;
        } catch { return (await cache.match(req)) || (await cache.match(url.pathname)) || fetch(req); }
      }
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    })());
    return;
  }
  try {
    const name = decodeURIComponent(m[1]).replace(/\.(jpg|png|tga|blp)$/i, '');
    if (!/^[a-z0-9_\-+. ']{1,120}$/i.test(name)) return;
    e.respondWith(Response.redirect(iconCdn(name), 302));
  } catch { /* nombre no válido: sigue su camino */ }
});
