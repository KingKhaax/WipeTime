'use strict';

const ICON_BASE = 'https://assets.rpglogs.com/img/warcraft/abilities/';
const SPEC_ICON_BASE = 'https://assets.rpglogs.com/img/warcraft/icons/';
const FALLBACK_ICON = ICON_BASE + 'inv_misc_questionmark.jpg';

// Iconos HD servidos por el programa (paquete Clean Icons, con respaldo al CDN de Warcraft Logs)
const abilityIconUrl = (icon) => (icon ? `wcicon://i/${encodeURIComponent(String(icon).replace(/\.(jpg|png)$/i, ''))}` : FALLBACK_ICON);
const classIconUrl = (cls) => `wcicon://i/${encodeURIComponent('class-' + String(cls).toLowerCase())}`;
const specIconUrl = (icon) => `wcicon://i/${encodeURIComponent('spec-' + icon)}`;

const CLASSES = {
  DeathKnight: { color: '#C41E3A', es: 'Caballero de la Muerte', en: 'Death Knight', de: 'Todesritter', fr: 'Chevalier de la mort' },
  DemonHunter: { color: '#A330C9', es: 'Cazador de demonios', en: 'Demon Hunter', de: 'Dämonenjäger', fr: 'Chasseur de démons' },
  Druid: { color: '#FF7C0A', es: 'Druida', en: 'Druid', de: 'Druide', fr: 'Druide' },
  Evoker: { color: '#33937F', es: 'Evocador', en: 'Evoker', de: 'Rufer', fr: 'Évocateur' },
  Hunter: { color: '#AAD372', es: 'Cazador', en: 'Hunter', de: 'Jäger', fr: 'Chasseur' },
  Mage: { color: '#3FC7EB', es: 'Mago', en: 'Mage', de: 'Magier', fr: 'Mage' },
  Monk: { color: '#00FF98', es: 'Monje', en: 'Monk', de: 'Mönch', fr: 'Moine' },
  Paladin: { color: '#F48CBA', es: 'Paladín', en: 'Paladin', de: 'Paladin', fr: 'Paladin' },
  Priest: { color: '#FFFFFF', es: 'Sacerdote', en: 'Priest', de: 'Priester', fr: 'Prêtre' },
  Rogue: { color: '#FFF468', es: 'Pícaro', en: 'Rogue', de: 'Schurke', fr: 'Voleur' },
  Shaman: { color: '#0070DD', es: 'Chamán', en: 'Shaman', de: 'Schamane', fr: 'Chaman' },
  Warlock: { color: '#8788EE', es: 'Brujo', en: 'Warlock', de: 'Hexenmeister', fr: 'Démoniste' },
  Warrior: { color: '#C69B6D', es: 'Guerrero', en: 'Warrior', de: 'Krieger', fr: 'Guerrier' },
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

const SPECS_DE = { Blood: 'Blut', Frost: 'Frost', Unholy: 'Unheilig', Havoc: 'Verwüstung', Vengeance: 'Rachsucht', Devourer: 'Verschlinger', Balance: 'Gleichgewicht', Feral: 'Wilder Kampf', Guardian: 'Wächter', Restoration: 'Wiederherstellung', Devastation: 'Verheerung', Preservation: 'Bewahrung', Augmentation: 'Verstärkung', BeastMastery: 'Tierherrschaft', Marksmanship: 'Treffsicherheit', Survival: 'Überleben', Arcane: 'Arkan', Fire: 'Feuer', Brewmaster: 'Braumeister', Mistweaver: 'Nebelwirker', Windwalker: 'Windläufer', Holy: 'Heilig', Protection: 'Schutz', Retribution: 'Vergeltung', Discipline: 'Disziplin', Shadow: 'Schatten', Assassination: 'Meucheln', Outlaw: 'Gesetzlosigkeit', Subtlety: 'Täuschung', Elemental: 'Elementar', Enhancement: 'Verstärkung', Affliction: 'Gebrechen', Demonology: 'Dämonologie', Destruction: 'Zerstörung', Arms: 'Waffen', Fury: 'Furor' };
const SPECS_FR = { Blood: 'Sang', Frost: 'Givre', Unholy: 'Impie', Havoc: 'Dévastation', Vengeance: 'Vengeance', Devourer: 'Dévoreur', Balance: 'Équilibre', Feral: 'Farouche', Guardian: 'Gardien', Restoration: 'Restauration', Devastation: 'Dévastation', Preservation: 'Préservation', Augmentation: 'Augmentation', BeastMastery: 'Maîtrise des bêtes', Marksmanship: 'Précision', Survival: 'Survie', Arcane: 'Arcane', Fire: 'Feu', Brewmaster: 'Maître brasseur', Mistweaver: 'Tisserand de brume', Windwalker: 'Marche-vent', Holy: 'Sacré', Protection: 'Protection', Retribution: 'Vindicte', Discipline: 'Discipline', Shadow: 'Ombre', Assassination: 'Assassinat', Outlaw: 'Hors-la-loi', Subtlety: 'Finesse', Elemental: 'Élémentaire', Enhancement: 'Amélioration', Affliction: 'Affliction', Demonology: 'Démonologie', Destruction: 'Destruction', Arms: 'Armes', Fury: 'Fureur' };

const DIFFICULTY = {
  1: { es: 'Buscador de bandas', en: 'LFR', de: 'Raidfinder', fr: 'Recherche de raid' },
  3: { es: 'Normal', en: 'Normal', de: 'Normal', fr: 'Normal' },
  4: { es: 'Heroico', en: 'Heroic', de: 'Heroisch', fr: 'Héroïque' },
  5: { es: 'Mítico', en: 'Mythic', de: 'Mythisch', fr: 'Mythique' },
  10: { es: 'Mítica+', en: 'Mythic+', de: 'Mythisch+', fr: 'Mythique+' },
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

// Arte del parche vigente: el del último parche con imagen que ya haya salido
function patchArtKey(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  let art = null;
  for (const p of PATCHES) if (p.from <= day && p.art) art = p.art;
  return art || PATCHES[0].art;
}

function currentPatch(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  let cur = PATCHES[0];
  for (const p of PATCHES) if (p.from <= day) cur = p;
  return cur.v;
}

// Expansión por defecto si todavía no se ha podido leer de la API
const FALLBACK_EXPANSION = { id: 7, name: 'Midnight' };
