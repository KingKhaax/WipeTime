'use strict';

// Tooltips de habilidades y pasivas: al pasar el ratón por cualquier elemento con data-spell="ID" se muestra
// qué hace (descripción en el idioma de la app, coste, alcance, reutilización…). Los textos vienen de los
// tooltips públicos de Wowhead y se guardan en caché en tu equipo.
const SpellTip = (() => {
  const cache = new Map();
  let el = null;
  let timer = null;
  let current = null; // elemento bajo el ratón
  let shownId = null;

  const es = () => S.lang === 'es';
  const SCALING = {
    'Attack Power': ['poder de ataque', 'Attack Power'], 'Spell Power': ['poder con hechizos', 'Spell Power'],
    'Weapon Damage': ['daño del arma', 'Weapon Damage'], 'Max Health': ['salud máxima', 'Max Health'],
  };

  function ensureEl() {
    if (!el) {
      el = document.createElement('div');
      el.className = 'spelltip surface-dark';
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  // ---- HTML de Wowhead -> líneas de texto limpias
  function toText(node, out) {
    if (node.nodeType === 3) { out.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IMG') return;
    if (node.classList.contains('tooltip-inside-icon')) return;
    if (tag === 'BR') { out.push('\n'); return; }
    if (tag === 'TR') {
      const cells = [...node.children].map((c) => { const o = []; toText(c, o); return o.join('').trim(); }).filter(Boolean);
      out.push(cells.join('  ·  '), '\n');
      return;
    }
    const block = tag === 'DIV' || tag === 'TABLE' || tag === 'P';
    if (node.classList.contains('q2')) { out.push('\n⟦'); node.childNodes.forEach((c) => toText(c, out)); out.push('⟧\n'); return; }
    if (block) out.push('\n');
    node.childNodes.forEach((c) => toText(c, out));
    if (block) out.push('\n');
  }

  function clean(text) {
    let t = text.replace(/\r/g, '');
    // "[84.7% of Attack Power]" -> "84,7 % del poder de ataque"
    t = t.replace(/\[\s*([\d.,]+)\s*% of ([^\]]+?)\s*\]/g, (_m, n, what) => {
      const num = n.replace(',', '.');
      const val = Number(num).toLocaleString(es() ? 'es-ES' : 'en-US', { maximumFractionDigits: 1 });
      const name = SCALING[what.trim()];
      return es() ? `${val} % del ${name ? name[0] : what}` : `${val}% of ${what}`;
    });
    // fórmulas sin resolver entre corchetes
    for (let i = 0; i < 6; i++) {
      const next = t.replace(/\[[^[\]]*(?:\*|--|\/|Offhand|\+)[^[\]]*\]/g, '');
      if (next === t) break;
      t = next;
    }
    t = t.replace(/\(\s*([\d.,]+)\s*\*\s*[\d.]+\s*\)/g, '$1').replace(/\[Item Effect\]/g, es() ? 'Efecto de objeto' : 'Item effect')
      .replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').replace(/[ \t]+/g, ' ').replace(/ ([.,;:)])/g, '$1');
    return t;
  }

  function parse(raw) {
    const doc = new DOMParser().parseFromString(`<div id="r">${raw || ''}</div>`, 'text/html');
    const root = doc.getElementById('r');
    const tables = [...root.children].filter((n) => n.tagName === 'TABLE');
    const lines = (node) => {
      if (!node) return [];
      const out = [];
      toText(node, out);
      return clean(out.join('')).split('\n').map((l) => l.trim()).filter(Boolean);
    };
    const nameEl = root.querySelector('.whtt-name');
    const head = tables[0] ? (() => { const c = tables[0].cloneNode(true); c.querySelectorAll('a.whtt-name').forEach((n) => n.remove()); return lines(c); })() : [];
    const desc = tables[1] ? lines(tables[1]) : [];
    return { name: nameEl?.textContent || '', head: head.filter((l) => !/^(Requiere nivel|Requires level)/i.test(l)), desc };
  }

  function mechBlock(id, name) {
    const m = typeof MechGuide !== 'undefined' ? MechGuide.forSpell(id, name) : null;
    if (!m) return '';
    const c = MechGuide.ringColor(m.type);
    return `<div class="st-mech" style="--mc:${c}"><b>${es() ? 'Guía de WipeTime' : 'WipeTime guide'} · ${esc(MECH_DATA.types[m.type].label)}</b><p>${esc(m.note)}</p></div>`;
  }

  function render(id, data, fallbackName, extra) {
    const meta = data.head.map((l) => `<div>${esc(l)}</div>`).join('');
    const descHtml = data.desc.map((l) => (l.startsWith('⟦') ? `<h4>${esc(l.replace(/[⟦⟧]/g, ''))}</h4>` : `<p>${esc(l)}</p>`)).join('');
    const buffHtml = data.buff?.length ? `<div class="st-buff"><b>${es() ? 'Efecto' : 'Effect'}</b>${data.buff.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '';
    return `<div class="st-head">${data.icon ? `<img src="${abilityIconUrl(data.icon)}" width="40" height="40" alt="">` : ''}
      <div><b class="st-name">${esc(data.name || fallbackName || `#${id}`)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div></div>
      ${meta ? `<div class="st-meta">${meta}</div>` : ''}
      ${descHtml ? `<div class="st-desc">${descHtml}</div>` : `<div class="st-desc"><p class="muted">${es() ? 'Sin descripción disponible.' : 'No description available.'}</p></div>`}
      ${buffHtml}${mechBlock(id, data.name || fallbackName)}<div class="st-foot">ID ${id} · Wowhead</div>`;
  }

  function load(id) {
    const key = `${S.lang}:${id}`;
    if (!cache.has(key)) {
      cache.set(key, window.api.spellTip(id, es() ? 'es' : 'en').then((r) => {
        if (!r || r.error) throw new Error(r?.error || 'ERR');
        const p = parse(r.tooltip);
        const b = r.buff ? parse(r.buff) : null;
        return { name: r.name || p.name, icon: r.icon, head: p.head, desc: p.desc, buff: b ? b.desc.filter((l) => l !== (r.name || p.name)) : [] };
      }).catch((e) => { cache.delete(key); throw e; }));
    }
    return cache.get(key);
  }

  function place(x, y) {
    const t = ensureEl();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    t.style.left = `${Math.max(8, Math.min(x + 18, vw - w - 8))}px`;
    t.style.top = `${Math.max(8, y + 22 + h > vh ? y - h - 14 : y + 22)}px`;
  }

  async function show(target, x, y) {
    if (WCSettings.get('spellTips') === false) return;
    const id = Number(target.dataset.spell);
    if (!id) return;
    const t = ensureEl();
    shownId = id;
    const name = target.dataset.spellName || '';
    const extra = target.dataset.spellExtra || '';
    t.innerHTML = `<div class="st-head"><div><b class="st-name">${esc(name || `#${id}`)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div></div><div class="st-desc"><p class="muted">${es() ? 'Cargando…' : 'Loading…'}</p></div>`;
    t.hidden = false;
    place(x, y);
    try {
      const data = await load(id);
      if (shownId !== id || t.hidden) return;
      t.innerHTML = render(id, data, name, extra);
    } catch {
      if (shownId !== id || t.hidden) return;
      t.innerHTML = `<div class="st-head"><div><b class="st-name">${esc(name || `#${id}`)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div></div><div class="st-desc"><p class="muted">${es() ? 'No se pudo cargar la descripción.' : 'Could not load the description.'}</p></div><div class="st-foot">ID ${id}</div>`;
    }
    place(x, y);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    current = null;
    shownId = null;
    if (el) el.hidden = true;
  }

  let lastX = 0;
  let lastY = 0;
  document.addEventListener('mouseover', (ev) => {
    const target = ev.target.closest?.('[data-spell]');
    if (!target) { if (current) hide(); return; }
    if (target === current) return;
    hide();
    current = target;
    lastX = ev.clientX; lastY = ev.clientY;
    timer = setTimeout(() => { if (current === target) show(target, lastX, lastY); }, 200);
  });
  document.addEventListener('mouseout', (ev) => {
    if (!current) return;
    const to = ev.relatedTarget;
    if (to && current.contains(to)) return;
    hide();
  });
  document.addEventListener('mousemove', (ev) => {
    lastX = ev.clientX; lastY = ev.clientY;
    if (el && !el.hidden) place(lastX, lastY);
  });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);

  return { hide };
})();
