// Spec-specific checks, keyed by "Class-Spec" as Warcraft Logs writes it (e.g. "Mage-Frost").
// Each is a list of uptimes the spec is expected to keep, judged against the time the player was alive:
//   { kind: 'buff' | 'debuff', names: [...], label?, target, tip, talent? }
// names: aura names that count (several are combined, e.g. Corruption and Doom); label defaults to the first.
// kind 'buff' is an aura on the player; 'debuff' is one they apply to enemies (time on at least one enemy).
// talent: only judged when the player had it at all, since we can't see talents.
// Uptimes come from the player's Buffs table and their debuff events on enemies (fetchPlayerAuras), matched by name.

const buff = (names, target, tip, extra = {}) => ({ kind: 'buff', names: [].concat(names), target, tip, ...extra });
const debuff = (names, target, tip, extra = {}) => ({ kind: 'debuff', names: [].concat(names), target, tip, ...extra });

const DOT = 'Refresh it before it falls off; in MoP refreshing in the last 30% of its duration loses nothing.';
const MAGE_TALENTS = [
  debuff(['Living Bomb'], 0.85, 'Keep it ticking on the boss.', { talent: true }),
  debuff(['Nether Tempest'], 0.85, 'Keep it ticking on the boss.', { talent: true }),
  buff(['Invocation'], 0.85, 'Re-Evocate as soon as it drops.', { talent: true }),
  buff(['Rune of Power'], 0.85, 'Stand in your rune; place a new one when you have to move.', { talent: true }),
];

export const SPEC_MODULES = {
  'DeathKnight-Blood': [
    buff('Bone Shield', 0.9, 'Recast it as soon as the charges run out.'),
    debuff('Blood Plague', 0.9, 'Keep diseases up with Outbreak and Blood Boil.'),
  ],
  'DeathKnight-Frost': [
    debuff('Frost Fever', 0.95, 'Keep diseases up with Howling Blast and Outbreak.'),
    debuff('Blood Plague', 0.95, 'Keep diseases up with Plague Strike and Outbreak.'),
  ],
  'DeathKnight-Unholy': [
    debuff('Frost Fever', 0.95, 'Keep diseases up; Outbreak and Unholy Blight refresh both.'),
    debuff('Blood Plague', 0.95, 'Keep diseases up; Outbreak and Unholy Blight refresh both.'),
  ],
  'Druid-Balance': [
    debuff('Moonfire', 0.9, DOT),
    debuff('Sunfire', 0.85, 'Apply it in every Solar Eclipse and keep it rolling with Celestial Alignment.'),
  ],
  'Druid-Feral': [
    buff('Savage Roar', 0.95, 'Never let Savage Roar drop.'),
    debuff('Rip', 0.9, 'Refresh Rip with 5 combo points; Ferocious Bite under 25% refreshes it for free.'),
    debuff('Rake', 0.9, DOT),
  ],
  'Druid-Guardian': [
    debuff('Thrash', 0.85, 'Thrash keeps Weakened Blows up and feeds Lacerate procs.'),
    buff('Savage Defense', 0.4, 'Spend rage on Savage Defense to dodge melee hits.'),
  ],
  'Druid-Restoration': [
    buff('Harmony', 0.9, 'A direct heal (Swiftmend, Nourish, Healing Touch) every 20 seconds keeps your mastery up.'),
  ],
  'Hunter-BeastMastery': [debuff('Serpent Sting', 0.95, 'Keep Serpent Sting up; Cobra Shot refreshes it.')],
  'Hunter-Marksmanship': [debuff('Serpent Sting', 0.95, 'Keep Serpent Sting up; Chimera Shot refreshes it.')],
  'Hunter-Survival': [
    debuff('Serpent Sting', 0.95, 'Keep Serpent Sting up; Cobra Shot refreshes it.'),
    debuff('Black Arrow', 0.55, 'Use Black Arrow on cooldown.'),
  ],
  'Mage-Arcane': MAGE_TALENTS,
  'Mage-Fire': [debuff('Pyroblast', 0.6, 'Hot Streak Pyroblasts leave a DoT; keep casting them as they proc.'), ...MAGE_TALENTS],
  'Mage-Frost': MAGE_TALENTS,
  'Monk-Brewmaster': [
    buff('Shuffle', 0.9, 'Blackout Kick for Shuffle comes before everything else that costs Chi.'),
    buff('Tiger Power', 0.85, 'Tiger Palm keeps Tiger Power up.'),
  ],
  'Monk-Windwalker': [
    buff('Tiger Power', 0.95, 'Tiger Palm keeps Tiger Power up.'),
    debuff('Rising Sun Kick', 0.9, 'Rising Sun Kick on cooldown keeps its damage debuff up for the raid.'),
  ],
  'Paladin-Protection': [
    buff('Shield of the Righteous', 0.4, 'Spend Holy Power on Shield of the Righteous during heavy melee.'),
    buff('Sacred Shield', 0.9, 'Keep Sacred Shield up.', { talent: true }),
  ],
  'Paladin-Retribution': [buff('Inquisition', 0.95, 'Refresh Inquisition before it drops; it comes before Templar\'s Verdict.')],
  'Priest-Holy': [buff(['Chakra: Serenity', 'Chakra: Sanctuary'], 0.9, 'Enter a Chakra at the start and stay in it.', { label: 'Chakra' })],
  'Priest-Shadow': [
    debuff('Shadow Word: Pain', 0.95, DOT),
    debuff('Vampiric Touch', 0.95, DOT),
  ],
  'Rogue-Assassination': [
    buff('Slice and Dice', 0.95, 'Envenom refreshes Slice and Dice; don\'t let it drop.'),
    debuff('Rupture', 0.9, 'Refresh Rupture with 4-5 combo points before it falls off.'),
  ],
  'Rogue-Combat': [
    buff('Slice and Dice', 0.95, 'Refresh Slice and Dice before it drops.'),
    debuff('Revealing Strike', 0.9, 'Keep Revealing Strike up so your finishers hit harder.'),
  ],
  'Rogue-Subtlety': [
    buff('Slice and Dice', 0.95, 'Refresh Slice and Dice before it drops.'),
    debuff('Rupture', 0.9, 'Refresh Rupture with 5 combo points before it falls off.'),
    debuff('Hemorrhage', 0.7, 'Hemorrhage when its bleed is about to fall off.'),
  ],
  'Shaman-Elemental': [
    debuff('Flame Shock', 0.95, DOT),
    buff('Lightning Shield', 0.95, 'Keep Lightning Shield up for Fulmination.'),
  ],
  'Shaman-Enhancement': [
    debuff('Flame Shock', 0.85, 'Unleash Elements then Flame Shock when it\'s about to drop.'),
    buff('Lightning Shield', 0.95, 'Keep Lightning Shield up.'),
  ],
  'Shaman-Restoration': [buff('Water Shield', 0.95, 'Keep Water Shield up for mana.')],
  'Warlock-Affliction': [
    debuff('Agony', 0.95, DOT),
    debuff('Corruption', 0.95, DOT),
    debuff('Unstable Affliction', 0.95, DOT),
  ],
  'Warlock-Demonology': [debuff(['Corruption', 'Doom'], 0.9, 'Keep Corruption up out of Metamorphosis and Doom up in it.', { label: 'Corruption / Doom' })],
  'Warlock-Destruction': [debuff('Immolate', 0.9, DOT)],
  'Warrior-Arms': [debuff('Deep Wounds', 0.9, 'Mortal Strike on cooldown keeps Deep Wounds up.')],
  'Warrior-Fury': [
    buff('Enrage', 0.7, 'Bloodthirst crits and Berserker Rage keep you enraged; Raging Blow needs it.'),
    debuff('Deep Wounds', 0.9, 'Bloodthirst on cooldown keeps Deep Wounds up.'),
  ],
  'Warrior-Protection': [
    buff(['Shield Block', 'Shield Barrier'], 0.5, 'Spend rage on Shield Block (or Barrier against magic) during heavy hits.', { label: 'Shield Block / Barrier' }),
    debuff('Deep Wounds', 0.85, 'Devastate keeps Deep Wounds up.'),
  ],
};
