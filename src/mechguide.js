'use strict';

// Guía de mecánicas por jefe y dificultad (datos propios en tools/mechanics_es.json).
// - Anillo de color alrededor de los iconos de habilidad: cortable (azul), one-shot (rojo), tanque (marrón), dispel (morado).
// - Calavera: ninguna en normal; gris en lo que añade heroico; roja en lo que añade mítico.
const MechGuide = (() => {
  const RING_TYPES = new Set(['cortable', 'oneshot', 'tanque', 'dispel']);
  const EN_NAMES = {
    nekzali: "nek'zali the soulcoiler", 'entombed-sentinels': 'entombed sentinels', vashnik: 'vashnik the malignant', 'lost-explorers': 'the lost explorers',
    sszorak: 'sszorak', 'twin-fangs': 'the twin fangs', 'coiled-altar': 'the coiled altar', ulatek: "ula'tek", nymrissa: 'nymrissa wavecaller', kithix: "kith'ix",
  };
  const DIFF_CODE = { 3: 'N', 4: 'H', 5: 'M' };
  const DIFF_LABEL = { N: ['Normal', 'Normal'], H: ['Heroico', 'Heroic'], M: ['Mítico', 'Mythic'] };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const L = tr;
  const ringColor = (type) => (type === 'enrage' ? '#e5e7eb' : MECH_DATA.types[type]?.color || '#888');

  // estilos de los anillos (uno por tipo, con el color del archivo de datos)
  const style = document.createElement('style');
  style.textContent = [...RING_TYPES].map((k) => `.ai[data-mech="${k}"]{border-radius:6px;box-shadow:0 0 0 2px ${ringColor(k)},0 0 9px ${ringColor(k)}88}`).join('\n');
  document.head.appendChild(style);

  const cache = new Map();
  function bossFor(fight) {
    if (!fight || !fight.encounterID || fight.keystoneLevel) return null;
    const n = norm(fight.name);
    return MECH_DATA.bosses.find((b) => {
      const es = norm(b.name.replace(/\(.*\)/, ''));
      const en = EN_NAMES[b.slug] ? norm(EN_NAMES[b.slug]) : '';
      return n === es || n === en || (n.length > 5 && (es.startsWith(n) || n.startsWith(es))) || (en && (en.startsWith(n) || n.startsWith(en)));
    }) || null;
  }

  // todas las mecánicas del jefe con sus nombres normalizados ("A / B" y "(Mítico)" se separan)
  function flat(boss) {
    if (cache.has(boss.slug)) return cache.get(boss.slug);
    const out = [];
    for (const p of boss.phases) {
      for (const m of p.mechanics) {
        const keys = m.name.split('/').map((x) => norm(x.replace(/\(.*?\)/g, ''))).filter(Boolean);
        out.push({ ...m, phase: p.phase, keys });
      }
    }
    cache.set(boss.slug, out);
    return out;
  }

  const skullOf = (m) => (m.diffs.includes('N') ? null : m.diffs[0] === 'H' ? 'H' : 'M');
  const diffOf = (fight) => DIFF_CODE[fight?.difficulty] || null;

  function lookupName(name) {
    const boss = bossFor(S.fight);
    if (!boss) return null;
    const n = norm(name);
    if (n.length < 4) return null;
    const diff = diffOf(S.fight);
    const list = flat(boss).filter((m) => !diff || m.diffs.includes(diff));
    return list.find((m) => m.keys.includes(n)) || list.find((m) => m.keys.some((k) => k.length >= 7 && n.length >= 7 && (k.includes(n) || n.includes(k)))) || null;
  }

  const forSpell = (id, hint) => lookupName(S.abilities?.get(id)?.name || hint);
  const ringType = (id) => { const m = forSpell(id); return m && RING_TYPES.has(m.type) ? m.type : null; };

  const skullSvg = (kind) => `<span class="mg-skull ${kind}" title="${esc(kind === 'M' ? L('Cambios de mítico', 'Mythic changes') : L('Cambios de heroico', 'Heroic changes'))}"><img class="wi" src="icons/inv_misc_bone_humanskull_01.jpg" width="18" height="18" alt=""></span>`;

  function legendHTML() {
    const chip = (k) => `<span class="mg-leg"><i style="background:${ringColor(k)}"></i>${esc(MECH_DATA.types[k].label)}</span>`;
    return `<div class="mg-legend"><b>${L('Leyenda (anillo alrededor del icono)', 'Legend (ring around the icon)')}</b>${['cortable', 'oneshot', 'tanque', 'dispel'].map(chip).join('')}</div>`;
  }

  // Icono de cada mecánica: el de su habilidad real si está en los logs; si no, un icono del juego según su tipo
  const TYPE_ICON = { tanque: 'inv_shield_04', cortable: 'ability_warrior_innerrage', oneshot: 'inv_misc_bone_humanskull_01', dispel: 'spell_holy_devotionaura', raidwide: 'spell_nature_chainlightning', soak: 'inv_misc_bag_10', add: 'inv_axe_09', avoid: 'ability_hunter_snipershot', enrage: 'achievement_boss_kingymiron' };
  function iconOf(m) {
    if (typeof MECH_ICONS !== 'undefined') {
      for (const k of m.keys || []) if (MECH_ICONS[k]) return { src: abilityIconUrl(MECH_ICONS[k].icon), guid: MECH_ICONS[k].guid, real: true };
    }
    return { src: `wcicon://i/${TYPE_ICON[m.type]}`, guid: null, real: false };
  }
  // nombre de la mecánica: en inglés el del Diario de encuentros si se conoce (el icono es el mismo en los dos idiomas)
  function nameOf(m) {
    if (S.lang === 'es' || typeof MECH_ICONS === 'undefined') return m.name;
    for (const k of m.keys || []) if (MECH_ICONS[k]?.en) return MECH_ICONS[k].en;
    return m.name;
  }
  const diffChips = (m, sel) => ['N', 'H', 'M'].map((d) => `<span class="mg-d ${m.diffs.includes(d) ? 'on' : 'off'} d${d} ${d === sel ? 'cur' : ''}" title="${esc(DIFF_LABEL[d][S.lang === 'es' ? 0 : 1])}">${d}</span>`).join('');

  function rowHTML(m, sel) {
    const sk = sel === 'N' ? null : skullOf(m);
    const ic = iconOf(m);
    return `<div class="mg-row" style="--mc:${ringColor(m.type)}">
      <span class="mg-ico ${ic.real ? '' : 'generic'}"${ic.guid ? ` data-spell="${ic.guid}"` : ''}><img src="${ic.src}" width="34" height="34" alt=""></span>
      <div class="mg-body"><div class="mg-top"><b>${esc(nameOf(m))}</b><span class="mg-type">${esc(MECH_DATA.types[m.type].label)}</span><span class="mg-ds">${diffChips(m, sel)}</span>${sk ? skullSvg(sk) : ''}${m.verified ? '' : `<small class="mg-unv" title="${esc(L('Sin verificar en el juego', 'Not verified in game'))}">${L('sin verificar', 'unverified')}</small>`}</div>
      <p>${esc(m.note)}</p></div></div>`;
  }

  function guideHTML(fight) {
    const boss = bossFor(fight);
    if (!boss) return '';
    const fd = diffOf(fight) || 'M';
    const sel = S.mgDiff || fd;
    const chip = (d) => `<button class="chip ${sel === d ? 'on' : ''}" data-action="mg-diff" data-d="${d}">${DIFF_LABEL[d][S.lang === 'es' ? 0 : 1]}</button>`;
    const legend = `<div class="mg-legend wide">${Object.keys(MECH_DATA.types).map((k) => `<span class="mg-leg"><i style="background:${ringColor(k)}"></i>${esc(MECH_DATA.types[k].label)}</span>`).join('')}
      <span class="mg-leg">${skullSvg('H')} ${L('añade heroico', 'added in heroic')}</span><span class="mg-leg">${skullSvg('M')} ${L('añade mítico', 'added in mythic')}</span></div>`;
    const all = flat(boss).filter((m) => m.diffs.includes(sel));
    // Lo importante del jefe: lo que mata, lo que hay que cortar o disipar y lo del tanque
    const KEY = [['oneshot', L('Letal: no se puede fallar', 'Lethal: cannot be failed')], ['enrage', L('Enrage / wipe', 'Enrage / wipe')], ['cortable', L('Hay que interrumpir', 'Must be interrupted')], ['dispel', L('Hay que disipar', 'Must be dispelled')], ['tanque', L('Tanques', 'Tanks')]];
    const keyBlocks = KEY.map(([type, title]) => {
      const ms = all.filter((m) => m.type === type);
      if (!ms.length) return '';
      return `<div class="mg-keyb" style="--mc:${ringColor(type)}"><b>${title}</b>${ms.map((m) => { const ic = iconOf(m); return `<span class="mg-keyi" title="${esc(m.note)}"${ic.guid ? ` data-spell="${ic.guid}"` : ''}><img src="${ic.src}" width="22" height="22" alt="">${esc(nameOf(m))}</span>`; }).join('')}</div>`;
    }).join('');
    const phases = boss.phases.map((p) => {
      const list = p.mechanics.map((m) => all.find((x) => x.name === m.name && x.phase === p.phase)).filter(Boolean);
      if (!list.length) return '';
      return `<h4 class="mg-phase">${esc(p.phase)}</h4><div class="mg-list">${list.map((m) => rowHTML(m, sel)).join('')}</div>`;
    }).join('');
    const counts = Object.entries(all.reduce((o, m) => { o[m.type] = (o[m.type] || 0) + 1; return o; }, {})).map(([k, n]) => `${n} ${MECH_DATA.types[k].label.toLowerCase()}`).join(' · ');
    return `<h3 class="sec">${L('Guía de mecánicas', 'Mechanics guide')} · ${esc(boss.name)}</h3>
      <div class="metricbar">${['N', 'H', 'M'].map(chip).join('')}</div>
      <div class="mg-intro"><b>${esc(boss.wing)}</b> · ${boss.phases.length} ${L('bloques de pelea', 'fight blocks')} · ${all.length} ${L('mecánicas', 'mechanics')} (${esc(counts)})</div>
      ${keyBlocks ? `<div class="mg-key"><div class="mg-key-h">${L('Lo importante de este jefe', 'What matters on this boss')}</div>${keyBlocks}</div>` : ''}
      ${legend}${phases}
      <p class="foot">${L('Guía propia de WipeTime (tools/mechanics_es.json): las marcadas "sin verificar" pueden contener errores. El icono es el de la habilidad real cuando aparece en los logs; si no, un icono del juego según el tipo.', 'WipeTime\'s own guide (tools/mechanics_es.json): items marked "unverified" may contain errors. The icon is the real ability\'s when it appears in logs; otherwise a game icon by type.')}</p>`;
  }

  // mecánicas que añade heroico/mítico para la dificultad de la pelea (resumen para el fight overview)
  function changesHTML(fight) {
    const boss = bossFor(fight);
    const d = diffOf(fight);
    if (!boss || !d || d === 'N') return '';
    const rows = flat(boss).filter((m) => m.diffs.includes(d) && skullOf(m)).filter((m) => d === 'M' || skullOf(m) === 'H');
    if (!rows.length) return '';
    return `<h3 class="sec">${d === 'M' ? L('Cambios de mítico', 'Mythic changes') : L('Cambios de heroico', 'Heroic changes')}</h3><div class="mg-list">${rows.map((m) =>
      `<div class="mg-row" style="--mc:${ringColor(m.type)}"><span class="mg-type">${esc(MECH_DATA.types[m.type].label)}</span><b>${esc(m.name)}</b>${skullSvg(skullOf(m))}<p>${esc(m.note)}</p></div>`).join('')}</div>`;
  }

  // vistas: la guía va primero en Mecánicas; la leyenda también en daño recibido por habilidad
  // Mecánicas = solo la guía del jefe; el análisis de daño evitable vive en su propia pestaña
  VIEWS.mechanics = async (f) => {
    const guide = guideHTML(S.fight);
    return headerHTML(f, t('tabs.mechanics')) + (guide || `<div class="empty">${L('No hay guía de mecánicas para este encuentro.', 'There is no mechanics guide for this encounter.')}</div>`);
  };
  const origDetail = VIEWS.detail;
  VIEWS.detail = async (f) => {
    const html = await origDetail(f);
    if (S.detailMode !== 'takenability' || !bossFor(S.fight)) return html;
    const i = html.indexOf('</div></div>');
    return i >= 0 ? html.slice(0, i + 12) + legendHTML() + html.slice(i + 12) : html;
  };

  // anillos en todos los iconos de habilidad que salgan en pantalla (tablas, muertes, replay…)
  function applyRings(root) {
    if (!S.fight || !root.querySelectorAll) return;
    const els = root.matches?.('[data-spell]') ? [root] : [];
    root.querySelectorAll('[data-spell]').forEach((e) => els.push(e));
    for (const el of els) {
      const img = el.tagName === 'IMG' ? el : el.querySelector('img.ai');
      if (!img || img.dataset.mech || img.dataset.mechChecked === S.fight.id + ':' + S.lang) continue;
      img.dataset.mechChecked = S.fight.id + ':' + S.lang;
      const t = ringType(Number(el.dataset.spell));
      if (t) img.dataset.mech = t;
    }
  }
  let pending = false;
  new MutationObserver((muts) => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) applyRings(n);
    });
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action="mg-diff"]');
    if (b) { S.mgDiff = b.dataset.d; render(); }
  });

  return { ringType, forSpell, lookupName, legendHTML, guideHTML, changesHTML, bossFor, ringColor };
})();
