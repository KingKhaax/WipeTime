'use strict';

// Estado de versión: número en la barra superior y en Ajustes > Versión (rojo si estás atrasado, verde si es la última).
const WCUpdate = (() => {
  const es = () => S.lang === 'es';
  let res = null; // último resultado de update:check
  let version = '';

  // Historial: [versión, es, en]
  const CHANGELOG = [
    ['0.3.7', 'Ranking de guild con clasificación por Daño, Sanación o Daño al jefe.', 'Guild ranking with Damage, Healing or Boss damage classification.'],
    ['0.3.6', 'El programa pasa a llamarse WipeTime (tus datos y ajustes se conservan); el desplegable de tu guild sale justo debajo de ella; Clasificaciones en tres ventanas (DPS, tanques, sanadores) por daño, sanación o daño al jefe, con parse y parse por nivel de objeto; "No estoy en el log" arriba del todo y solo con los jugadores del log; Replay solo en raids, con zoom y arrastre; sin Buffos por jugador; iconos reales e inglés en la guía de mecánicas; servidor intermedio opcional para no pedir claves.', 'The program is now called WipeTime (your data and settings are kept); your guild dropdown shows right under it; Rankings in three windows (DPS, tanks, healers) by damage, healing or boss damage, with parse and item-level parse; "I am not in the log" at the very top and only with the players of the log; Replay only for raids, with zoom and drag; no Buffs per player; real icons and English in the mechanics guide; optional proxy server so no keys are asked.'],
    ['0.2.8', 'Pestañas reordenadas por importancia (Informe general primero, luego Resumen), nueva pestaña Daño evitable, Mecánicas solo con la guía, buffos de banda por clase dentro de Buffos con la barra siempre en el mismo sitio, Resumen del intento traducido, orden por parse en Daño y Sanación, "Nivel de objeto", quitado el enlace wipetime:// de Exportar.', 'Tabs reordered by importance (General report first, then Summary), new Avoidable damage tab, Mechanics only shows the guide, raid buffs by class inside Buffs with the bar always in the same place, translated Fight overview, parse sorting in Damage and Healing, "Item level", removed the wipetime:// link from Export.'],
    ['0.2.7', 'Prepoti: si el buff ya estaba activo al empezar el pull se cuenta en 0:00; se registra el uso de la piedra de salud.', 'Prepot: if the buff was already active when the pull started it counts at 0:00; healthstone usage is tracked.'],
    ['0.2.6', 'Resumen: al hacer clic en un jugador se abre su equipo (como la armería) y los talentos que usó en ese jefe.', 'Summary: clicking a player opens their gear (armory style) and the talents used on that boss.'],
    ['0.2.5', 'Iconos de rol PvP originales, icono de spec en lugar del punto y tooltip con la pieza exacta sin encantar.', 'Original PvP role icons, spec icon instead of the dot and a tooltip with the exact unenchanted piece.'],
    ['0.2.4', 'Acerca de rediseñado (texto, España, Discord) y "Color de botones" en Apariencia.', 'Redesigned About (text, Spain, Discord) and "Button color" in Appearance.'],
    ['0.2.3', 'Soporte opcional para credenciales incluidas en el programa.', 'Optional support for credentials bundled with the program.'],
    ['0.2.2', 'Comparar logs: maná del sanador y mitigación/pasivas del tanque.', 'Compare logs: healer mana and tank mitigation/passives.'],
    ['0.2.1', 'Defensivos: registro exacto de quién usó qué, cuándo y sobre quién.', 'Defensives: exact log of who used what, when and on whom.'],
    ['0.2.0', 'Guía de mecánicas con iconos, dificultades y lo importante de cada jefe.', 'Mechanics guide with icons, difficulties and what matters on each boss.'],
    ['0.1.9', 'Pestañas renombradas, sin Progreso y muertes con icono de spec.', 'Renamed tabs, no Progress and deaths with spec icon.'],
    ['0.1.8', 'Replay: buffos y debuffos del jugador, su objetivo y el jefe.', 'Replay: buffs and debuffs of the player, their target and the boss.'],
    ['0.1.7', 'Top 5 de interrupciones en el resumen.', 'Top 5 interrupts in the summary.'],
    ['0.1.6', 'Temporizador del 12.1.5 en cajas.', '12.1.5 countdown in boxes.'],
    ['0.1.5', 'Comparar logs: hay que pulsar Cargar logs tras añadir, quitar o cambiar un log; si un log no carga ya no sale con 0 de daño y sin rotación, se reintenta y se avisa. Habilidades repetidas del analizador.', 'Compare logs: Load logs is required after adding, removing or changing a log; a log that fails to load no longer shows 0 damage and no rotation, it is retried and reported. Duplicate analyzer abilities.'],
    ['0.1.4', 'Iconos de WoW del paquete en lugar de los dibujados (barra superior, roles, menú de exportar, calaveras); ranking mundial real de Raider.IO en Heroico y Normal.', 'WoW icons from the pack instead of drawn ones (top bar, roles, export menu, skulls); real world ranking from Raider.IO on Heroic and Normal.'],
    ['0.1.3', 'Quitar personajes de "Tus personajes" y sección de personajes favoritos.', 'Remove characters from "Your characters" and a favorite characters section.'],
    ['0.1.2', 'Buscar guilds solo por nombre, sin saber el reino.', 'Find guilds by name only, without knowing the realm.'],
    ['0.1.1', 'Retratos de personaje y escudos de guild.', 'Character portraits and guild crests.'],
    ['0.1.0', 'Primera versión: daño, sanación, muertes, buffos, rotación y parses; replay con mapas; analizador y comparador de logs; Resumen, Detalle, Gráficas, Defensivos y Mecánicas con guía por dificultad; Mítica+; informe de la noche con rankings; guilds con Battle.net y ranking por rol; cuenta atrás y contenido del parche 12.1.5; tooltips; iconos de WoW; nueva estética con los colores del logo.', 'First version: damage, healing, deaths, buffs, rotation and parses; replay with maps; log analyzer and comparison; Summary, Detail, Graphs, Defensives and Mechanics with a per-difficulty guide; Mythic+; night report with rankings; guilds with Battle.net and role-based ranking; countdown and content for patch 12.1.5; tooltips; WoW icons; new look with the logo colors.'],
  ];

  const cls = () => (!res || res.error ? '' : res.outdated ? 'bad' : 'ok');
  const canInstall = () => !!(res && res.outdated && res.canInstall);

  function stateHTML() {
    if (!res) return `<span class="muted">${es() ? 'Aún no se ha comprobado.' : 'Not checked yet.'}</span>`;
    if (res.error === 'NO_SOURCE') return `<span class="muted">${es() ? 'Configura abajo la fuente de actualizaciones para poder comprobar la última versión.' : 'Set the update source below to check for the latest version.'}</span>`;
    if (res.error) return `<span class="bad">${es() ? 'No se pudo comprobar' : 'Could not check'}: ${esc(res.error)}</span>`;
    if (res.outdated) return `<span class="bad">${es() ? `Versión atrasada · la última es v${esc(res.latest)}` : `Outdated · latest is v${esc(res.latest)}`}</span>${res.notes ? `<pre class="ver-notes">${esc(res.notes.slice(0, 600))}</pre>` : ''}`;
    return `<span class="ok">${es() ? 'Tienes la versión más reciente' : 'You have the latest version'}</span>`;
  }

  function paintBadge() {
    const b = document.getElementById('verBadge');
    if (!b) return;
    b.textContent = `v${version}`;
    b.className = `ver-badge ${cls()}`;
    b.title = !res ? '' : res.error ? '' : res.outdated ? (es() ? `Hay una versión nueva: v${res.latest}` : `New version available: v${res.latest}`) : (es() ? 'Última versión' : 'Latest version');
  }

  async function check(manual) {
    if (!version) version = ((await window.api.appInfo?.()) || {}).version || '';
    const src = WCSettings.get('updateSource');
    res = await window.api.updateCheck(src);
    paintBadge();
    if (manual && res.outdated) toast(es() ? `Hay una versión nueva: v${res.latest}` : `New version available: v${res.latest}`);
    return res;
  }

  async function install() {
    const btn = document.getElementById('doUpdate');
    const prog = document.getElementById('verProg');
    if (btn) { btn.disabled = true; btn.textContent = es() ? 'Descargando…' : 'Downloading…'; }
    if (prog) prog.hidden = false;
    window.api.onUpdateProgress?.((f) => { const i = document.querySelector('#verProg i'); if (i) i.style.width = `${Math.round(f * 100)}%`; });
    const r = await window.api.updateInstall();
    if (r.error) {
      toast((es() ? 'Error al actualizar: ' : 'Update failed: ') + r.error);
      if (btn) { btn.disabled = false; btn.textContent = es() ? 'Actualizar a la versión más reciente' : 'Update to the latest version'; }
    }
  }

  async function init() {
    version = ((await window.api.appInfo?.()) || {}).version || '';
    paintBadge();
    if (WCSettings.get('autoUpdateCheck') !== false && WCSettings.get('updateSource')) check(false);
  }

  const reset = () => { res = null; paintBadge(); };
  document.addEventListener('DOMContentLoaded', init);
  return { check, install, init, reset, cls, canInstall, stateHTML, CHANGELOG };
})();
