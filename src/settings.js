'use strict';

// Panel de ajustes: apariencia, replay, datos, cuenta de Warcraft Logs y acerca de.
async function openSettings(tab) {
  const cfg = await window.api.getConfig();
  const info = (await window.api.appInfo?.()) || {};
  const dlg = $('#settings');
  dlg.classList.add('wide', 'settings-dlg');
  const cur = tab || dlg.dataset.tab || 'look';
  dlg.dataset.tab = cur;
  const G = (k) => WCSettings.get(k);
  const seg = (key, opts) => `<div class="segs" data-seg="${key}">${opts.map(([v, label]) =>
    `<button type="button" data-set="${key}" data-v="${esc(String(v))}" class="${String(G(key)) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  const toggle = (key, label, hint = '') => `<label class="set-toggle"><input type="checkbox" data-set-bool="${key}" ${G(key) ? 'checked' : ''}><span class="sw"></span><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  const row = (label, body, hint = '') => `<div class="set-row"><div class="set-l"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="set-c">${body}</div></div>`;
  const swatches = Object.keys(WCSettings.ACCENTS).map((k) =>
    `<button type="button" class="swatch ${G('accent') === k ? 'on' : ''}" data-set="accent" data-v="${k}" style="--sw:${WCSettings.ACCENTS[k][0]}" aria-label="${k}"></button>`).join('');
  const fonts = Object.entries(WCSettings.FONTS).map(([k, f]) => `<option value="${k}" ${G('font') === k ? 'selected' : ''}>${f.label}</option>`).join('');

  const panels = {
    look: `
      ${row(LL('Tema', 'Theme'), seg('theme', [['dark', LL('Oscuro', 'Dark')], ['light', LL('Claro', 'Light')], ['system', LL('Sistema', 'System')]]), LL('«Sistema» sigue el modo de Windows', '“System” follows Windows mode'))}
      ${row(LL('Color de botones', 'Button color'), `<div class="swatches">${swatches}</div>`)}
      ${row(LL('Tamaño de la interfaz', 'Interface size'), `<div class="zoomrow"><input type="range" min="70" max="160" step="5" value="${G('zoom')}" data-zoom><b id="zoomVal">${G('zoom')} %</b><button type="button" class="btn ghost sm" data-set-act="zoom-reset">${LL('Restablecer', 'Reset')}</button></div>`, LL('También con Ctrl y + / − / 0', 'Also with Ctrl and + / − / 0'))}
      ${row(LL('Fuente', 'Font', 'Schriftart', 'Police'), `<select data-font>${fonts}</select><div class="font-prev" id="fontPrev">${LL('Así se ve el texto: Zul’jan 261,2 k · Cénit', 'This is how text looks: Zul’jan 261.2 k · Zenith', 'So sieht der Text aus: Zul’jan 261,2 k · Zenit', 'Voici l’aspect du texte : Zul’jan 261,2 k · Zénith')}</div>`, LL('Expressway y Bahnschrift usan la fuente instalada en tu PC; si no la tienes, se usa una parecida.', 'Expressway and Bahnschrift use the font installed on your PC; if you do not have it, a similar one is used.', 'Expressway und Bahnschrift verwenden die auf deinem PC installierte Schrift; ohne sie wird eine ähnliche genutzt.', 'Expressway et Bahnschrift utilisent la police installée sur ton PC ; sinon, une police proche est utilisée.'))}
      ${row(LL('Densidad', 'Density'), seg('density', [['comfortable', LL('Cómoda', 'Comfortable')], ['compact', LL('Compacta', 'Compact')]]), LL('Compacta muestra más datos en pantalla', 'Compact shows more data on screen'))}
      ${row(LL('Animaciones', 'Animations'), seg('motion', [['full', LL('Normales', 'Normal')], ['reduced', LL('Reducidas', 'Reduced')]]))}
      ${row(LL('Idioma', 'Language'), seg('lang', LANGS.map((l) => [l.code, l.name])))}
      ${toggle('spellTips', LL('Tooltips de habilidades', 'Ability tooltips'), LL('Al pasar el ratón por una habilidad o pasiva, muestra qué hace', 'Hover an ability or passive to see what it does'))}`,
    replay: `
      ${row(LL('Velocidad por defecto', 'Default speed'), seg('rpSpeed', [[0.5, '0,5×'], [1, '1×'], [2, '2×'], [4, '4×']]))}
      ${toggle('rpNames', LL('Mostrar nombres de jugadores', 'Show player names'))}
      ${toggle('rpTrails', LL('Mostrar estelas de movimiento', 'Show movement trails'))}
      ${toggle('rpPets', LL('Mostrar mascotas', 'Show pets'))}
      ${toggle('bossMaps', LL('Usar los mapas de cada jefe (RaidPlan.io)', 'Use each boss map (RaidPlan.io)'), LL('Se descargan solo al abrir el replay de ese jefe y se guardan en tu equipo', 'Downloaded only when you open that boss replay and kept on your PC'))}
      <p class="foot">${LL('Estos valores se aplican al abrir un replay; dentro del replay puedes cambiarlos.', 'These apply when a replay opens; you can change them inside the replay.')}</p>`,
    data: `
      ${toggle('hdIcons', LL('Iconos en alta definición', 'High-definition icons'), LL('Descarga solo los iconos que se usan y los guarda en tu equipo', 'Only downloads the icons that are used and keeps them on your PC'))}
      <div class="set-actions">
        <button type="button" class="btn" data-set-act="clear-icons">${LL('Borrar caché de iconos', 'Clear icon cache')}</button>
        <button type="button" class="btn" data-set-act="clear-spells">${LL('Borrar descripciones de habilidades', 'Clear ability descriptions')}</button>
        <button type="button" class="btn" data-set-act="clear-qcache">${LL('Vaciar caché de logs (más rápida la carga)', 'Clear log cache (faster loading)')}</button>
        <button type="button" class="btn" data-set-act="clear-bossmaps">${LL('Borrar mapas de jefes descargados', 'Clear downloaded boss maps')}</button>
        <button type="button" class="btn" data-set-act="clear-recent">${LL('Borrar reportes recientes', 'Clear recent reports')}</button>
        <button type="button" class="btn" data-set-act="clear-arena">${LL('Borrar mapas generados', 'Clear generated maps')}</button>
        <button type="button" class="btn" data-set-act="open-data">${LL('Abrir carpeta de datos', 'Open data folder')}</button>
        <button type="button" class="btn ghost" data-set-act="reset-all">${LL('Restablecer todos los ajustes', 'Reset all settings')}</button>
      </div>
      <p class="foot">${LL('Los mapas y las imágenes que hayas cargado tú no se borran con estos botones.', 'Maps and images you loaded yourself are not removed by these buttons.')}</p>`,
    version: `
      <div class="ver-card" id="verCard">
        <div class="ver-now"><small class="muted">${LL('Tu versión', 'Your version')}</small><b class="ver-num ${WCUpdate.cls()}">v${esc(info.version || '?')}</b></div>
        <div class="ver-state" id="verState">${WCUpdate.stateHTML()}</div>
      </div>
      <div class="set-actions">
        <button type="button" class="btn primary" data-set-act="update-now" id="doUpdate">${WCUpdate.buttonLabel()}</button>
      </div>
      <div class="ver-prog" id="verProg" hidden><i></i></div>
      ${toggle('autoUpdateCheck', LL('Buscar actualizaciones al abrir', 'Check for updates on startup'))}
      <h3>${LL('Historial de versiones', 'Version history')}</h3>
      <div class="changelog">${WCUpdate.CHANGELOG.map(([v, es, en]) => `<div><b>v${v}</b><span>${S.lang === 'es' ? es : en}</span></div>`).join('')}</div>`,
    about: `
      <div class="about big"><img src="logo.png" alt="" width="120" height="120">
        <div><h2>WipeTime <span class="v">v${esc(info.version || '')}</span></h2>
          <p class="about-desc">${LL('Plataforma de análisis de combate para World of Warcraft: informes, repeticiones y comparativas de rendimiento a partir de Warcraft Logs.', 'Combat analysis platform for World of Warcraft: reports, replays and performance comparisons built on Warcraft Logs.')} <span class="about-es">${LL('España', 'Spain')} <svg viewBox="0 0 3 2" width="30" height="20" aria-label="ES" style="border-radius:3px"><rect width="3" height="2" fill="#c60b1e"/><rect y=".5" width="3" height="1" fill="#ffc400"/></svg></span></p>
          <p>${t('madeBy')} <b>Drakko</b> <span class="heart-s">♥</span></p>
          <p class="about-dc" style="margin-top:30px"><svg viewBox="0 0 127.14 96.36" width="26" height="20" aria-hidden="true"><path fill="#5865F2" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg> <b>sr.kitkat</b> <span class="muted">${LL('dudas y preguntas', 'questions')}</span></p>
          <p class="about-dc"><img src="battlenet.png" width="26" height="26" alt="" style="border-radius:6px"> <b>KitKat#21202</b> <span class="muted">${LL('dudas y preguntas', 'questions')}</span></p></div></div>`,
  };
  const tabs = [['look', LL('Apariencia', 'Appearance')], ['replay', 'Replay'], ['data', LL('Datos', 'Data')], ['version', LL('Versión', 'Version')], ['about', LL('Acerca de', 'About')]];
  dlg.innerHTML = `<form method="dialog" id="settingsForm" class="set-wrap">
    <div class="set-nav"><h2>${t('settings')}</h2>${tabs.map(([k, l]) => `<button type="button" class="set-tab ${k === cur ? 'on' : ''}" data-set-tab="${k}">${l}</button>`).join('')}
      <span class="grow"></span><button type="button" class="btn ghost" data-action="close">${LL('Cerrar', 'Close')}</button></div>
    <div class="set-body">${panels[cur]}</div></form>`;
  const fp = $('#fontPrev');
  if (fp) fp.style.fontFamily = WCSettings.FONTS[G('font')].css;
  if (!dlg.open) dlg.showModal();
}

function toastSet(msg) { toast(msg); }

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-set], [data-set-tab], [data-set-act]');
  if (!el || !el.closest('#settings')) return;
  if (el.dataset.setTab) { openSettings(el.dataset.setTab); return; }
  if (el.dataset.set) {
    const key = el.dataset.set;
    let v = el.dataset.v;
    if (key === 'rpSpeed') v = Number(v);
    if (key === 'lang') {
      setLang(v);
      await new Promise((r) => setTimeout(r, 60));
      openSettings('look');
      return;
    }
    WCSettings.set(key, v);
    openSettings();
    return;
  }
  const act = el.dataset.setAct;
  if (act === 'zoom-reset') { WCSettings.set('zoom', 100); openSettings(); }
  else if (act === 'clear-icons') { const n = await window.api.clearIcons(); toastSet(LL(`Caché de iconos borrada (${n} archivos)`, `Icon cache cleared (${n} files)`, `Symbol-Cache geleert (${n} Dateien)`, `Cache des icônes vidé (${n} fichiers)`)); }
  else if (act === 'update-now') WCUpdate.updateNow();
  else if (act === 'clear-spells') { const n = await window.api.clearSpells(); toastSet(LL(`Descripciones borradas (${n})`, `Descriptions cleared (${n})`, `Beschreibungen gelöscht (${n})`, `Descriptions effacées (${n})`)); }
  else if (act === 'clear-qcache') { const n = await window.api.clearQueryCache(); toastSet(LL(`Caché de logs vaciada (${n} archivos)`, `Log cache cleared (${n} files)`, `Log-Cache geleert (${n} Dateien)`, `Cache des logs vidé (${n} fichiers)`)); }
  else if (act === 'clear-bossmaps') { const n = await window.api.clearBossMaps(); toastSet(LL(`Mapas de jefes borrados (${n})`, `Boss maps cleared (${n})`, `Bosskarten gelöscht (${n})`, `Cartes de boss effacées (${n})`)); }
  else if (act === 'clear-recent') { try { localStorage.removeItem('recent'); } catch { /* nada */ } toastSet(LL('Reportes recientes borrados', 'Recent reports cleared')); if (S.home && !S.cmpOpen) renderWelcome(); }
  else if (act === 'clear-arena') {
    let n = 0;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('arena:') || k.startsWith('bench:') || k.startsWith('dist:')) { localStorage.removeItem(k); n++; } } catch { /* nada */ }
    toastSet(LL(`Mapas generados y comparativas borrados (${n})`, `Generated maps and benchmarks cleared (${n})`, `Erzeugte Karten und Vergleiche gelöscht (${n})`, `Cartes générées et comparatifs effacés (${n})`));
  } else if (act === 'open-data') window.api.openDataFolder();
  else if (act === 'reset-all') {
    WCSettings.reset();
    await window.api.setPref('hdIcons', true);
    toastSet(LL('Ajustes restablecidos', 'Settings reset'));
    openSettings();
  }
});

document.addEventListener('input', (ev) => {
  const t0 = ev.target;
  if (!t0.closest || !t0.closest('#settings')) return;
  if (t0.dataset.zoom !== undefined) { WCSettings.set('zoom', Number(t0.value)); const z = $('#zoomVal'); if (z) z.textContent = `${t0.value} %`; }
});

document.addEventListener('change', async (ev) => {
  const t0 = ev.target;
  if (!t0.closest || !t0.closest('#settings')) return;
  if (t0.dataset.font !== undefined) {
    WCSettings.set('font', t0.value);
    const fp = $('#fontPrev');
    if (fp) fp.style.fontFamily = WCSettings.FONTS[t0.value].css;
  } else if (t0.dataset.setBool) {
    const k = t0.dataset.setBool;
    WCSettings.set(k, t0.checked);
    if (k === 'hdIcons') await window.api.setPref('hdIcons', t0.checked);
  }
});

// Zoom con teclado (Ctrl +, Ctrl -, Ctrl 0)
document.addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey || ev.altKey) return;
  const cur = WCSettings.get('zoom');
  let next = null;
  if (ev.key === '+' || ev.key === '=') next = Math.min(160, cur + 10);
  else if (ev.key === '-' || ev.key === '_') next = Math.max(70, cur - 10);
  else if (ev.key === '0') next = 100;
  if (next == null) return;
  ev.preventDefault();
  WCSettings.set('zoom', next);
  toast(`${LL('Tamaño de la interfaz', 'Interface size')}: ${next} %`);
});
