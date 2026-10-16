'use strict';

// Tarjetas de personaje (retrato, nivel, nombre, guild, reino, raza y clase, como la cabecera de Warcraft Logs)
// y logos de guild (escudo con sus colores). Los datos vienen de la API pública de Blizzard.
const Cards = (() => {
  const CLASS_KEY = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'DeathKnight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'DemonHunter', 13: 'Evoker' };
  // Especialización de Blizzard (id) -> icono incluido en src/specs
  const SPEC_KEY = { 250: 'deathknight-blood', 251: 'deathknight-frost', 252: 'deathknight-unholy', 577: 'demonhunter-havoc', 581: 'demonhunter-vengeance', 1480: 'demonhunter-devourer',
    102: 'druid-balance', 103: 'druid-feral', 104: 'druid-guardian', 105: 'druid-restoration', 1467: 'evoker-devastation', 1468: 'evoker-preservation', 1473: 'evoker-augmentation',
    253: 'hunter-beastmastery', 254: 'hunter-marksmanship', 255: 'hunter-survival', 62: 'mage-arcane', 63: 'mage-fire', 64: 'mage-frost',
    268: 'monk-brewmaster', 269: 'monk-windwalker', 270: 'monk-mistweaver', 65: 'paladin-holy', 66: 'paladin-protection', 70: 'paladin-retribution',
    256: 'priest-discipline', 257: 'priest-holy', 258: 'priest-shadow', 259: 'rogue-assassination', 260: 'rogue-outlaw', 261: 'rogue-subtlety',
    262: 'shaman-elemental', 263: 'shaman-enhancement', 264: 'shaman-restoration', 265: 'warlock-affliction', 266: 'warlock-demonology', 267: 'warlock-destruction',
    71: 'warrior-arms', 72: 'warrior-fury', 73: 'warrior-protection' };
  const FACTION = { HORDE: '#ff4a4a', ALLIANCE: '#4a8dff' };
  const media = (u) => `wcmedia://m/${encodeURIComponent(u)}`;
  const charCache = new Map();
  const crestCache = new Map();

  const slugOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/\s+/g, '-');

  function char(name, realmSlug, region) {
    const key = `${S.lang}:${region || ''}:${realmSlug}:${String(name).toLowerCase()}`;
    if (!charCache.has(key)) {
      charCache.set(key, window.api.bnetChar(realmSlug, name, S.lang, region).then((r) => { if (r.error) throw new Error(r.error); return r; }).catch((e) => { charCache.delete(key); throw e; }));
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
  // Tarjeta compacta: nombre / guild · reino (región) / icono de spec + raza · clase (cada una en una sola línea)
  function charCardHTML(c, { onClick = '' } = {}) {
    const cls = CLASS_KEY[c.classId] || '';
    const color = classColor(cls);
    const sk = SPEC_KEY[c.specId];
    const specImg = sk ? `<img class="cc-spec" src="${specIconUrl(sk)}" width="20" height="20" alt="" style="--cc:${color}">` : '';
    const kind = [c.race, c.cls].filter(Boolean).join(' · ');
    const realm = `${c.realmName || c.realmSlug} (${String(c.region || '').toUpperCase()})`;
    return `<div class="cc ${onClick ? 'click' : ''}" style="--cc:${color}" ${onClick}>${portraitHTML(c, 64)}
      <div class="cc-txt"><div class="cc-name" title="${esc(c.name)}">${esc(c.name)}</div>
        <div class="cc-guild" title="${esc((c.guild ? c.guild.name + ' · ' : '') + realm)}">${c.guild ? `<span style="color:${FACTION[c.guild.faction] || FACTION[c.faction] || 'var(--muted)'}">${esc(c.guild.name)}</span> · ` : ''}<span class="muted">${esc(realm)}</span></div>
        <div class="cc-class" style="color:${color}" title="${esc(kind)}">${specImg}<span>${esc(kind)}</span></div></div></div>`;
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

  // Efecto de profundidad: el modelo se inclina hacia donde está el ratón
  document.addEventListener('mousemove', (ev) => {
    const box = ev.target.closest?.('[data-tilt]');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width - 0.5;
    const y = (ev.clientY - r.top) / r.height - 0.5;
    box.style.setProperty('--ry', `${(x * 22).toFixed(1)}deg`);
    box.style.setProperty('--rx', `${(-y * 8).toFixed(1)}deg`);
  });
  document.addEventListener('mouseout', (ev) => {
    const box = ev.target.closest?.('[data-tilt]');
    if (box && !box.contains(ev.relatedTarget)) { box.style.setProperty('--ry', '0deg'); box.style.setProperty('--rx', '0deg'); }
  });

  // El render de Blizzard es un lienzo 4:3 casi vacío con el personaje pequeño en medio: se recorta a la silueta
  // (cuadro de píxeles no transparentes) para que el modelo llene su marco, sea cual sea la raza.
  document.addEventListener('load', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.matches?.('.arm-model img, .pf-model img') || img.dataset.fit) return;
    img.dataset.fit = '1';
    try {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const sc = Math.min(1, 400 / nw);
      const w = Math.max(1, Math.round(nw * sc)), h = Math.max(1, Math.round(nh * sc));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const px = cx.getImageData(0, 0, w, h).data;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0 || y1 <= y0) return;
      const padX = (x1 - x0) * 0.08, padT = (y1 - y0) * 0.06, padB = (y1 - y0) * 0.03;
      const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const rx0 = cl(x0 - padX, 0, w), rx1 = cl(x1 + padX, 0, w), ry0 = cl(y0 - padT, 0, h), ry1 = cl(y1 + padB, 0, h);
      const cw = rx1 - rx0, ch = ry1 - ry0;
      const box = img.parentElement;
      const crop = document.createElement('div');
      crop.className = 'mdl-crop';
      crop.style.aspectRatio = `${cw} / ${ch}`;
      box.insertBefore(crop, img);
      crop.appendChild(img);
      img.style.cssText = `position:absolute;max-width:none;max-height:none;width:${(w / cw) * 100}%;left:${-(rx0 / cw) * 100}%;top:${-(ry0 / ch) * 100}%`;
    } catch { /* imagen sin acceso a sus píxeles: se deja como estaba */ }
  }, true);

  return { char, crest, charCardHTML, SPEC_KEY, crestHTML, portraitHTML, fillCrests, fillMe, slugOf, media, CLASS_KEY };
})();
