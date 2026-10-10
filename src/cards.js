'use strict';

// Tarjetas de personaje (retrato, nivel, nombre, guild, reino, raza y clase, como la cabecera de Warcraft Logs)
// y logos de guild (escudo con sus colores). Los datos vienen de la API pública de Blizzard.
const Cards = (() => {
  const CLASS_KEY = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'DeathKnight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'DemonHunter', 13: 'Evoker' };
  const FACTION = { HORDE: '#ff4a4a', ALLIANCE: '#4a8dff' };
  const media = (u) => `wcmedia://m/${encodeURIComponent(u)}`;
  const charCache = new Map();
  const crestCache = new Map();

  const slugOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/\s+/g, '-');

  function char(name, realmSlug) {
    const key = `${S.lang}:${realmSlug}:${String(name).toLowerCase()}`;
    if (!charCache.has(key)) {
      charCache.set(key, window.api.bnetChar(realmSlug, name, S.lang).then((r) => { if (r.error) throw new Error(r.error); return r; }).catch((e) => { charCache.delete(key); throw e; }));
    }
    return charCache.get(key);
  }

  function crest(realmSlug, guildName) {
    const key = `${realmSlug}:${String(guildName).toLowerCase()}`;
    if (!crestCache.has(key)) {
      crestCache.set(key, window.api.bnetCrest(realmSlug, guildName).then((r) => { if (r.error) throw new Error(r.error); return r; }).catch((e) => { crestCache.delete(key); throw e; }));
    }
    return crestCache.get(key);
  }

  // Retrato del personaje con la insignia del nivel
  const portraitHTML = (c, size = 72) => `<span class="cc-pic" style="--sz:${size}px">${c.avatar ? `<img src="${media(c.avatar)}" alt="">` : ''}<b class="cc-lvl">${esc(c.level ?? '')}</b></span>`;

  // Tarjeta como la de Warcraft Logs: Nombre / Guild - Reino (Región) / Raza Clase
  function charCardHTML(c, { onClick = '' } = {}) {
    const cls = CLASS_KEY[c.classId] || '';
    const color = classColor(cls);
    return `<div class="cc ${onClick ? 'click' : ''}" ${onClick}>${portraitHTML(c)}
      <div class="cc-txt"><div class="cc-name">${esc(c.name)}</div>
        <div class="cc-guild">${c.guild ? `<span style="color:${FACTION[c.guild.faction] || FACTION[c.faction] || 'var(--muted)'}">${esc(c.guild.name)}</span> - ` : ''}<span class="muted">${esc(c.realmName || c.realmSlug)} (${esc(String(c.region || '').toUpperCase())})</span></div>
        <div class="cc-class" style="color:${color}">${esc([c.race, c.cls].filter(Boolean).join(' '))}</div></div></div>`;
  }

  // Escudo de guild: fondo, borde y emblema teñidos con los colores del escudo
  function crestHTML(c, size = 56) {
    const mask = (u) => `-webkit-mask-image:url(${media(u)});mask-image:url(${media(u)})`;
    return `<span class="crest" style="--sz:${size}px;--cbg:${c.bg}"><i class="cr-b" style="background:${c.border.color};${mask(c.border.url)}"></i><i class="cr-e" style="background:${c.emblem.color};${mask(c.emblem.url)}"></i></span>`;
  }

  // Rellena todos los huecos [data-crest] (data-realm, data-guild, data-size) de un contenedor
  async function fillCrests(root = document) {
    for (const el of root.querySelectorAll('[data-crest]:not([data-done])')) {
      el.dataset.done = '1';
      crest(el.dataset.realm, el.dataset.guild).then((c) => { el.innerHTML = crestHTML(c, Number(el.dataset.size) || 40); }).catch(() => { el.remove(); });
    }
  }

  // Foto pequeña de tu personaje en la barra lateral del reporte
  async function fillMe() {
    const el = document.getElementById('meAv');
    if (!el || !S.me) return;
    const actor = [...S.actors.values()].find((a) => a.type === 'Player' && a.name === S.me);
    if (!actor || !actor.server) return;
    try {
      const c = await char(S.me, slugOf(actor.server));
      if (document.getElementById('meAv') !== el) return;
      el.innerHTML = c.avatar ? `<img src="${media(c.avatar)}" alt="" title="${esc(c.name)}">` : '';
    } catch { /* sin foto: el personaje no tiene perfil público */ }
  }

  return { char, crest, charCardHTML, crestHTML, portraitHTML, fillCrests, fillMe, slugOf, media, CLASS_KEY };
})();
