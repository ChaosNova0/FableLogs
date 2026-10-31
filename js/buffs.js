// MoP raid buff and debuff coverage. Buffs come from each player's auras at the pull (CombatantInfo); debuffs from
// the uptime of debuffs on enemies over the pull. Matching is by name or spell id: Warcraft Logs shows some MoP Classic
// auras under other names (Weakened Armor as "Mystic Touch", Curse of the Elements as "Chaos Brand", the mage buff as
// "Arcane Intellect"), so the ids seen in real logs are listed too.
// from: classes (or "Class-Spec") that can provide it. Hunters can cover most buffs with the right pet.

export const RAID_BUFFS = [
  { key: 'stats', label: '5% stats', names: ['Mark of the Wild', 'Blessing of Kings', 'Legacy of the Emperor', 'Embrace of the Shale Spider'], ids: [1126, 117666], from: ['Druid', 'Paladin', 'Monk'], pet: true },
  { key: 'stamina', label: '10% stamina', names: ['Power Word: Fortitude', 'Commanding Shout', 'Blood Pact', 'Qiraji Fortitude'], ids: [21562], from: ['Priest', 'Warrior', 'Warlock'], pet: true },
  { key: 'ap', label: '10% attack power', names: ['Horn of Winter', 'Trueshot Aura', 'Battle Shout'], ids: [57330, 19506, 6673], from: ['DeathKnight', 'Hunter', 'Warrior'] },
  { key: 'sp', label: '10% spell power', names: ['Arcane Brilliance', 'Arcane Intellect', 'Dalaran Brilliance', 'Dalaran Intellect', 'Dark Intent', 'Burning Wrath', 'Still Water'], ids: [1459, 77747], from: ['Mage', 'Warlock', 'Shaman'], pet: true },
  { key: 'haste', label: '10% melee & ranged haste', names: ['Unholy Aura', "Swiftblade's Cunning", 'Unleashed Rage', 'Cackling Howl', "Serpent's Swiftness"], ids: [55610, 113742, 128432], from: ['DeathKnight-Frost', 'DeathKnight-Unholy', 'Rogue', 'Shaman-Enhancement'], pet: true },
  { key: 'spellHaste', label: '5% spell haste', names: ['Moonkin Aura', 'Shadowform', 'Elemental Oath', 'Mind Quickening'], ids: [51470, 49868], from: ['Druid-Balance', 'Priest-Shadow', 'Shaman-Elemental'], pet: true },
  { key: 'crit', label: '5% critical strike', names: ['Leader of the Pack', 'Arcane Brilliance', 'Arcane Intellect', 'Dalaran Brilliance', 'Dalaran Intellect', 'Legacy of the White Tiger', 'Bellowing Roar', 'Furious Howl', 'Terrifying Roar', 'Fearless Roar', 'Still Water'], ids: [1459, 116781], from: ['Druid-Feral', 'Druid-Guardian', 'Mage', 'Monk-Windwalker'], pet: true },
  { key: 'mastery', label: 'Mastery', names: ['Blessing of Might', 'Grace of Air', 'Roar of Courage', 'Spirit Beast Blessing'], ids: [19740, 116956], from: ['Paladin', 'Shaman'], pet: true },
];

export const RAID_DEBUFFS = [
  { key: 'armor', label: 'Weakened Armor (−12% armor)', names: ['Weakened Armor', 'Mystic Touch'], ids: [113746], from: ['Warrior', 'Druid', 'Rogue'], target: 0.95, tip: 'Sunder Armor, Faerie Fire or Expose Armor: a tank or melee should keep 3 stacks up.' },
  { key: 'physical', label: 'Physical Vulnerability (+4% physical damage)', names: ['Physical Vulnerability'], ids: [81326], from: ['Warrior', 'DeathKnight', 'Paladin-Retribution'], target: 0.9, tip: 'Colossus Smash, Brittle Bones or Judgments of the Bold.' },
  { key: 'magic', label: 'Magic vulnerability (+5% spell damage)', names: ['Curse of the Elements', 'Chaos Brand', 'Master Poisoner', 'Fire Breath', 'Lightning Breath'], ids: [1490, 93068], from: ['Warlock', 'Rogue'], target: 0.9, tip: 'Curse of the Elements or Master Poisoner.' },
  { key: 'blows', label: 'Weakened Blows (−10% damage done)', names: ['Weakened Blows'], ids: [115798], from: ['Warrior', 'DeathKnight', 'Druid', 'Paladin', 'Monk-Brewmaster', 'Shaman'], target: 0.9, tip: 'Usually the tanks\' job: Thunder Clap, Scarlet Fever, Thrash, Keg Smash or Hammer of the Righteous.' },
];

const auraName = (a, lk) => a.name || lk.abilities.get(a.ability)?.name || '';
const matches = (entry, id, name) => (entry.ids || []).includes(id) || entry.names.includes(name);

// Can anyone in this raid provide it? classSpecs: ["Druid-Balance", ...] for the players in the pull.
function providers(entry, classSpecs) {
  const who = classSpecs.filter((cs) => entry.from.some((f) => (f.includes('-') ? cs === f : cs.split('-')[0] === f)));
  const hunter = entry.pet && classSpecs.some((cs) => cs.startsWith('Hunter'));
  return { who, hunter };
}

/**
 * Raid buffs at the pull.
 * @param pids        players in the pull
 * @param combatants  CombatantInfo events for the pull
 * @param classSpecs  ["Class-Spec"] for those players (spec may be missing: "Class-")
 * Returns null without combatant info; else [{ key, label, have, total, pct, providers, canProvide, hunter }].
 */
export function buffCoverage(pids, combatants, lk, classSpecs) {
  const infos = pids.map((pid) => combatants.find((c) => c.sourceID === pid)).filter(Boolean);
  if (!infos.length) return null;
  return RAID_BUFFS.map((b) => {
    const have = infos.filter((c) => (c.auras || []).some((a) => matches(b, a.ability, auraName(a, lk)))).length;
    const { who, hunter } = providers(b, classSpecs);
    return { key: b.key, label: b.label, have, total: infos.length, pct: have / infos.length, canProvide: who.length > 0, hunter };
  });
}

/**
 * Raid debuffs on enemies over the pull, from a Debuffs table (hostilityType Enemies).
 * Uptime is the longest single debuff's uptime in each group, capped at 100% (several enemies can stack it up).
 */
export function debuffCoverage(table, fight, lk, classSpecs) {
  const auras = table?.auras || table?.data?.auras || [];
  if (!table) return null;
  const duration = Math.max(1, fight.endTime - fight.startTime);
  return RAID_DEBUFFS.map((d) => {
    const found = auras.filter((a) => matches(d, a.guid, a.name || lk.abilities.get(a.guid)?.name));
    const uptime = found.length ? Math.min(1, Math.max(...found.map((a) => (a.totalUptime || 0) / duration))) : 0;
    const { who, hunter } = providers(d, classSpecs);
    return { key: d.key, label: d.label, tip: d.tip, target: d.target, uptime, canProvide: who.length > 0, hunter };
  });
}

// Buff coverage across a night: per buff, how many pulls had it on everyone. pulls: [{ fight, coverage }].
export function nightBuffCoverage(pulls) {
  const withInfo = pulls.filter((p) => p.coverage);
  if (!withInfo.length) return null;
  return RAID_BUFFS.map((b) => {
    const rows = withInfo.map((p) => p.coverage.find((c) => c.key === b.key));
    const full = rows.filter((c) => c.pct >= 1).length;
    const missing = withInfo.filter((p, i) => rows[i].have === 0).map((p) => p.fight);
    return {
      key: b.key, label: b.label, full, pulls: withInfo.length, missing,
      avg: rows.reduce((t, c) => t + c.pct, 0) / rows.length,
      canProvide: rows.some((c) => c.canProvide), hunter: rows.some((c) => c.hunter),
    };
  });
}
