// Major MoP throughput and raid cooldowns, matched by spell name.
// cd is in seconds and deliberately errs long: a value that's too long only makes the "possible uses" count
// lenient, and analysis shortens it to what the player actually achieved if they cast it more often.
// specs: limits the cooldown to those specs (omit for every spec of the class).
// talent: only judged if the player cast it at least once, since we can't see talents.

export const COOLDOWNS = {
  Warrior: [
    { name: 'Recklessness', cd: 180, specs: ['Arms', 'Fury'] },
    { name: 'Skull Banner', cd: 180, specs: ['Arms', 'Fury'] },
    { name: 'Avatar', cd: 180, talent: true },
    { name: 'Bloodbath', cd: 60, talent: true },
    { name: 'Bladestorm', cd: 60, talent: true },
    { name: 'Shield Wall', cd: 300, specs: ['Protection'], kind: 'defensive' },
    { name: 'Last Stand', cd: 180, specs: ['Protection'], kind: 'defensive' },
  ],
  Paladin: [
    { name: 'Avenging Wrath', cd: 180 },
    { name: 'Guardian of Ancient Kings', cd: 300, specs: ['Retribution', 'Protection'] },
    { name: 'Holy Avenger', cd: 120, talent: true },
    { name: 'Divine Plea', cd: 120, specs: ['Holy'] },
    { name: 'Ardent Defender', cd: 180, specs: ['Protection'], kind: 'defensive' },
  ],
  Hunter: [
    { name: 'Rapid Fire', cd: 300 },
    { name: 'Stampede', cd: 300 },
    { name: 'Bestial Wrath', cd: 60, specs: ['BeastMastery'] },
    { name: 'A Murder of Crows', cd: 120, talent: true },
  ],
  Rogue: [
    { name: 'Shadow Blades', cd: 180 },
    { name: 'Vendetta', cd: 120, specs: ['Assassination'] },
    { name: 'Adrenaline Rush', cd: 180, specs: ['Combat'] },
    { name: 'Killing Spree', cd: 120, specs: ['Combat'] },
    { name: 'Shadow Dance', cd: 60, specs: ['Subtlety'] },
  ],
  Priest: [
    { name: 'Shadowfiend', cd: 180, talent: true },
    { name: 'Mindbender', cd: 60, talent: true },
    { name: 'Power Infusion', cd: 120, talent: true },
    { name: 'Pain Suppression', cd: 180, specs: ['Discipline'] },
    { name: 'Power Word: Barrier', cd: 180, specs: ['Discipline'] },
    { name: 'Guardian Spirit', cd: 180, specs: ['Holy'] },
    { name: 'Divine Hymn', cd: 180, specs: ['Holy'] },
  ],
  DeathKnight: [
    { name: 'Pillar of Frost', cd: 60, specs: ['Frost'] },
    { name: 'Empower Rune Weapon', cd: 300, specs: ['Frost', 'Unholy'] },
    { name: 'Summon Gargoyle', cd: 180, specs: ['Unholy'] },
    { name: 'Dancing Rune Weapon', cd: 90, specs: ['Blood'], kind: 'defensive' },
    { name: 'Vampiric Blood', cd: 60, specs: ['Blood'], kind: 'defensive' },
    { name: 'Icebound Fortitude', cd: 180, specs: ['Blood'], kind: 'defensive' },
  ],
  Shaman: [
    { name: 'Ascendance', cd: 180 },
    { name: 'Stormlash Totem', cd: 300 },
    { name: 'Fire Elemental Totem', cd: 300, specs: ['Elemental', 'Enhancement'] },
    { name: 'Feral Spirit', cd: 120, specs: ['Enhancement'] },
    { name: 'Elemental Mastery', cd: 90, talent: true },
    { name: 'Spirit Link Totem', cd: 180, specs: ['Restoration'] },
    { name: 'Healing Tide Totem', cd: 180, specs: ['Restoration'] },
  ],
  Mage: [
    { name: 'Icy Veins', cd: 180, specs: ['Frost'] },
    { name: 'Arcane Power', cd: 90, specs: ['Arcane'] },
    { name: 'Combustion', cd: 45, specs: ['Fire'] },
    { name: 'Mirror Image', cd: 180 },
    { name: 'Alter Time', cd: 180 },
  ],
  Warlock: [
    { name: 'Dark Soul: Misery', cd: 120, specs: ['Affliction'] },
    { name: 'Dark Soul: Knowledge', cd: 120, specs: ['Demonology'] },
    { name: 'Dark Soul: Instability', cd: 120, specs: ['Destruction'] },
    { name: 'Summon Doomguard', cd: 600 },
    { name: 'Grimoire of Service', cd: 120, talent: true },
  ],
  Monk: [
    { name: 'Invoke Xuen, the White Tiger', cd: 180, talent: true },
    { name: 'Energizing Brew', cd: 60, specs: ['Windwalker'] },
    { name: 'Revival', cd: 180, specs: ['Mistweaver'] },
    { name: 'Life Cocoon', cd: 120, specs: ['Mistweaver'] },
    { name: 'Fortifying Brew', cd: 180, specs: ['Brewmaster'], kind: 'defensive' },
  ],
  Druid: [
    { name: 'Incarnation', cd: 180, talent: true, prefix: true },
    { name: 'Celestial Alignment', cd: 180, specs: ['Balance'] },
    { name: 'Berserk', cd: 180, specs: ['Feral', 'Guardian'] },
    { name: 'Tranquility', cd: 480, specs: ['Restoration'] },
    { name: 'Ironbark', cd: 120, specs: ['Restoration'] },
    { name: 'Survival Instincts', cd: 180, specs: ['Guardian'], kind: 'defensive' },
    { name: 'Might of Ursoc', cd: 180, specs: ['Guardian'], kind: 'defensive' },
  ],
};

export const HEALER_SPECS = new Set(['Holy', 'Discipline', 'Restoration', 'Mistweaver']);
export const TANK_SPECS = new Set(['Protection', 'Blood', 'Guardian', 'Brewmaster']);

export function roleOf(className, spec) {
  if (TANK_SPECS.has(spec)) return 'tank';
  // Holy and Restoration are healer specs on every class that has them.
  if (HEALER_SPECS.has(spec)) return 'healer';
  return 'dps';
}

export function cooldownsFor(className, spec) {
  const list = COOLDOWNS[String(className || '').replace(/\s+/g, '')] || [];
  return list.filter((c) => !c.specs || c.specs.includes(spec));
}

export function matchesCooldown(cd, abilityName) {
  return cd.prefix ? abilityName.startsWith(cd.name) : abilityName === cd.name;
}
