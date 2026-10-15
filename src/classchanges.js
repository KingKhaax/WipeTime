'use strict';

// Cambios de clases en PvE de Midnight, del parche 12.1.0 al 12.1.5.
// Fuentes: notas oficiales de la actualización 12.1.5 y registro oficial de hotfixes de Blizzard (13 de agosto – 14 de octubre de 2026).
// Tipos: b = mejora, n = nerfeo, r = cambio/rediseño, f = corrección. Los nombres de talentos y hechizos se dejan en inglés (nombre oficial).
// Solo PvE; las correcciones sin cifras se resumen en una línea. Blizzard no ha confirmado todavía cambios de clase para el 12.2.
const ClassChanges = (() => {
  const L = tr;
  const LINK = 'https://worldofwarcraft.blizzard.com/en-us/news/24296142';
  const LINK_NOTES = 'https://worldofwarcraft.blizzard.com/en-us/news/24304162';
  const V = '12.1.5';
  const TYPES = { b: ['Mejora', 'Buff'], n: ['Nerfeo', 'Nerf'], r: ['Cambio', 'Change'], f: ['Corrección', 'Fix'] };

  // [fecha, tipo, español, inglés]
  const D = {
    deathknight: { es: 'Caballero de la Muerte', en: 'Death Knight', specs: {
      blood: [
        ['2026-09-09', 'f', 'Grip of the Dead: ya no se queda activo de forma permanente en los objetivos.', 'Grip of the Dead no longer stays permanently active on targets.'],
        ['2026-09-22', 'r', 'Daño de habilidades y esbirros −6 %; Death Strike +15 %; Deadly Reach: daño secundario de Death Strike 60 % (antes 75 %); Exterminate +25 %; Reaper\'s Mark +20 %; Wave of Souls +20 %; Bind in Darkness (Blood Boil) +50 % (antes 30 %); Deathly Blows 20 % (antes 12 %); Swift and Painful Strength 15 % (antes 10 %).', 'All ability and minion damage −6%; Death Strike +15%; Deadly Reach Death Strike secondary damage 60% (was 75%); Exterminate +25%; Reaper\'s Mark +20%; Wave of Souls +20%; Bind in Darkness (Blood Boil) +50% (was 30%); Deathly Blows 20% (was 12%); Swift and Painful Strength 15% (was 10%).'],
        ['2026-08-18', 'n', 'San\'layn — Visceral Strength: fuerza 10 % → 6 %; Transfusion: daño de Dancing Rune Weapon 10 % → 5 %.', 'San\'layn — Visceral Strength: strength 10% → 6%; Transfusion: Dancing Rune Weapon damage 10% → 5%.'],
        ['2026-08-18', 'f', 'Deathbringer — Echoing Fury: las acumulaciones de Exterminate sobre Reaper\'s Mark se aplican bien.', 'Deathbringer — Echoing Fury: Exterminate stacks on Reaper\'s Mark now apply correctly.'],
      ],
      frost: [
        ['2026-09-22', 'b', 'Frostreaper +100 %; Obliterate +10 %.', 'Frostreaper +100%; Obliterate +10%.'],
        ['2026-09-01', 'b', 'Howling Blast (objetivo principal) +15 %; Obliterate +15 %; Frost Strike +20 %; daño cuerpo a cuerpo +10 %.', 'Howling Blast main target +15%; Obliterate +15%; Frost Strike +20%; melee +10%.'],
        ['2026-08-25', 'b', 'Daño de habilidades y cuerpo a cuerpo +6 %; Obliterate +15 %.', 'All ability and melee damage +6%; Obliterate +15%.'],
        ['2026-08-18', 'r', 'Daño de habilidades y auto-ataque +9 %. Venomous Abyss (2 piezas): velocidad de ataque por acumulación 2 % → 1 %; daño de Icy Death Torrent por acumulación 4 % → 2 %.', 'All ability and auto-attack damage +9%. Venomous Abyss 2-piece: attack speed per stack 2% → 1%; Icy Death Torrent damage per stack 4% → 2%.'],
      ],
      unholy: [
        ['2026-09-10', 'f', 'Magus of the Dead: corregida su aparición con diferencias de altura extremas.', 'Magus of the Dead: fixed spawning at extreme vertical differences.'],
        ['2026-08-31', 'f', 'Dread Plague y Virulent Plague Erupt: corregida la interacción con los modificadores de daño indicados.', 'Dread Plague and Virulent Plague Erupt: fixed interaction with the listed damage modifiers.'],
        ['2026-08-25', 'f', 'Unholy Devotion: el aumento de velocidad de ataque ya no reduce también el daño de ataque.', 'Unholy Devotion: the attack speed increase no longer also reduces attack damage.'],
        ['2026-10-06', 'n', 'Blightfall inflige el 100 % del daño restante de la plaga (antes 200 %). Corregido: el daño de Reattribution del Evocador de Aumento ya no se atribuye al caballero de la muerte.', 'Blightfall deals 100% of the remaining plague damage (was 200%). Fixed: Augmentation Evoker Reattribution damage is no longer credited to the Death Knight.'],
        ['2026-09-23', 'f', 'Blightfall ya no hace menos daño cuanto más tiempo lleva la plaga en el objetivo.', 'Blightfall no longer deals less damage the longer the plague has been on the target.'],
        ['2026-09-22', 'b', 'Scourging: umbrales de erupción 65 % / 100 % (antes 50 % / 70 %); Blightfall 200 % (antes 100 %); Infliction of Sorrow: efectividad de la erupción +75 % (antes 30 %); Thrill of Blood: Dread Plague +20 % (antes 10 %); Frenzied Bloodthirst +5 % por acumulación.', 'Scourging erupt thresholds 65% / 100% (was 50% / 70%); Blightfall 200% (was 100%); Infliction of Sorrow erupt effectiveness +75% (was 30%); Thrill of Blood Dread Plague +20% (was 10%); Frenzied Bloodthirst +5% per stack.'],
        ['2026-09-01', 'f', 'Maestría: Dreadblade y Foul Infections: ya aumentan la probabilidad de crítico de los efectos de Plague Erupt.', 'Mastery: Dreadblade and Foul Infections: now increase the critical strike chance of Plague Erupt effects.'],
        ['2026-08-19', 'f', 'Army of the Dead: Epidemic Orders se lanza desde el Lesser Ghoul y no desde el caballero de la muerte. Forbidden Knowledge (rango 4): puede activarse aunque el objetivo de Dread Plague tenga una absorción de daño. Transfusion: ya potencia a los Lesser Ghouls invocados. Lord of the Dead: eliminado el retraso ocasional al lanzarse. Dark Simulacrum: se puede seguir en el Gestor de Recargas.', 'Army of the Dead: Epidemic Orders is now cast from the Lesser Ghoul, not the Death Knight. Forbidden Knowledge (rank 4): can activate when the Dread Plague target has a damage absorb. Transfusion: now empowers summoned Lesser Ghouls. Lord of the Dead: removed the occasional cast delay. Dark Simulacrum: can now be tracked in the Cooldown Manager.'],
      ],
    } },
    demonhunter: { es: 'Cazador de demonios', en: 'Demon Hunter', specs: {
      devourer: [
        ['2026-08-26', 'f', 'Soulburst (2 piezas): corregida la indicación en pantalla.', 'Soulburst (2-piece): display fixed.'],
        [V, 'r', 'Collapsing Star: gana alcance extra tras empezar el lanzamiento; ya no entra en 5 s de reutilización si se cancela; frena el drenaje de Fury (cancelado y relanzado, equivale a ~1,5 lanzamientos completos). Soulforged Blades: crítico de Hungering Slash y Voidblade 15 % → 18 %. Voidpurge: reducción de Void Ray en Void Metamorphosis 2 s → 2,5 s. Muchos talentos cambian de sitio; The Hunt y Eradicate pasan al tramo medio.', 'Collapsing Star: gains extra range after the cast begins; no longer goes on a 5 s cooldown when cancelled; slows Fury drain (cancelled and recast, about 1.5 full casts). Soulforged Blades: Hungering Slash and Voidblade crit chance 15% → 18%. Voidpurge: Void Ray cooldown reduction in Void Metamorphosis 2 s → 2.5 s. Many talents moved; The Hunt and Eradicate moved to the middle gate.'],
        [V, 'r', 'Void-Scarred — Demonic Intensity: Collapsing Star reinicia la recarga de The Hunt y The Hunt potenciada +30 %. Violent Transformation: ahora reinicia Soul Immolation, ya no reinicia The Hunt ni aumenta su daño (antes +25 %). Monster Rising: Intelecto fuera de forma demoníaca 15 % → 10 %; daño de Collapsing Star 15 % → 20 %.', 'Void-Scarred — Demonic Intensity: Collapsing Star resets The Hunt\'s cooldown and empowered The Hunt +30%. Violent Transformation: now resets Soul Immolation, no longer resets The Hunt or increases its damage (was +25%). Monster Rising: Intellect out of demon form 15% → 10%; Collapsing Star damage 15% → 20%.'],
        ['2026-10-06', 'b', 'Consume/Devour +8 %; Reap/Cull +8 %; Eradicate (objetivo principal) +8 %; Collapsing Star (objetivo principal) +8 %; The Hunt (daño inicial) +10 %; Voidblade +10 %.', 'Consume/Devour +8%; Reap/Cull +8%; Eradicate primary target +8%; Collapsing Star primary target +8%; The Hunt initial +10%; Voidblade +10%.'],
        ['2026-09-22', 'b', 'Collapsing Star (objetivo principal) +25 %; Consume/Devour +8 %.', 'Collapsing Star primary target +25%; Consume/Devour +8%.'],
        ['2026-08-18', 'r', 'Daño de habilidades +14 %; Reap/Cull/Eradicate −12 %; Eradicate en área 85 % → 90 %. Venomous Abyss (4 piezas): fragmentos de alma 8 → 2; daño de Reap 20 % → 10 %.', 'All ability damage +14%; Reap/Cull/Eradicate −12%; Eradicate AoE 85% → 90%. Venomous Abyss 4-piece: soul fragments 8 → 2; Reap damage 20% → 10%.'],
      ],
      havoc: [
        ['2026-09-22', 'b', 'Aldrachi Reaver — Art of the Glaive: golpes potenciados 15 % (antes 10 %) y 30 % (antes 20 %); Reaver\'s Glaive +25 %; Reaver\'s Mark 7 % (antes 6 %); Broken Spirit: probabilidad de fragmentar 20 % (antes 15 %).', 'Aldrachi Reaver — Art of the Glaive: enhanced strikes 15% (was 10%) and 30% (was 20%); Reaver\'s Glaive +25%; Reaver\'s Mark 7% (was 6%); Broken Spirit shatter chance 20% (was 15%).'],
        ['2026-09-01', 'b', 'Todo el daño +4 %.', 'All damage +4%.'],
        ['2026-08-25', 'b', 'Todo el daño +3 %.', 'All damage +3%.'],
        ['2026-08-20', 'f', 'Aldrachi Reaver — Evasive Action: corregido el lanzamiento extra de Vengeful Retreat.', 'Aldrachi Reaver — Evasive Action: extra Vengeful Retreat cast fixed.'],
      ],
      vengeance: [
        ['2026-09-22', 'b', 'Aldrachi Reaver — Art of the Glaive: golpes potenciados 15 % y 30 %; Reaver\'s Glaive +25 %; Reaver\'s Mark 8 % (antes 7 %).', 'Aldrachi Reaver — Art of the Glaive: enhanced strikes 15% and 30%; Reaver\'s Glaive +25%; Reaver\'s Mark 8% (was 7%).'],
        ['2026-09-01', 'b', 'Demonic Wards 15 % (antes 12 %); Void Reaver: Frailty 6 % (antes 5 %); curación de Fel Devastation +25 %.', 'Demonic Wards 15% (was 12%); Void Reaver Frailty 6% (was 5%); Fel Devastation healing +25%.'],
        ['2026-08-25', 'b', 'Maestría: Fel Blood, efectividad +24 %.', 'Mastery: Fel Blood effectiveness +24%.'],
      ],
      general: [
        ['2026-08-27', 'f', 'Blur: reducción de daño en PvE restaurada a los valores previstos.', 'Blur: PvE damage reduction restored to intended values.'],
      ],
    } },
    druid: { es: 'Druida', en: 'Druid', specs: {
      balance: [
        ['2026-09-04', 'r', 'Twin Moons: el alcance ahora escala con el radio de combate del objetivo; añadido seguimiento de Stellar Amplification.', 'Twin Moons: range now scales with target combat reach; Stellar Amplification tracking added.'],
        ['2026-09-01', 'b', 'Daño de habilidades +4 %; Shred +10 % (clase).', 'All ability damage +4%; Shred +10% (class).'],
      ],
      feral: [
        ['2026-10-01', 'f', 'Rampant Ferocity: corregido el efecto que saltaba mal contra un solo objetivo.', 'Rampant Ferocity: fixed incorrect triggering on a single target.'],
        ['2026-09-22', 'b', 'Wildstalker — Bursting Growth +15 %; Patient Custodian: daño de sangrado 10 % (antes 8 %).', 'Wildstalker — Bursting Growth +15%; Patient Custodian bleed damage 10% (was 8%).'],
        ['2026-09-02', 'r', 'Unseen Predator (rango 1): prefiere objetivos que no sean inmunes ni reciban menos del 5 % de daño físico.', 'Unseen Predator (rank 1): prefers targets that are not immune or taking less than 5% physical damage.'],
        ['2026-09-01', 'b', 'Daño de habilidades +5 %; auto-ataque +10 %; Ferocious Bite +10 %; Shred +10 %.', 'All ability damage +5%; auto-attack +10%; Ferocious Bite +10%; Shred +10%.'],
      ],
      guardian: [
        ['2026-10-14', 'f', 'Corregidos el coste de maná de Rebirth (forma de oso), el lanzamiento de Heart of the Wild (forma de oso) y la armadura de Persistence.', 'Fixed Rebirth (Bear Form) mana cost, Heart of the Wild (Bear Form) casting and Persistence armor.'],
        ['2026-09-09', 'f', 'Wild Guardian: aumentaba por error el daño de Thrash y Mangle; ahora solo lo hace con el rango 3 elegido.', 'Wild Guardian: it was incorrectly increasing Thrash and Mangle damage; it now only does so with Rank 3 selected.'],
      ],
      restoration: [
        ['2026-08-31', 'f', 'Grove Guardians prioriza los objetivos de Swiftmend/Wild Growth; Everbloom cura a 5 objetivos y no a 6.', 'Grove Guardians now prioritize Swiftmend/Wild Growth targets; Everbloom heals 5 targets instead of 6.'],
        ['2026-08-20', 'f', 'Tranquility: corregido el tooltip de la duración extra de las HoT. Overgrowth (con Soul of the Forest): las HoT se aplican al objetivo correcto.', 'Tranquility: HoT extension duration tooltip fixed. Overgrowth (with Soul of the Forest): HoTs are applied to the correct target.'],
        ['2026-08-19', 'f', 'Rejuvenation ya no se quita antes de tiempo al cambiar la celeridad.', 'Rejuvenation is no longer removed early when haste changes.'],
        [V, 'r', 'Nature\'s Bounty rediseñado: Regrowth cura hasta a 3 aliados con Rejuvenation activa por el 15 % de su curación, priorizando a los de menos vida.', 'Nature\'s Bounty redesigned: Regrowth heals up to 3 allies with Rejuvenation active for 15% of its healing, prioritizing lowest-health allies.'],
        ['2026-10-14', 'f', 'Nature\'s Bounty ya no hace perder Abundance antes de tiempo.', 'Nature\'s Bounty no longer drops Abundance early.'],
        ['2026-09-22', 'b', 'Toda la curación +4 %. Wildstalker — Bursting Growth +15 %.', 'All healing +4%. Wildstalker — Bursting Growth +15%.'],
        ['2026-09-01', 'b', 'Toda la curación +4 %.', 'All healing +4%.'],
        ['2026-08-25', 'r', 'Genesis (4 piezas) duración 8 s (antes 4 s); Rejuvenation y Germination +15 %; Wild Growth +10 %; Nature\'s Bounty replica el 10 % de Regrowth (antes 20 %); Everbloom cura a 5 objetivos (antes 6) con el 48 % de la curación final de Lifebloom (antes 40 %).', 'Genesis 4-piece duration 8 s (was 4 s); Rejuvenation and Germination +15%; Wild Growth +10%; Nature\'s Bounty replicates 10% of Regrowth (was 20%); Everbloom heals 5 targets (was 6) for 48% of Lifebloom\'s final heal (was 40%).'],
        ['2026-08-18', 'b', 'Curación +4 % y daño +20 %.', 'Healing +4% and damage +20%.'],
      ],
    } },
    evoker: { es: 'Evocador', en: 'Evoker', specs: {
      augmentation: [
        [V, 'b', 'Chronowarden: la duración de Temporality y Temporal Burst ahora aumenta con Maestría: Timewalker. Scalecommander: daño de Melt Armor +100 %.', 'Chronowarden: Temporality and Temporal Burst duration now increased by Mastery: Timewalker. Scalecommander: Melt Armor damage +100%.'],
        ['2026-09-22', 'b', 'Eruption +15 %; Fire Breath +60 %; Upheaval +40 %; Blistering Scales +100 %.', 'Eruption +15%; Fire Breath +60%; Upheaval +40%; Blistering Scales +100%.'],
      ],
      devastation: [
        ['2026-09-22', 'b', 'Pyre +10 %; Unbound Flame +25 %; Fire Breath +5 %; Azure Strike +50 %; Azure Sweep +50 %; Shattering Star +10 %.', 'Pyre +10%; Unbound Flame +25%; Fire Breath +5%; Azure Strike +50%; Azure Sweep +50%; Shattering Star +10%.'],
        ['2026-08-14', 'f', 'Shattering Star: ahora se beneficia de Maestría: Giantkiller.', 'Shattering Star: now benefits from Mastery: Giantkiller.'],
      ],
      preservation: [
        [V, 'r', 'Merithra\'s Blessing: duración 1 min → 30 s. Consume Flame ya no se beneficia dos veces de los aumentos de curación del objetivo; Flameshaper: curación de Consume Flame +20 %. Corregidos Double-time (extendía Fire Breath) y Afterimage (Deep Breath lanzaba Living Flame sobre el evocador).', 'Merithra\'s Blessing: duration 1 min → 30 s. Consume Flame no longer double-dips from target healing increases; Flameshaper: Consume Flame healing +20%. Fixed Double-time extending Fire Breath and Afterimage making Deep Breath cast Living Flame on the Evoker.'],
        ['2026-08-25', 'b', 'Verdant Embrace +25 %; Living Flame +20 %; Dream Simulacrum: bonus de Verdant Embrace 40 % (antes 30 %).', 'Verdant Embrace +25%; Living Flame +20%; Dream Simulacrum Verdant Embrace bonus 40% (was 30%).'],
        ['2026-08-27', 'f', 'Flameshaper — Lifecinders: el tooltip decía por error que requería Renewing Blaze. Emerald Communion: el efecto visual ya no se repite al terminar.', 'Flameshaper — Lifecinders: the tooltip incorrectly stated it requires Renewing Blaze. Emerald Communion: the visual no longer loops after the effect ends.'],
      ],
      general: [
        ['2026-09-21', 'f', 'Unravel: ya se activa con Fire Breath lanzado bajo Tip the Scales y alcanza a todos los objetivos de Fire Breath.', 'Unravel: now activates with Fire Breath cast under Tip the Scales and hits all Fire Breath targets.'],
      ],
    } },
    hunter: { es: 'Cazador', en: 'Hunter', specs: {
      beastmastery: [
        ['2026-09-01', 'b', 'Todo el daño +7 %; corregido Wild Thrash.', 'All damage +7%; Wild Thrash fixed.'],
        ['2026-08-25', 'b', 'Wild Thrash: bonus contra 3+ objetivos 300 % (antes 200 %); Beast Cleave: daño de la mascota 70 % (antes 55 %).', 'Wild Thrash: bonus vs. 3+ targets 300% (was 200%); Beast Cleave pet damage 70% (was 55%).'],
        ['2026-08-18', 'b', 'Venomous Abyss (4 piezas): efectividad de Beast Cleave de Cobra Shot 20 % → 30 % por acumulación; daño extra de Cobra Shot 15 % → 20 % por acumulación.', 'Venomous Abyss 4-piece: Cobra Shot Beast Cleave effectiveness 20% → 30% per stack; Cobra Shot bonus damage 15% → 20% per stack.'],
        ['2026-08-17', 'f', 'Wildspeaker: los Kill Commands de Dire Beast ya se benefician de Killer Instinct, Alpha Predator, Specialized Arsenal y Savagery.', 'Wildspeaker: Dire Beast Kill Commands now benefit from Killer Instinct, Alpha Predator, Specialized Arsenal and Savagery.'],
      ],
      marksmanship: [
        ['2026-09-15', 'f', 'Aimed Shot: corregida la animación de lanzamiento con armas de fuego y ballestas.', 'Aimed Shot: cast animation fixed with guns and crossbows.'],
        [V, 'r', 'Unload eliminado. Nuevo talento Blood Fletching: los críticos de Aimed Shot aplican el sangrado de Master Marksman al 20 % del daño y, 4 s después, el objetivo recibe sangrado extra cuando tus habilidades le dañan. Corregidos Explosive Shot (ya no dispara a un objetivo cercano sin objetivo) y Dark Ranger (Bleak Powder genera Trick Shots con 2 objetivos).', 'Unload removed. New talent Blood Fletching: Aimed Shot crits apply the Master Marksman bleed at 20% of damage dealt and, for 4 s, the target takes extra bleed damage when your abilities hit it. Fixed Explosive Shot (no longer fires at a nearby target with no target) and Dark Ranger (Bleak Powder generates Trick Shots on exactly 2 targets).'],
        ['2026-09-22', 'b', 'Trick Shots: rebote 75 % (antes 60 %); Volley +10 %.', 'Trick Shots ricochet 75% (was 60%); Volley +10%.'],
        ['2026-08-20', 'f', 'Precise Shots: ya no se aplica dos veces con Rapid Fire hacia Unload. Explosive Shot: el daño en área ya se reduce con los efectos de reducción de daño recibido.', 'Precise Shots: no longer applied twice from Rapid Fire into Unload. Explosive Shot: AoE damage is now reduced by damage taken reduction effects.'],
        ['2026-08-19', 'f', 'Rapid Fire con Aspect of the Hydra: ya dispara el número previsto de disparos sobre el segundo objetivo.', 'Rapid Fire with Aspect of the Hydra: now fires the intended number of shots on the second target.'],
      ],
      survival: [
        ['2026-09-10', 'f', 'Wildfire Bomb: el daño inicial ya no falla bajo control de masas. Strike as One: Raptor Swipe se beneficia de Tip of the Spear.', 'Wildfire Bomb: initial damage no longer fails under crowd control. Strike as One: Raptor Swipe now benefits from Tip of the Spear.'],
        [V, 'f', 'Strike as One: el daño extra de Raptor Swipe (rango 3) funciona con Aspect of the Eagle y su alcance ya no es mayor del previsto.', 'Strike as One: Raptor Swipe (rank 3) bonus damage now works with Aspect of the Eagle and its range is no longer longer than intended.'],
        ['2026-10-01', 'b', 'Wildfire Bomb: daño periódico +20 % (variante sin talento).', 'Wildfire Bomb periodic damage +20% (untalented variant).'],
        ['2026-09-22', 'r', 'Wildfire Bomb +20 %; bonus del objetivo principal 50 % (antes 80 %).', 'Wildfire Bomb +20%; primary target bonus 50% (was 80%).'],
        ['2026-09-01', 'b', 'Todo el daño +7 %.', 'All damage +7%.'],
        ['2026-08-25', 'b', 'Todo el daño +4 %.', 'All damage +4%.'],
      ],
      general: [
        ['2026-08-18', 'r', 'Las criaturas Hydra, una vez domadas, reducen su tamaño.', 'Hydra creatures are now smaller after taming.'],
      ],
    } },
    mage: { es: 'Mago', en: 'Mage', specs: {
      arcane: [
        [V, 'r', 'Varios hechizos de Arcano añadidos al sistema Spell Density (más opciones de visibilidad para jugadores que no son magos; Blizzard no detalla cuáles). Spellslinger: Splinterstorm se puede seguir en el Gestor de Recargas y ya no se quita al empezar un encuentro de banda o una Mítica+.', 'Several spells added to the Spell Density system (visibility option). Spellslinger: Splinterstorm can be tracked in the Cooldown Manager and is no longer removed at the start of a raid encounter or Mythic+.'],
        ['2026-08-18', 'r', 'Daño de habilidades +3 %. Venomous Abyss: Arcane Missiles (2 piezas) 20 % → 5 %; Cumulative Power (4 piezas) 5 % → 3 % por acumulación.', 'All ability damage +3%. Venomous Abyss: Arcane Missiles 2-piece 20% → 5%; Cumulative Power 4-piece 5% → 3% per stack.'],
      ],
      fire: [
        ['2026-08-31', 'f', 'Flamestrike (2 piezas): ya concede siempre Hot Streak con Pyroclasm.', 'Flamestrike (2-piece): now always grants Hot Streak with Pyroclasm.'],
        ['2026-09-22', 'b', 'Meteor (daño periódico) +100 %; Dualcasting Adept (Flamestrike) 15 % (antes 10 %); Burden of Power (Flamestrike) 6 % (antes 3 %).', 'Meteor DoT +100%; Dualcasting Adept (Flamestrike) 15% (was 10%); Burden of Power (Flamestrike) 6% (was 3%).'],
        ['2026-09-01', 'b', 'Daño de habilidades +3 %.', 'All ability damage +3%.'],
      ],
      frost: [
        [V, 'f', 'Splitting Ice: el modificador se aplica a Frostbolt y el radio del segundo objetivo es el de otros hechizos; corregidas interacciones de Shatter/Fingers of Frost, Thermal Void y Crystalline Refraction. Frostfire: Frostfire Empowerment se aplica al segundo objetivo de Splitting Ice.', 'Splitting Ice: modifier now applies to Frostbolt and the second-target radius matches other spells; fixed Shatter/Fingers of Frost, Thermal Void and Crystalline Refraction interactions. Frostfire: Frostfire Empowerment applies to the second target from Splitting Ice.'],
        ['2026-09-22', 'b', 'Frozen Orb +15 %; Comet Storm +50 %; Frostbite Shatter +10 %; cometa de Glacial Assault +50 %.', 'Frozen Orb +15%; Comet Storm +50%; Frostbite Shatter +10%; Glacial Assault comet +50%.'],
        ['2026-09-01', 'b', 'Daño de habilidades +6 %.', 'All ability damage +6%.'],
        ['2026-08-25', 'b', 'Ice Barrier absorbe el 35 % de la vida máxima (antes 30 %); Blizzard +10 %; Frostbite Shatter +10 %; Frostfire: Meteor (Isothermic Core) +25 %.', 'Ice Barrier absorbs 35% of max health (was 30%); Blizzard +10%; Frostbite Shatter +10%; Frostfire Meteor (Isothermic Core) +25%.'],
      ],
      general: [
        ['2026-09-10', 'f', 'Spellslinger — Augury Abounds: las Splinters ya no golpean a objetivos bajo control de masas.', 'Spellslinger — Augury Abounds: Splinters no longer strike crowd-controlled targets.'],
      ],
    } },
    monk: { es: 'Monje', en: 'Monk', specs: {
      brewmaster: [
        ['2026-10-06', 'b', 'Quick Sip purifica el 8 % del Stagger por cada 3 s (antes 5 %); Pretense of Instability: esquiva 10 % durante 8 s (antes 5 s).', 'Quick Sip purifies 8% of Stagger per 3 s (was 5%); Pretense of Instability: 10% dodge for 8 s (was 5 s).'],
        ['2026-08-25', 'b', 'Todo el daño +3 %; absorción de Celestial Brew y Celestial Infusion +20 %.', 'All damage +3%; Celestial Brew and Celestial Infusion absorb +20%.'],
      ],
      mistweaver: [
        ['2026-08-31', 'f', 'Soothing Mist: ya no cancela por error otra aura.', 'Soothing Mist: no longer rarely cancels the wrong aura.'],
        ['2026-10-06', 'b', 'Invigorating Mists +15 %; Enveloping Mist +15 %.', 'Invigorating Mists +15%; Enveloping Mist +15%.'],
        ['2026-09-22', 'b', 'Toda la curación +5 %; Vivify +15 %; Sheilun\'s Gift +15 %.', 'All healing +5%; Vivify +15%; Sheilun\'s Gift +15%.'],
        ['2026-09-01', 'b', 'Toda la curación +5 %; Venomous Abyss (4 piezas): probabilidad 25 % (antes 20 %).', 'All healing +5%; Venomous Abyss 4-piece proc chance 25% (was 20%).'],
        ['2026-08-18', 'b', 'Toda la curación +8 %; Venomous Abyss (4 piezas): activación +33 %.', 'All healing +8%; Venomous Abyss 4-piece activation rate +33%.'],
      ],
      windwalker: [
        ['2026-09-23', 'f', 'Los ajustes de PvP de Celestial Conduit y Flurry Strikes se aplicaban también en PvE: corregido.', 'PvP adjustments to Celestial Conduit and Flurry Strikes were also applying in PvE: fixed.'],
        ['2026-09-22', 'b', 'Auto-ataque cuerpo a cuerpo +25 %; Dual Threat +20 %; Rising Sun Kick +8 %.', 'Melee auto-attack +25%; Dual Threat +20%; Rising Sun Kick +8%.'],
        ['2026-09-01', 'b', 'Daño de habilidades +4 %.', 'All ability damage +4%.'],
      ],
      general: [
        [V, 'f', 'Transcendence: Transfer ya no se puede usar silenciado con el talento Linked Spirits.', 'Transcendence: Transfer can no longer be used while silenced with Linked Spirits.'],
      ],
    } },
    paladin: { es: 'Paladín', en: 'Paladin', specs: {
      holy: [
        ['2026-09-10', 'f', 'Ringing of the Heavens: ya funciona al lanzarlo como Lightsmith sobre un enemigo.', 'Ringing of the Heavens: now works when cast as Lightsmith on an enemy.'],
      ],
      protection: [
        ['2026-09-15', 'f', 'Consecration: el primer tick ya se beneficia del aumento de crítico del set Venomous Abyss.', 'Consecration: the first tick now benefits from the Venomous Abyss tier crit increase.'],
        ['2026-09-10', 'f', 'Glory of the Vanguard: ya hace todo el daño a su objetivo principal.', 'Glory of the Vanguard: now deals full damage to its primary target.'],
        ['2026-09-09', 'f', 'Glory of the Vanguard: ya daña a objetivos lejanos.', 'Glory of the Vanguard: now damages distant targets.'],
        ['2026-08-27', 'f', 'Blessed Hammer: ya puede golpear a Venomous Heart.', 'Blessed Hammer: can now hit Venomous Heart.'],
        ['2026-08-26', 'f', 'Avenger\'s Shield: ya activa siempre Glory of the Vanguard durante Divine Resonance.', 'Avenger\'s Shield: now always activates Glory of the Vanguard during Divine Resonance.'],
        ['2026-09-22', 'b', 'Daño de todas las habilidades +6 %.', 'All ability damage +6%.'],
        ['2026-09-01', 'b', 'Blaze of Glory +150 %; Consecration +30 %; Divine Guidance +30 %.', 'Blaze of Glory +150%; Consecration +30%; Divine Guidance +30%.'],
      ],
      retribution: [
        ['2026-09-22', 'b', 'Templar — Hammer of Light +50 %; Empyrean Hammer +12 %.', 'Templar — Hammer of Light +50%; Empyrean Hammer +12%.'],
        ['2026-08-25', 'b', 'Divine Arbiter (4 piezas): objetivo principal +150 %; secundarios +75 %.', 'Divine Arbiter 4-piece: main target +150%; secondary targets +75%.'],
        ['2026-08-19', 'f', 'Radiant Glory: Avenging Wrath, tras Wake of Ashes, ya se aplica aunque estés silenciado.', 'Radiant Glory: Avenging Wrath after Wake of Ashes is now applied even while silenced.'],
        ['2026-08-18', 'b', 'Daño de habilidades +6 %.', 'All ability damage +6%.'],
      ],
    } },
    priest: { es: 'Sacerdote', en: 'Priest', specs: {
      discipline: [
        [V, 'n', 'Master the Darkness: duración 1 min → 30 s.', 'Master the Darkness: duration 1 min → 30 s.'],
        ['2026-09-22', 'b', 'Atonement: curación +40 % fuera de bandas y campos de batalla; Penance: coste de maná −20 %.', 'Atonement healing +40% outside raids/battlegrounds; Penance mana cost −20%.'],
        ['2026-09-01', 'b', 'Shadow Mend: coste de maná −20 %.', 'Shadow Mend mana cost −20%.'],
        ['2026-08-18', 'r', 'Todo el daño −30 %. Oracle — Entropic Rift +20 %; Atonement: conversión de daño en curación 32 % → 46 %; Void Shield: reflejo 15 % → 10 %.', 'All damage −30%. Oracle — Entropic Rift +20%; Atonement damage-to-healing 32% → 46%; Void Shield reflect 15% → 10%.'],
      ],
      holy: [
        ['2026-09-15', 'f', 'Renewed Vigor (Venomous Abyss, 2 piezas): ya no supera las 3 acumulaciones.', 'Renewed Vigor (Venomous Abyss 2-piece): no longer exceeds 3 stacks.'],
        ['2026-09-03', 'f', 'Renew (2 piezas): concede Renewed Vigor de forma fiable.', 'Renew (2-piece): now reliably grants Renewed Vigor.'],
        ['2026-08-31', 'f', 'Guardian Angel: reduce correctamente la reutilización de Guardian Spirit cuando se pone sobre un aliado.', 'Guardian Angel: now reduces Guardian Spirit\'s cooldown when placed on an ally.'],
        ['2026-08-26', 'f', 'Divine Hymn ya no pone a Guardian Spirit en 60 s de reutilización con Guardian Angel.', 'Divine Hymn no longer puts Guardian Spirit on a 60-second cooldown with Guardian Angel.'],
        ['2026-08-20', 'f', 'Benediction / Holy Word: un Holy Word en cola ya no consume la probabilidad de activación.', 'Benediction / Holy Word: a queued Holy Word no longer consumes the proc.'],
        ['2026-08-17', 'f', 'Shadow Word: Pain se convierte en Holy Fire tras cambiar de Sombras a Sagrado.', 'Shadow Word: Pain now turns into Holy Fire after swapping from Shadow to Holy.'],
        [V, 'r', 'Holy Celerity y Ultimate Serenity intercambian posición en el árbol; Ultimate Serenity queda antes.', 'Holy Celerity and Ultimate Serenity swap positions in the tree; Ultimate Serenity is now earlier.'],
        ['2026-08-18', 'b', 'Enlightenment: regeneración de maná 10 % → 25 %; Words of the Wise: curación de Serenity y Sanctify 10 % → 40 %; Prompt Prognosis +55 %; Preventive Measures: Prayer of Mending 15 % → 40 %.', 'Enlightenment mana regeneration 10% → 25%; Words of the Wise Serenity and Sanctify healing 10% → 40%; Prompt Prognosis +55%; Preventive Measures Prayer of Mending 15% → 40%.'],
      ],
      shadow: [
        ['2026-09-22', 'r', 'Mind Blast +15 %; Void Blast +15 %; Shadow Word: Death +15 %; Shadow Word: Madness +15 %; Mind Flay +15 %; Mind Flay: Insanity +15 %; Psychic Link 20 % (antes 25 %); Shadeburst −5 %.', 'Mind Blast +15%; Void Blast +15%; Shadow Word: Death +15%; Shadow Word: Madness +15%; Mind Flay +15%; Mind Flay: Insanity +15%; Psychic Link 20% (was 25%); Shadeburst −5%.'],
      ],
      general: [
        ['2026-09-09', 'f', 'Flash Heal se puede seguir en el Gestor de Recargas (Disciplina y Sombras).', 'Flash Heal can now be tracked in the Cooldown Manager (Discipline and Shadow).'],
      ],
    } },
    rogue: { es: 'Pícaro', en: 'Rogue', specs: {
      assassination: [
        ['2026-09-01', 'f', 'Caustic Spatter: ya no se activa con daño de Naturaleza que no es de la clase, como el de los trinkets.', 'Caustic Spatter: no longer triggers from non-class Nature damage sources, such as trinkets.'],
        ['2026-08-18', 'b', 'Todo el daño +4 %.', 'All damage +4%.'],
      ],
      outlaw: [
        [V, 'n', 'Deft Maneuvers: ya no suma 30 de energía al coste de Blade Flurry; ahora suma 5 por objetivo golpeado, hasta 30.', 'Deft Maneuvers: no longer adds 30 Energy to Blade Flurry\'s cost; it now adds 5 per target hit, up to 30.'],
      ],
      subtlety: [
        [V, 'b', 'Daño de todas las habilidades +14 %; corregidos los modificadores de daño de Sombra que se aplicaban mal.', 'All ability damage +14%; fixed Shadow damage modifiers that applied incorrectly.'],
        ['2026-10-06', 'b', 'Trickster — Fazed: +7 % de daño recibido (antes 5 %); Unseen Blade +15 %; Coup de Grace +10 %.', 'Trickster — Fazed: 7% extra damage taken (was 5%); Unseen Blade +15%; Coup de Grace +10%.'],
        ['2026-09-22', 'b', 'Trickster — Unseen Blade +50 %; Coup de Grace +30 %.', 'Trickster — Unseen Blade +50%; Coup de Grace +30%.'],
        ['2026-08-18', 'r', 'Todo el daño +6 %; Venomous Abyss (4 piezas): efectividad 100 % → 60 %. Shadow Dance se cancela al cambiar de talentos y ya no se puede cancelar a mano; Deathstalker — Lingering Darkness se cancela al cambiar de talentos y al empezar un encuentro o Mítica+.', 'All damage +6%; Venomous Abyss 4-piece effectiveness 100% → 60%. Shadow Dance cancels on talent swap and can no longer be cancelled manually; Deathstalker — Lingering Darkness cancels on talent swap and at the start of an encounter or Mythic+.'],
      ],
      general: [
        ['2026-09-10', 'f', 'Las dos versiones de Thistle Tea se pueden seguir en el Gestor de Recargas.', 'Both versions of Thistle Tea can now be tracked in the Cooldown Manager.'],
        ['2026-08-27', 'f', 'Deathstalker: Deathstalker\'s Mark ya no se elimina en objetivos no atacables; en su lugar se concede Darkest Night.', 'Deathstalker: Deathstalker\'s Mark is no longer removed on unattackable targets; Darkest Night is granted instead.'],
      ],
    } },
    shaman: { es: 'Chamán', en: 'Shaman', specs: {
      elemental: [
        ['2026-08-26', 'f', 'Farseer — Maelstrom Supremacy: ahora aumenta la curación de Healing Surge.', 'Farseer — Maelstrom Supremacy: now increases Healing Surge healing.'],
        ['2026-08-18', 'f', 'Overcharge! (Venomous Abyss, 4 piezas): se consume al lanzar un gastador de Maelstrom.', 'Overcharge! (Venomous Abyss 4-piece): is consumed when casting a Maelstrom spender.'],
        ['2026-08-20', 'f', 'Master of the Elements: ahora aumenta el daño de Earthquake.', 'Master of the Elements: now increases Earthquake damage.'],
        ['2026-08-18', 'b', 'Todo el daño +5 %.', 'All damage +5%.'],
      ],
      enhancement: [
        ['2026-09-09', 'f', 'Doom Winds ya no interrumpe canales; Crash Lightning ya no golpea a objetivos de Windfury no previstos.', 'Doom Winds no longer interrupts channels; Crash Lightning no longer hits unintended Windfury targets.'],
        [V, 'f', 'Static Accumulation ya no impide generar acumulaciones de Maelstrom Weapon durante Ascendance o Doom Winds.', 'Static Accumulation no longer stops Maelstrom Weapon stacks from generating during Ascendance or Doom Winds.'],
        ['2026-10-06', 'b', 'Daño de habilidades y auto-ataque +4 %; Lava Lash +35 %.', 'All ability and auto-attack damage +4%; Lava Lash +35%.'],
        ['2026-09-04', 'f', 'Venomous Abyss (4 piezas): ahora aumenta bien el daño inicial de Crash Lightning.', 'Venomous Abyss 4-piece: now properly increases the upfront damage of Crash Lightning.'],
        ['2026-08-18', 'b', 'Todo el daño +5 %.', 'All damage +5%.'],
      ],
      restoration: [
        ['2026-09-10', 'f', 'Soothing Rain: ya reduce 0,5 s el tiempo de lanzamiento de Healing Rain.', 'Soothing Rain: now reduces Healing Rain\'s cast time by 0.5 s.'],
        ['2026-09-03', 'f', 'Totemic — Oversurge: ahora aumenta la curación de Surging Totem y de Overflowing Shores.', 'Totemic — Oversurge: now increases Surging Totem and Overflowing Shores healing.'],
        [V, 'r', 'Riptide (Swelling Tides): al extenderlo se extiende su temporizador en vez de reiniciarse. Nature\'s Swiftness y Ancestral Swiftness hacen instantáneo Healing Rain.', 'Riptide (Swelling Tides): extending it now extends its timer instead of resetting. Nature\'s Swiftness and Ancestral Swiftness make Healing Rain instant.'],
        ['2026-08-19', 'f', 'Totemic — Whirling Water: el efecto ya funciona.', 'Totemic — Whirling Water: the effect now works.'],
      ],
      general: [
        ['2026-08-17', 'f', 'Lava Burst ya no aparece como Primal Strike en el libro de hechizos tras cambiar de especialización.', 'Lava Burst no longer shows as Primal Strike in the spellbook after spec swaps.'],
        ['2026-09-01', 'f', 'Farseer — Natural Harmony: la curación de Nature\'s Guardian pasa del 20 % al 10 % previsto.', 'Farseer — Natural Harmony: Nature\'s Guardian healing 20% → intended 10%.'],
      ],
    } },
    warlock: { es: 'Brujo', en: 'Warlock', specs: {
      affliction: [
        ['2026-08-31', 'f', 'Blackened Soul: ya se activa con Unstable Affliction aplicado mediante Fatal Echoes.', 'Blackened Soul: now activates from Unstable Affliction applied via Fatal Echoes.'],
        ['2026-08-18', 'f', 'Withering Bolt tiene en cuenta Wither. Hellcaller — Blackened Soul funciona con el lanzamiento sobre el ratón.', 'Withering Bolt now accounts for Wither. Hellcaller — Blackened Soul works with mouse-over casting.'],
        ['2026-08-13', 'f', 'Seed of Corruption: consume Shard Instability al lanzarse.', 'Seed of Corruption: consumes Shard Instability on cast.'],
        ['2026-08-25', 'b', 'Unstable Affliction +15 %; Hellcaller — Blackened Soul +20 % y Wither +10 %; Wrath of Nathreza +35 %; Shadow of Nathreza +25 %; Agony +20 %; Corruption +15 %.', 'Unstable Affliction +15%; Hellcaller — Blackened Soul +20% and Wither +10%; Wrath of Nathreza +35%; Shadow of Nathreza +25%; Agony +20%; Corruption +15%.'],
        ['2026-08-20', 'f', 'Hellcaller — Blackened Soul: ya no se activa con el daño periódico de Unstable Affliction. Malefic Grasp: ahora le afecta Withering Bolt. Withering Bolt: tiene en cuenta Wither en el daño de Shadowbolt Volley. Wither: cuenta para el aumento de daño de Darkglare Eye Beam. Venomous Abyss (4 piezas): Unstable Affliction concede una acumulación de Wither.', 'Hellcaller — Blackened Soul: no longer triggers from Unstable Affliction periodic damage. Malefic Grasp: is now affected by Withering Bolt. Withering Bolt: now accounts for Wither in Shadowbolt Volley damage. Wither: now counts toward the Darkglare Eye Beam damage increase. Venomous Abyss 4-piece: Unstable Affliction now grants a stack of Wither.'],
      ],
      demonology: [
        ['2026-08-14', 'f', 'Soul Harvester: Shadow Bolt y Hand of Gul\'dan ya no se desactivan en el Gestor de Recargas.', 'Soul Harvester: Shadow Bolt and Hand of Gul\'dan are no longer disabled in the Cooldown Manager.'],
        ['2026-08-25', 'b', 'Shadow Bolt +35 %; Demonbolt +30 %; Wild Imp +20 %; Summon Felguard +20 %; demonios de Dominion of Argus +20 %; Call Dreadstalkers +30 %.', 'Shadow Bolt +35%; Demonbolt +30%; Wild Imp +20%; Summon Felguard +20%; Dominion of Argus demons +20%; Call Dreadstalkers +30%.'],
        ['2026-08-18', 'r', 'Burning Cleave: de cono a círculo. Venomous Abyss (2 piezas): Implode de Wild Imp 250 % → 350 % al objetivo principal y 225 % → 315 % al resto.', 'Burning Cleave: cone → circle. Venomous Abyss 2-piece: Wild Imp Implode 250% → 350% main target and 225% → 315% other targets.'],
      ],
      destruction: [
        ['2026-08-27', 'f', 'Mayhem: ya no deja de seguirse a veces al refrescarse.', 'Mayhem: no longer sometimes becomes untracked when refreshed.'],
        ['2026-08-17', 'f', 'Shadowburn: el tooltip muestra la duración correcta.', 'Shadowburn: tooltip now shows the correct duration.'],
        ['2026-09-02', 'f', 'Font of Venomous Rage: el canal podía cancelarse al instante si se ponía en cola justo después de Cataclysm.', 'Font of Venomous Rage: the channel could be immediately canceled if spell-queued right after Cataclysm.'],
        ['2026-08-25', 'b', 'Rain of Fire +30 %.', 'Rain of Fire +30%.'],
        ['2026-08-18', 'f', 'Conflagration of Chaos: crítico garantizado de Conflagrate/Shadowburn; debuff de Shadowburn tras dañar al objetivo de Havoc.', 'Conflagration of Chaos: guaranteed Conflagrate/Shadowburn crit; Shadowburn debuff after Havoc target damage.'],
      ],
      general: [
        ['2026-08-14', 'f', 'Soul Leech: las mascotas ya no lo aprenden de forma continua.', 'Soul Leech: pets no longer continually learn it.'],
        ['2026-08-25', 'b', 'Daño de las mascotas (Imp, Voidwalker, Sayaad, Felhunter) +350 %.', 'Pet damage (Imp, Voidwalker, Sayaad, Felhunter) +350%.'],
      ],
    } },
    warrior: { es: 'Guerrero', en: 'Warrior', specs: {
      arms: [
        ['2026-08-14', 'f', 'Slayer — Executioner: corregido el efecto doble (Armas/Furia).', 'Slayer — Executioner: double effect fixed (Arms/Fury).'],
      ],
      fury: [
        ['2026-09-22', 'b', 'Mountain Thane — Lightning Strike +50 %; Ground Current +50 %.', 'Mountain Thane — Lightning Strike +50%; Ground Current +50%.'],
        ['2026-08-18', 'r', 'Todo el daño +6 %. Venomous Abyss (4 piezas): Bloodthirst +10 %; crítico de Recklessness por Bloodthirst 5 % → 3 %; tope 10 % → 6 %.', 'All damage +6%. Venomous Abyss 4-piece: Bloodthirst +10%; Recklessness crit per Bloodthirst 5% → 3%; cap 10% → 6%.'],
      ],
      protection: [
        ['2026-08-18', 'f', 'Mountain Thane — Crashing Thunder: el daño extra de Thunder Clap ya no se desactiva a veces.', 'Mountain Thane — Crashing Thunder: the bonus Thunder Clap damage is no longer sometimes disabled.'],
        [V, 'b', 'Execute +30 %. Colossus — Practiced Strikes: el coste de ira de Execute y Revenge baja 10.', 'Execute +30%. Colossus — Practiced Strikes: Execute and Revenge Rage costs reduced by 10.'],
        ['2026-09-22', 'b', 'Mountain Thane — Lightning Strike +50 %; Ground Current +50 %.', 'Mountain Thane — Lightning Strike +50%; Ground Current +50%.'],
        ['2026-08-25', 'b', 'Fight Through the Flames: reducción de daño mágico 8 % (antes 6 %).', 'Fight Through the Flames: Magic damage reduction 8% (was 6%).'],
      ],
      general: [
        ['2026-09-09', 'f', 'Armas y Protección: corregido el seguimiento de Rend y de los beneficios de set.', 'Arms and Protection: tracking of Rend and set-bonus buffs fixed.'],
        ['2026-09-02', 'r', 'Bladestorm se muestra como aura importante en las placas de nombre.', 'Bladestorm now displays as an important aura on nameplates.'],
        ['2026-08-26', 'f', 'Sudden Death: ya no aumenta por error las reutilizaciones.', 'Sudden Death: no longer incorrectly increases cooldowns.'],
      ],
    } },
  };

  const SPEC_NAMES = {
    blood: ['Sangre', 'Blood'], frost: ['Escarcha', 'Frost'], unholy: ['Profano', 'Unholy'],
    devourer: ['Devorador', 'Devourer'], havoc: ['Caos', 'Havoc'], vengeance: ['Venganza', 'Vengeance'],
    balance: ['Equilibrio', 'Balance'], feral: ['Feral', 'Feral'], guardian: ['Guardián', 'Guardian'], restoration: ['Restauración', 'Restoration'],
    augmentation: ['Aumento', 'Augmentation'], devastation: ['Devastación', 'Devastation'], preservation: ['Preservación', 'Preservation'],
    beastmastery: ['Bestias', 'Beast Mastery'], marksmanship: ['Puntería', 'Marksmanship'], survival: ['Supervivencia', 'Survival'],
    arcane: ['Arcano', 'Arcane'], fire: ['Fuego', 'Fire'],
    brewmaster: ['Maestro cervecero', 'Brewmaster'], mistweaver: ['Tejedor de niebla', 'Mistweaver'], windwalker: ['Viajero del viento', 'Windwalker'],
    holy: ['Sagrado', 'Holy'], protection: ['Protección', 'Protection'], retribution: ['Reprensión', 'Retribution'],
    discipline: ['Disciplina', 'Discipline'], shadow: ['Sombras', 'Shadow'],
    assassination: ['Asesinato', 'Assassination'], outlaw: ['Forajido', 'Outlaw'], subtlety: ['Sutileza', 'Subtlety'],
    elemental: ['Elemental', 'Elemental'], enhancement: ['Mejora', 'Enhancement'],
    affliction: ['Aflicción', 'Affliction'], demonology: ['Demonología', 'Demonology'], destruction: ['Destrucción', 'Destruction'],
    arms: ['Armas', 'Arms'], fury: ['Furia', 'Fury'],
  };
  // La paleta de cada clase es la oficial de WoW
  const ORDER = ['deathknight', 'demonhunter', 'druid', 'evoker', 'hunter', 'mage', 'monk', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'];
  const COLORS = { deathknight: '#C41E3A', demonhunter: '#A330C9', druid: '#FF7C0A', evoker: '#33937F', hunter: '#AAD372', mage: '#3FC7EB', monk: '#00FF98', paladin: '#F48CBA', priest: '#FFFFFF', rogue: '#FFF468', shaman: '#0070DD', warlock: '#8788EE', warrior: '#C69B6D' };

  // Las notas del 12.1.5 se publicaron el 13 de octubre de 2026 (EE. UU.; en Europa entraron el 14)
  const NOTES_DATE = '2026-10-13';
  const SIGNS = { up: ['Mejora', 'Buff'], down: ['Nerfeo', 'Nerf'], mid: ['Cambio', 'Change'], fix: ['Corrección', 'Fix'] };
  const num = (s, unit) => { const n = parseFloat(String(s).replace(',', '.')); return unit === 'min' ? n * 60 : n; };
  // Signo de un cambio: números «a → b» y «b (antes a)» primero, luego +N % / −N %, y si no el tipo de la entrada
  function signOf(seg, type) {
    if (type === 'f' || /^(corregid[oa]s?|fix(ed)?)/i.test(seg.trim())) return 'fix';
    const inv = /coste|cost\b|cost /i.test(seg);
    const flip = (up) => (inv ? !up : up);
    let m = seg.match(/([\d.,]+)\s*(%|s|min)?\s*→\s*([\d.,]+)\s*(%|s|min)?/);
    if (m) { const a = num(m[1], m[2]); const b = num(m[3], m[4] || m[2]); if (a !== b) return flip(b > a) ? 'up' : 'down'; }
    m = seg.match(/([\d.,]+)\s*(%|s|min)?\s*\((?:antes|was)\s*([\d.,]+)\s*(%|s|min)?/);
    if (m) { const b = num(m[1], m[2]); const a = num(m[3], m[4] || m[2]); if (a !== b) return flip(b > a) ? 'up' : 'down'; }
    m = seg.match(/(\+|−|-)\s*[\d.,]+\s*%/);
    if (m) return flip(m[1] === '+') ? 'up' : 'down';
    return type === 'b' ? 'up' : type === 'n' ? 'down' : 'mid';
  }
  const fmtDate = (d) => new Date(`${d === V ? NOTES_DATE : d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) + (d === V ? ` · ${L('parche', 'patch')} 12.1.5` : '');
  const count = (k) => Object.values(D[k].specs).reduce((a, s) => a + s.length, 0);
  const dkey = (d) => (d === V ? NOTES_DATE : d);
  const sortRows = (rows) => rows.slice().sort((a, b) => (dkey(a[0]) < dkey(b[0]) ? 1 : dkey(a[0]) > dkey(b[0]) ? -1 : 0));
  const cls = (k) => L(D[k].es, D[k].en);
  let cur = 'deathknight';

  function homeHTML() {
    return `<button type="button" class="pn-btn cc-btn" data-cc="deathknight"><span class="cc-btn-ic"><img src="${classIconUrl('warrior')}" alt=""><img src="${classIconUrl('mage')}" alt=""><img src="${classIconUrl('rogue')}" alt=""></span><span class="cc-btn-t">${L('Cambios de clase', 'Class changes')}<small>${L('PvE · 12.1.0 a 12.1.5', 'PvE · 12.1.0 to 12.1.5')}</small></span></button>`;
  }

  // Nombres de habilidades en el idioma de la app, cada uno con su tooltip (data-spell → SpellTip)
  const NAMES = typeof CLASS_SPELLS !== 'undefined' ? CLASS_SPELLS : {};
  const NAME_RE = (() => {
    const keys = Object.keys(NAMES).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return keys.length ? new RegExp(`(?<![\\w'’-])(${keys.join('|')})(?![\\w'’-])`, 'g') : null;
  })();
  const spanish = () => L('es', 'en') === 'es';
  function linkNames(raw) {
    if (!NAME_RE) return esc(raw);
    let out = '';
    let last = 0;
    for (const m of raw.matchAll(NAME_RE)) {
      const [id, es] = NAMES[m[1]];
      const label = esc(spanish() ? es : m[1]);
      // id 0 = nombre traducido sin tooltip (árboles de héroe, banda, hechizos sin descripción)
      out += esc(raw.slice(last, m.index)) + (id ? `<span class="cc-sp" data-spell="${id}">${label}</span>` : `<span class="cc-nm">${label}</span>`);
      last = m.index + m[0].length;
    }
    return out + esc(raw.slice(last));
  }

  function specBlock(k, sk) {
    const rows = sortRows(D[k].specs[sk] || []);
    const isGeneral = sk === 'general';
    const name = isGeneral ? L('General de la clase', 'Class-wide') : L(...SPEC_NAMES[sk]);
    const icon = isGeneral ? classIconUrl(k) : `specs/${k}-${sk}.png`;
    // un bloque por fecha exacta; cada cambio en su línea: verde si mejora, rojo si empeora, ámbar si es un cambio sin signo, gris si es una corrección
    let body = '';
    let last = null;
    for (const [d, t, es, en] of rows) {
      if (d !== last) { body += `<li class="cc-day"><b>${esc(fmtDate(d))}</b></li>`; last = d; }
      for (const seg of String(L(es, en)).split(/; |\. (?=[A-ZÁÉÍÓÚ])/)) {
        const s = signOf(seg, t);
        body += `<li class="cc-row s-${s}"><span class="cc-type">${L(...SIGNS[s])}</span><span class="cc-txt">${linkNames(seg.replace(/\.$/, ''))}</span></li>`;
      }
    }
    if (!rows.length) body = `<li class="cc-none">${L('Sin cambios de PvE registrados en este periodo.', 'No PvE changes recorded in this period.')}</li>`;
    // Cerrado por defecto: se despliega al pulsar la cabecera de la spec
    return `<article class="cc-spec" style="--cc:${COLORS[k]}"><button type="button" class="cc-spec-h" data-cc-toggle aria-expanded="false"><img src="${icon}" width="30" height="30" alt=""><span class="cc-spec-n">${esc(name)}</span><small>${rows.length}</small><span class="cc-chev" aria-hidden="true"></span></button><ul class="cc-list" hidden>${body}</ul></article>`;
  }

  function render(dlg) {
    const k = cur;
    const nav = ORDER.map((c) => `<button type="button" class="cc-nav ${c === k ? 'on' : ''}" style="--cc:${COLORS[c]}" data-cc-nav="${c}" title="${esc(cls(c))}"><img src="${classIconUrl(c)}" width="28" height="28" alt=""><span>${esc(cls(c))}</span></button>`).join('');
    const keys = Object.keys(D[k].specs).filter((s) => s !== 'general');
    if (D[k].specs.general) keys.push('general');
    dlg.innerHTML = `<div class="cc-wrap"><aside class="cc-side"><h2>${L('Cambios de las clases', 'Class changes')}</h2>${nav}</aside>
      <div class="cc-main"><div class="cc-top"><img src="${classIconUrl(k)}" width="44" height="44" alt=""><div><h3 style="color:${COLORS[k]}">${esc(cls(k))}</h3>
        <small>${L('PvE · parches 12.1.0 a 12.1.5', 'PvE · patches 12.1.0 to 12.1.5')}</small></div><span class="grow"></span>
        <button type="button" class="btn ghost" data-cc-close>${L('Cerrar', 'Close')}</button></div>
        <div class="cc-body">${keys.map((s) => specBlock(k, s)).join('')}
          <p class="foot">${L('Solo PvE. Las correcciones sin cifras se resumen. Cambios confirmados para el 12.2: Blizzard aún no ha publicado ninguno.', 'PvE only. Fixes without numbers are summarized. Confirmed changes for 12.2: Blizzard has not published any yet.')}</p>
          <p class="foot"><a href="#" data-cc-link="${LINK_NOTES}">${L('Notas oficiales del 12.1.5', 'Official 12.1.5 notes')}</a> · <a href="#" data-cc-link="${LINK}">${L('Registro oficial de hotfixes', 'Official hotfix log')}</a></p></div></div></div>`;
    dlg.querySelector('.cc-body')?.scrollTo(0, 0);
  }

  function open(k) {
    if (k && D[k]) cur = k;
    let dlg = document.getElementById('classChangesDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'classChangesDlg';
      dlg.className = 'modal wide cc-dlg';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (ev) => {
        const nav = ev.target.closest('[data-cc-nav]');
        if (nav) { cur = nav.dataset.ccNav; render(dlg); return; }
        const tg = ev.target.closest('[data-cc-toggle]');
        if (tg) {
          const art = tg.closest('.cc-spec');
          const open = !art.classList.contains('open');
          art.classList.toggle('open', open);
          tg.setAttribute('aria-expanded', String(open));
          art.querySelector('.cc-list').hidden = !open;
          if (open) art.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        const link = ev.target.closest('[data-cc-link]');
        if (link) { ev.preventDefault(); window.api.openExternal(link.dataset.ccLink); return; }
        if (ev.target.closest('[data-cc-close]') || ev.target === dlg) dlg.close();
      });
    }
    render(dlg);
    if (!dlg.open) dlg.showModal();
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cc]');
    if (b) open(b.dataset.cc);
  });

  return { homeHTML, open, D };
})();
