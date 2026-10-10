'use strict';

// Estado de versión: número en la barra superior y en Ajustes > Versión (rojo si estás atrasado, verde si es la última).
const WCUpdate = (() => {
  let res = null; // último resultado de update:check
  let version = '';

  // Historial: [versión, es, en]
  const CHANGELOG = [
    ['0.4.4', 'Actualización con un solo botón en Ajustes → Versión: comprueba, descarga, instala y reabre WipeTime sin escribir ninguna dirección de GitHub.', 'One-button update in Settings → Version: it checks, downloads, installs and reopens WipeTime without typing any GitHub address.'],
    ['0.4.3', 'Servidor intermedio movido a Vercel: WipeTime vuelve a funcionar sin claves propias incluso durante los bloqueos de IPs de Cloudflare por los partidos de fútbol.', 'Intermediate server moved to Vercel: WipeTime works again without your own keys even during the Cloudflare IP blocks caused by football matches.'],
    ['0.4.2', 'Nueva ficha de personaje (Buscar personaje en el inicio): posiciones mundial, de región y de reino, tabla por jefe, parche y dificultad, puntuación de Mítica+, equipo y modelo en vivo, botón Actualizar y días sin actualizar el equipo; la armería muestra el modelo del personaje, sin hueco de mano izquierda si lleva arma a dos manos y con los números de las estadísticas; guilds y personajes se registran a mano sin iniciar sesión; fuera las pestañas de credenciales de Ajustes.', 'New character page (Find a character on the home screen): world, region and realm rankings, per-boss table, patch and difficulty, Mythic+ score, live gear and model, Update button and days since the gear was last updated; the armory shows the character model, no off-hand slot with a two-handed weapon and the stat numbers; guilds and characters are registered by hand without signing in; credential tabs removed from Settings.'],
    ['0.4.1', 'Botón «Idiomas» con español, inglés, alemán y francés (el idioma en uso va resaltado); al compararte con los mejores salen su nombre y reino en lugar de Top 1, 2, 3 (con soporte de caracteres chinos, coreanos y cirílicos) y el ranking se pide siempre en vivo; en tu perfil, al pulsar un personaje se despliega su armería con equipo y estadísticas en número y %; iconos de la barra superior sin el aro interior.', 'New «Languages» button with Spanish, English, German and French (the language in use is highlighted); when you compare with the best, their name and realm replace Top 1, 2, 3 (with Chinese, Korean and Cyrillic character support) and the ranking is always fetched live; in your profile, clicking a character opens its armory with gear and stats as numbers and %; top-bar icons without the inner ring.'],
    ['0.4.0', 'Logo oficial de Battle.net en Acerca de.', 'Official Battle.net logo in About.'],
    ['0.3.9', 'Carga mucho más rápida: caché en disco de los datos de Warcraft Logs (reabrir un log o un replay es casi instantáneo), eventos del replay y de los análisis descargados en paralelo, plantillas de guild precargadas y cachés de guild de 24 h. Botón para vaciar la caché en Ajustes → Datos. Contacto de Discord y del icono de Battle.net en Acerca de.', 'Much faster loading: on-disk cache of Warcraft Logs data (reopening a log or replay is almost instant), replay and analysis events downloaded in parallel, preloaded guild rosters and 24 h guild caches. Button to clear the cache in Settings → Data. Discord and Battle.net contact in About.'],
    ['0.3.8', 'El creador del instalador pasa a ser sr.kitkat; Acerca de con Battle.net (KitKat#21202) y Discord más abajo; quitado el campo Mi personaje de Ajustes.', 'Installer publisher is now sr.kitkat; About with Battle.net (KitKat#21202) and Discord lower; removed the My character field from Settings.'],
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
    if (!res) return `<span class="muted">${tr('Aún no se ha comprobado.', 'Not checked yet.', 'Noch nicht geprüft.', 'Pas encore vérifié.')}</span>`;
    if (res.error === 'NO_SOURCE') return `<span class="muted">${tr('Configura abajo la fuente de actualizaciones para poder comprobar la última versión.', 'Set the update source below to check for the latest version.', 'Lege unten die Update-Quelle fest, um die neueste Version zu prüfen.', 'Configure ci-dessous la source des mises à jour pour vérifier la dernière version.')}</span>`;
    if (res.error) return `<span class="bad">${tr('No se pudo comprobar', 'Could not check', 'Prüfung nicht möglich', 'Vérification impossible')}: ${esc(res.error)}</span>`;
    if (res.outdated) return `<span class="bad">${tr(`Versión atrasada · la última es v${esc(res.latest)}`, `Outdated · latest is v${esc(res.latest)}`, `Veraltet · die neueste ist v${esc(res.latest)}`, `Version obsolète · la dernière est v${esc(res.latest)}`)}</span>${res.notes ? `<pre class="ver-notes">${esc(res.notes.slice(0, 600))}</pre>` : ''}`;
    return `<span class="ok">${tr('Tienes la versión más reciente', 'You have the latest version', 'Du hast die neueste Version', 'Tu as la dernière version')}</span>`;
  }

  function paintBadge() {
    const b = document.getElementById('verBadge');
    if (!b) return;
    b.textContent = `v${version}`;
    b.className = `ver-badge ${cls()}`;
    b.title = !res ? '' : res.error ? '' : res.outdated ? (tr(`Hay una versión nueva: v${res.latest}`, `New version available: v${res.latest}`, `Neue Version verfügbar: v${res.latest}`, `Nouvelle version disponible : v${res.latest}`)) : (tr('Última versión', 'Latest version', 'Neueste Version', 'Dernière version'));
  }

  async function check(manual) {
    if (!version) version = ((await window.api.appInfo?.()) || {}).version || '';
    res = await window.api.updateCheck();
    paintBadge();
    if (manual && res.outdated) toast(tr(`Hay una versión nueva: v${res.latest}`, `New version available: v${res.latest}`, `Neue Version verfügbar: v${res.latest}`, `Nouvelle version disponible : v${res.latest}`));
    return res;
  }

  async function install() {
    const btn = document.getElementById('doUpdate');
    const prog = document.getElementById('verProg');
    if (btn) { btn.disabled = true; btn.textContent = tr('Descargando…', 'Downloading…', 'Lädt herunter…', 'Téléchargement…'); }
    if (prog) prog.hidden = false;
    window.api.onUpdateProgress?.((f) => { const i = document.querySelector('#verProg i'); if (i) i.style.width = `${Math.round(f * 100)}%`; });
    const r = await window.api.updateInstall();
    if (r.error) {
      toast((tr('Error al actualizar: ', 'Update failed: ', 'Update fehlgeschlagen: ', 'Échec de la mise à jour : ')) + r.error);
      if (btn) { btn.disabled = false; btn.textContent = buttonLabel(); }
    }
  }

  // Un solo botón: comprueba si hay versión nueva y, si la hay, la descarga e instala
  async function updateNow() {
    const btn = document.getElementById('doUpdate');
    if (btn) { btn.disabled = true; btn.textContent = tr('Buscando…', 'Checking…', 'Suche…', 'Recherche…'); }
    const r = await check(false);
    const st = document.getElementById('verState');
    if (st) st.innerHTML = stateHTML();
    if (r.error) { toast(tr('No se pudo comprobar', 'Could not check', 'Prüfung nicht möglich', 'Vérification impossible') + `: ${r.error}`); if (btn) { btn.disabled = false; btn.textContent = buttonLabel(); } return; }
    if (!r.outdated) { toast(tr('Tienes la versión más reciente', 'You have the latest version', 'Du hast die neueste Version', 'Tu as la dernière version')); if (btn) { btn.disabled = false; btn.textContent = buttonLabel(); } return; }
    if (!r.canInstall) { toast(tr('Hay una versión nueva, pero no se puede instalar sola', 'A new version exists, but it cannot be installed automatically', 'Es gibt eine neue Version, sie lässt sich aber nicht automatisch installieren', 'Une nouvelle version existe, mais elle ne peut pas être installée automatiquement')); if (btn) { btn.disabled = false; btn.textContent = buttonLabel(); } return; }
    await install();
  }

  const buttonLabel = () => (res?.outdated
    ? tr(`Actualizar a v${res.latest}`, `Update to v${res.latest}`, `Auf v${res.latest} aktualisieren`, `Mettre à jour vers v${res.latest}`)
    : tr('Buscar e instalar actualización', 'Check and install update', 'Nach Update suchen und installieren', 'Rechercher et installer la mise à jour'));

  async function init() {
    version = ((await window.api.appInfo?.()) || {}).version || '';
    paintBadge();
    if (WCSettings.get('autoUpdateCheck') !== false) check(false);
  }

  const reset = () => { res = null; paintBadge(); };
  document.addEventListener('DOMContentLoaded', init);
  return { check, install, updateNow, buttonLabel, init, reset, cls, canInstall, stateHTML, CHANGELOG };
})();
