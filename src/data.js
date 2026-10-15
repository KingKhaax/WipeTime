'use strict';

const ICON_BASE = 'https://assets.rpglogs.com/img/warcraft/abilities/';
const SPEC_ICON_BASE = 'https://assets.rpglogs.com/img/warcraft/icons/';
const FALLBACK_ICON = 'icons/inv_misc_questionmark.jpg'; // incluida en el programa

// Iconos HD servidos por el programa (paquete Clean Icons, con respaldo al CDN de Warcraft Logs)
const abilityIconUrl = (icon) => (icon ? `wcicon://i/${encodeURIComponent(String(icon).replace(/\.(jpg|png)$/i, ''))}` : FALLBACK_ICON);
// Iconos de clase incluidos en el programa (src/classes/): no dependen de descargas ni de caché. Evoker no sale en la hoja de Blizzard y usa la imagen de Warcraft Logs.
const classIconUrl = (cls) => { const k = String(cls).toLowerCase().replace(/[^a-z]/g, ''); return `classes/${k}.${k === 'evoker' ? 'jpg' : 'png'}`; };
// Sin especialización conocida (icono «Druid» a secas) se usa el icono de la clase
// Los iconos de spec van incluidos en el programa (src/specs/): no dependen de la red
const specIconUrl = (icon) => (icon && !String(icon).includes('-') ? classIconUrl(icon) : `specs/${String(icon).toLowerCase().replace(/[^a-z-]/g, '')}.png`);

const CLASSES = {
  DeathKnight: { color: '#C41E3A', es: 'Caballero de la Muerte', en: 'Death Knight' },
  DemonHunter: { color: '#A330C9', es: 'Cazador de demonios', en: 'Demon Hunter' },
  Druid: { color: '#FF7C0A', es: 'Druida', en: 'Druid' },
  Evoker: { color: '#33937F', es: 'Evocador', en: 'Evoker' },
  Hunter: { color: '#AAD372', es: 'Cazador', en: 'Hunter' },
  Mage: { color: '#3FC7EB', es: 'Mago', en: 'Mage' },
  Monk: { color: '#00FF98', es: 'Monje', en: 'Monk' },
  Paladin: { color: '#F48CBA', es: 'Paladín', en: 'Paladin' },
  Priest: { color: '#FFFFFF', es: 'Sacerdote', en: 'Priest' },
  Rogue: { color: '#FFF468', es: 'Pícaro', en: 'Rogue' },
  Shaman: { color: '#0070DD', es: 'Chamán', en: 'Shaman' },
  Warlock: { color: '#8788EE', es: 'Brujo', en: 'Warlock' },
  Warrior: { color: '#C69B6D', es: 'Guerrero', en: 'Warrior' },
};

const SPECS_ES = {
  Blood: 'Sangre', Frost: 'Escarcha', Unholy: 'Profano',
  Havoc: 'Caos', Vengeance: 'Venganza', Devourer: 'Devorador',
  Balance: 'Equilibrio', Feral: 'Feral', Guardian: 'Guardián', Restoration: 'Restauración',
  Devastation: 'Devastación', Preservation: 'Preservación', Augmentation: 'Aumento',
  BeastMastery: 'Bestias', Marksmanship: 'Puntería', Survival: 'Supervivencia',
  Arcane: 'Arcano', Fire: 'Fuego',
  Brewmaster: 'Maestro cervecero', Mistweaver: 'Tejedor de niebla', Windwalker: 'Viajero del viento',
  Holy: 'Sagrado', Protection: 'Protección', Retribution: 'Reprensión',
  Discipline: 'Disciplina', Shadow: 'Sombra',
  Assassination: 'Asesinato', Outlaw: 'Forajido', Subtlety: 'Sutileza',
  Elemental: 'Elemental', Enhancement: 'Mejora',
  Affliction: 'Aflicción', Demonology: 'Demonología', Destruction: 'Destrucción',
  Arms: 'Armas', Fury: 'Furia',
};


const DIFFICULTY = {
  1: { es: 'Buscador de bandas', en: 'LFR' },
  3: { es: 'Normal', en: 'Normal' },
  4: { es: 'Heroico', en: 'Heroic' },
  5: { es: 'Mítico', en: 'Mythic' },
  10: { es: 'Mítica+', en: 'Mythic+' },
};

// Colores oficiales de parse de Warcraft Logs
function parseColor(p) {
  if (p >= 100) return '#e5cc80';
  if (p >= 99) return '#e268a8';
  if (p >= 95) return '#ff8000';
  if (p >= 75) return '#a335ee';
  if (p >= 50) return '#0070ff';
  if (p >= 25) return '#1eff00';
  return '#9d9d9d';
}

const SEGMENT_COLORS = ['#5b8def', '#f0a23b', '#e5566b', '#46c28e', '#a77bf3', '#3cc6d0', '#e47ad1', '#c9d14a'];

// Parche en vivo según la fecha (EU). Añade una línea cuando salga uno nuevo.
// Fuente de las fechas: anuncios de Blizzard (12.1.5 sale el 13/14 de octubre de 2026).
// art: clave de la imagen del parche (la pone el usuario o va en src/patch/<art>.png)
const PATCHES = [
  { v: '12.1', from: '2000-01-01', art: '12.1' },
  { v: '12.1.5', from: '2026-10-14' },
];

// Fecha local (AAAA-MM-DD): el parche cambia a la misma hora que llega a 0 la cuenta atrás
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Arte del parche vigente: el del último parche con imagen que ya haya salido
function patchArtKey(now = new Date()) {
  const day = localDay(now);
  let art = null;
  for (const p of PATCHES) if (p.from <= day && p.art) art = p.art;
  return art || PATCHES[0].art;
}

function currentPatch(now = new Date()) {
  const day = localDay(now);
  let cur = PATCHES[0];
  for (const p of PATCHES) if (p.from <= day) cur = p;
  return cur.v;
}

// Expansión por defecto si todavía no se ha podido leer de la API
const FALLBACK_EXPANSION = { id: 7, name: 'Midnight' };
