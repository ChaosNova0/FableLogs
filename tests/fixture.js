// A fake 10-player MoP raid night, served by a stubbed fetch so the UI can be previewed without an API client.
// Only used by tests/preview.html.

const PLAYERS = [
  [1, 'Bulwark', 'Warrior', 'Protection'], [2, 'Ursoc', 'Druid', 'Guardian'],
  [3, 'Lumen', 'Priest', 'Holy'], [4, 'Mistral', 'Monk', 'Mistweaver'], [5, 'Tidecall', 'Shaman', 'Restoration'],
  [6, 'Frostbyte', 'Mage', 'Frost'], [7, 'Shank', 'Rogue', 'Combat'], [8, 'Quiver', 'Hunter', 'BeastMastery'],
  [9, 'Hexxa', 'Warlock', 'Destruction'], [10, 'Rimeheart', 'DeathKnight', 'Frost'],
];
const ROLE = { Protection: 'tank', Guardian: 'tank', Holy: 'healer', Mistweaver: 'healer', Restoration: 'healer' };
const ids = PLAYERS.map((p) => p[0]);

const ABILITIES = [
  [1, 'Melee', 'ability_meleedamage.jpg'], [116, 'Frostbolt', 'spell_frost_frostbolt02.jpg'],
  [12472, 'Icy Veins', 'spell_frost_coldhearted.jpg'], [55342, 'Mirror Image', 'spell_magic_lesserinvisibilty.jpg'],
  [116281, 'Cobalt Mine', 'inv_misc_gem_sapphire_01.jpg'], [130395, 'Jasper Chains', 'ability_warlock_fireandbrimstone.jpg'],
  [115861, 'Overload', 'spell_shadow_unholyfrenzy.jpg'], [116157, 'Lightning Fists', 'ability_monk_flyingdragonkick.jpg'],
  [116784, 'Wildfire Spark', 'spell_fire_felflamering.jpg'], [117558, 'Voodoo Doll', 'inv_misc_voodoodoll.jpg'],
  [116161, 'Crossed Over', 'spell_shadow_soulgem.jpg'], [2061, 'Flash Heal', 'spell_holy_flashheal.jpg'],
  [105691, 'Flask of the Warm Sun', 'trade_alchemy_potione6.jpg'], [104277, 'Well Fed', 'spell_misc_food.jpg'],
  [105702, 'Potion of the Jade Serpent', 'trade_alchemy_potiond4.jpg'], [1766, 'Kick', 'ability_kick.jpg'],
  [116835, 'Arcane Resonance', 'spell_arcane_arcane04.jpg'], [3, 'Falling', 'ability_rogue_quickrecovery.jpg'],
  [122336, 'Sonic Ring', 'spell_nature_cyclone.jpg'], [1126, 'Mark of the Wild', 'spell_nature_regeneration.jpg'],
  [21562, 'Power Word: Fortitude', 'spell_holy_wordfortitude.jpg'], [6673, 'Battle Shout', 'ability_warrior_battleshout.jpg'],
  [1459, 'Arcane Brilliance', 'spell_holy_magicalsentry.jpg'], [113742, "Swiftblade's Cunning", 'ability_rogue_slicedice.jpg'],
  [116956, 'Grace of Air', 'spell_nature_windfury.jpg'], [114239, 'Nether Tempest', 'spell_mage_nethertempest.jpg'],
  [116257, 'Invocation', 'spell_arcane_arcane03.jpg'], [113746, 'Weakened Armor', 'ability_warrior_sunder.jpg'],
  [81326, 'Physical Vulnerability', 'ability_warrior_colossussmash.jpg'], [115798, 'Weakened Blows', 'ability_warrior_thunderclap.jpg'],
];

const BOSSES = {
  1395: ['The Stone Guard', 100], 1390: ['Feng the Accursed', 101], 1434: ["Gara'jal the Spiritbinder", 102],
  1507: ["Imperial Vizier Zor'lok", 103],
};
const MSV = { id: 1008, name: "Mogu'shan Vaults" };
const HOF = { id: 1009, name: 'Heart of Fear' };
const ZONE_OF = { 1395: MSV, 1390: MSV, 1434: MSV, 1507: HOF };

// [encounterID, kill, durationSec, bossPct]. The last pull is in a second raid, to show raid grouping.
const PULLS = [[1395, false, 192, 41.2], [1395, false, 245, 12.8], [1395, true, 301, 0], [1390, false, 160, 55], [1390, true, 352, 0], [1434, false, 210, 22.4], [1434, false, 277, 6.1], [1507, true, 330, 0]];
let t = 60_000;
const FIGHTS = PULLS.map(([enc, kill, dur, pct], i) => {
  const f = { id: i + 1, encounterID: enc, name: BOSSES[enc][0], kill, startTime: t, endTime: t + dur * 1000, size: 10, difficulty: 3,
    bossPercentage: pct, fightPercentage: pct, friendlyPlayers: ids };
  t += dur * 1000 + 120_000;
  return f;
});

// Deaths per fight: [playerId, secondsIn, abilityId, pattern]
const DEATHS = {
  1: [[7, 41, 116281, 'spike'], [9, 63, 130395, 'attrition'], [6, 70, 115861, 'burst'], [1, 150, 1, 'tank'], [3, 160, 115861, 'burst'], [8, 165, 115861, 'burst'], [10, 170, 1, 'burst']],
  2: [[9, 88, 3, 'fall'], [2, 200, 1, 'tank'], [5, 210, 115861, 'burst'], [6, 215, 115861, 'burst'], [7, 220, 130395, 'attrition']],
  3: [[8, 140, 116281, 'spike']],
  4: [[6, 30, 116784, 'spike'], [7, 95, 116157, 'burst'], [3, 120, 116835, 'attrition'], [1, 130, 1, 'tank'], [4, 140, 116157, 'burst'], [9, 150, 116157, 'burst']],
  6: [[10, 55, 116161, 'attrition'], [7, 80, 117558, 'spike'], [5, 160, 1, 'burst'], [9, 170, 117558, 'burst'], [6, 180, 117558, 'burst'], [1, 195, 1, 'tank']],
  7: [[7, 200, 117558, 'burst'], [6, 230, 117558, 'burst'], [3, 245, 117558, 'burst'], [9, 255, 117558, 'burst'], [10, 262, 1, 'burst'], [2, 270, 1, 'tank']],
};

const boss = (f) => BOSSES[f.encounterID][1];
const deathEvents = [];
const windowEvents = {};
for (const f of FIGHTS) {
  windowEvents[f.id] = [];
  for (const [pid, sec, ab, pattern] of DEATHS[f.id] || []) {
    const ts = f.startTime + sec * 1000;
    deathEvents.push({ timestamp: ts, type: 'death', sourceID: -1, targetID: pid, fight: f.id, killerID: boss(f), killingAbilityGameID: ab });
    const W = windowEvents[f.id];
    const hit = (dt, ability, amount, extra = {}) => W.push({ timestamp: ts - dt, type: 'damage', sourceID: ability === 3 ? -1 : boss(f), targetID: pid,
      abilityGameID: ability, amount, fight: f.id, maxHitPoints: 450_000, resourceActor: 2, ...extra });
    if (pattern === 'spike') { hit(6000, 1, 20_000, { hitPoints: 430_000 }); hit(0, ab, 520_000, { overkill: 90_000, hitPoints: 0 }); }
    if (pattern === 'fall') hit(0, 3, 600_000, { overkill: 150_000, hitPoints: 0 });
    if (pattern === 'attrition') for (let k = 9; k >= 0; k--) hit(k * 1000, ab, 46_000, { overkill: k === 0 ? 4000 : 0, hitPoints: Math.max(0, 450_000 - (10 - k) * 46_000) });
    if (pattern === 'burst') { hit(8000, 1, 30_000); hit(2000, ab, 180_000); hit(1000, ab, 160_000); hit(0, ab, 150_000, { overkill: 40_000, hitPoints: 0 }); }
    if (pattern === 'tank') for (let k = 7; k >= 0; k--) hit(k * 900, 1, 70_000, { overkill: k === 0 ? 12_000 : 0 });
    if (pattern !== 'burst' && pattern !== 'tank') W.push({ timestamp: ts - 7000, type: 'heal', sourceID: 3, targetID: pid, abilityGameID: 2061, amount: 60_000, fight: f.id });
  }
}

const gear = (pid, missing = []) => Array.from({ length: 19 }, (_, slot) => {
  if (slot === 3 || slot === 17 || slot === 18 || (slot === 16 && [6, 9, 10].includes(pid))) return { id: 0, slot };
  return { id: 86000 + slot * 10 + pid, slot, quality: slot === 1 && pid === 8 ? 3 : 4, icon: 'inv_helmet_96.jpg',
    itemLevel: 489 + ((pid * 7 + slot * 3) % 14), permanentEnchant: missing.includes(slot) ? 0 : 4400 + slot, gems: [{ id: 76884, itemLevel: 1 }] };
});
const MISSING = { 7: [6, 7], 9: [14] };
const combatants = FIGHTS.flatMap((f) => ids.map((pid) => ({
  timestamp: f.startTime, type: 'combatantinfo', sourceID: pid, fight: f.id, gear: gear(pid, MISSING[pid]),
  auras: [
    ...((pid === 9 && f.id > 3) || (pid === 7 && f.id % 2) ? [] : [{ source: pid, ability: 105691, stacks: 1 }]),
    ...(pid === 10 && f.id === 6 ? [] : [{ source: pid, ability: 104277, stacks: 1 }]),
    // Raid buffs. Nobody brings spell haste; Shank missed Mark of the Wild on the first pull.
    ...[[1126, 2], [21562, 3], [6673, 1], [1459, 6], [113742, 7], [116956, 5]].filter(([ab]) => !(ab === 1126 && pid === 7 && f.id === 1))
      .map(([ability, source]) => ({ source, ability, stacks: 1 })),
  ],
})));
const potions = FIGHTS.flatMap((f) => ids.filter((pid) => pid !== 9 && !ROLE[PLAYERS[pid - 1][3]]).flatMap((pid) => [
  { timestamp: f.startTime - 1000, type: 'cast', sourceID: pid, fight: f.id, abilityGameID: 105702 },
  ...(f.kill ? [{ timestamp: f.startTime + 40_000, type: 'cast', sourceID: pid, fight: f.id, abilityGameID: 105702 }] : []),
]));

function table(f, kind) {
  const secs = f ? (f.endTime - f.startTime) / 1000 : 1800;
  return {
    totalTime: secs * 1000,
    entries: PLAYERS.filter(([, , , spec]) => (kind === 'heal' ? ROLE[spec] === 'healer' || spec === 'Mistweaver' : ROLE[spec] !== 'healer')).map(([id, name, cls, spec]) => {
      const base = kind === 'heal' ? 85_000 + id * 4000 : ROLE[spec] === 'tank' ? 45_000 + id * 2000 : 120_000 + id * 6000;
      return { id, name, type: cls, icon: `${cls}-${spec}`, total: base * secs, activeTime: secs * 1000 * (0.78 + (id % 5) * 0.05),
        ...(kind === 'heal' ? { overheal: base * secs * (0.25 + id * 0.04) } : {}) };
    }),
  };
}

const casts = (f, pid) => {
  if (pid !== 6) return [{ timestamp: f.startTime + 2000, type: 'cast', sourceID: pid, abilityGameID: 116, fight: f.id }];
  const out = [{ timestamp: f.startTime + 1500, type: 'cast', sourceID: 6, abilityGameID: 12472, fight: f.id }];
  for (let s = 3; s < (f.endTime - f.startTime) / 1000; s += 2.2) out.push({ timestamp: f.startTime + s * 1000, type: 'cast', sourceID: 6, abilityGameID: 116, fight: f.id });
  return out;
};

const interrupts = FIGHTS.flatMap((f) => [7, 7, 7, 10, 1].map((pid, i) => ({ timestamp: f.startTime + 20_000 * (i + 1), type: 'interrupt', sourceID: pid, fight: f.id, abilityGameID: 1766, extraAbilityGameID: 116835 })));
const dispels = FIGHTS.flatMap((f) => [3, 4, 3].map((pid, i) => ({ timestamp: f.startTime + 30_000 * (i + 1), type: 'dispel', sourceID: pid, fight: f.id, abilityGameID: 527, extraAbilityGameID: 117558 })));

const rankings = (f) => ({ data: [{ fightID: f.id, roles: { dps: { characters: PLAYERS.map(([id, name]) => ({ name, rankPercent: (id * 37) % 100 })) } } }] });

const REPORT = {
  code: 'PreviewReport0001', title: 'Mogu\'shan Vaults — Thursday', startTime: Date.UTC(2026, 9, 29, 9, 30), endTime: Date.UTC(2026, 9, 29, 12, 0),
  zone: { id: 1008, name: "Mogu'shan Vaults" }, owner: { name: 'ChaosNova' }, guild: { name: 'Fable', server: { name: 'Mirage Raceway' } },
  fights: FIGHTS,
  masterData: {
    actors: [
      ...PLAYERS.map(([id, name, cls]) => ({ id, gameID: 0, name, type: 'Player', subType: cls, server: 'Mirage Raceway' })),
      { id: 100, name: 'Jasper Guardian', type: 'NPC', subType: 'Boss' }, { id: 101, name: 'Feng the Accursed', type: 'NPC', subType: 'Boss' },
      { id: 102, name: "Gara'jal the Spiritbinder", type: 'NPC', subType: 'Boss' },
      { id: 103, name: "Imperial Vizier Zor'lok", type: 'NPC', subType: 'Boss' },
    ],
    abilities: ABILITIES.map(([gameID, name, icon]) => ({ gameID, name, icon, type: 1 })),
  },
};

const fightsIn = (q) => {
  const m = q.match(/fightIDs: \[([\d,]+)\]/);
  return m ? m[1].split(',').map(Number) : null;
};

// ---------- guild: eight raid nights of MSV progression, then Heart of Fear ----------

const GUILD = { id: 777, name: 'Fable', faction: { name: 'Alliance' }, server: { name: 'Mirage Raceway', slug: 'mirage-raceway', region: { slug: 'us' } } };
// Per night: [encounterID, wipes, kill, killSeconds, bestWipePct]
const NIGHT_PLAN = [
  [[1395, 4, false, 0, 18]],
  [[1395, 2, true, 330], [1390, 3, false, 0, 40]],
  [[1395, 1, true, 310], [1390, 2, true, 390]],
  [[1395, 0, true, 298], [1390, 1, true, 360], [1434, 5, false, 0, 22]],
  [[1395, 0, true, 290], [1390, 0, true, 352], [1434, 4, false, 0, 9]],
  [[1395, 0, true, 284], [1390, 0, true, 340], [1434, 3, true, 420], [1507, 3, false, 0, 30]],
  [[1395, 0, true, 279], [1390, 0, true, 335], [1434, 1, true, 401], [1507, 2, false, 0, 12]],
  [[1395, 0, true, 270], [1390, 0, true, 330], [1434, 0, true, 395], [1507, 1, true, 330], [1395, 2, true, 360, 25, 4]],
];
const GUILD_REPORTS = NIGHT_PLAN.map((plan, n) => {
  const start = Date.UTC(2026, 8, 3 + Math.floor(n / 2) * 7 + (n % 2) * 2, 9, 30);
  let t = 60_000;
  let id = 1;
  const fights = [];
  for (const [enc, wipes, kill, killSecs, best, diff = 3] of plan) {
    for (let w = 0; w < wipes; w++) {
      const dur = 150_000 + w * 20_000;
      fights.push({ id: id++, encounterID: enc, name: BOSSES[enc][0], kill: false, bossPercentage: best + (wipes - 1 - w) * 7, startTime: t, endTime: t + dur, difficulty: diff, size: 10 });
      t += dur + 90_000;
    }
    if (kill) {
      fights.push({ id: id++, encounterID: enc, name: BOSSES[enc][0], kill: true, bossPercentage: 0, startTime: t, endTime: t + killSecs * 1000, difficulty: diff, size: 10 });
      t += killSecs * 1000 + 90_000;
    }
  }
  const zone = plan.some(([enc]) => enc === 1507) ? HOF : MSV;
  return { code: n === NIGHT_PLAN.length - 1 ? 'PreviewReport0001' : `GuildNight000${n + 1}xx`, title: `${zone.name} — night ${n + 1}`, startTime: start, endTime: start + t, zone, fights };
}).reverse();
const ATTENDANCE = GUILD_REPORTS.map((r, n) => ({
  code: r.code, startTime: r.startTime, zone: r.zone,
  // n = 0 is the newest raid. Rimeheart stopped coming three raids ago, so shows as lapsed.
  players: PLAYERS.map(([id, name, cls]) => ({ name, type: cls, presence: (id === 9 && n % 3 === 0) ? 0 : (id === 5 && n % 4 === 1) ? 2 : (id === 10 && n < 3) ? 0 : 1 })),
}));
// Thirty older raids, so the 50-report window needs more than one 25-raid attendance page.
for (let n = 0; n < 30; n++) {
  const startTime = GUILD_REPORTS[GUILD_REPORTS.length - 1].startTime - (n + 1) * 3.5 * 86_400_000;
  ATTENDANCE.push({ code: `OldRaid${String(n).padStart(2, '0')}xxxxxxx`, startTime, zone: MSV,
    players: PLAYERS.map(([id, name, cls]) => ({ name, type: cls, presence: id === 6 && n % 2 ? 0 : 1 })) });
}
// Every boss in each raid, as worldData.zone.encounters returns them.
const ZONE_ENCOUNTERS = {
  1008: [[1395, 'The Stone Guard'], [1390, 'Feng the Accursed'], [1434, "Gara'jal the Spiritbinder"], [1436, 'The Spirit Kings'], [1500, 'Elegon'], [1407, 'Will of the Emperor']],
  1009: [[1507, "Imperial Vizier Zor'lok"], [1504, "Blade Lord Ta'yak"], [1463, 'Garalon'], [1498, "Wind Lord Mel'jarak"], [1499, "Amber-Shaper Un'sok"], [1501, "Grand Empress Shek'zeer"]],
};
// Warcraft Logs class ids are alphabetical. Hexxa raids but isn't in the guild; three alts never raid.
const CLASS_IDS = { DeathKnight: 1, Druid: 2, Hunter: 3, Mage: 4, Monk: 5, Paladin: 6, Priest: 7, Rogue: 8, Shaman: 9, Warlock: 10, Warrior: 11 };
const CLASS_LIST = Object.entries(CLASS_IDS).map(([name, id]) => ({ id, name: name === 'DeathKnight' ? 'Death Knight' : name }));
const MEMBERS = [
  ...PLAYERS.filter(([id]) => id !== 9).map(([id, name, cls]) => ({ id: 1000 + id, name, guildRank: id === 1 ? 0 : id <= 5 ? 1 : 3, classID: CLASS_IDS[cls], level: 90 })),
  { id: 2001, name: 'Bulwarkalt', guildRank: 4, classID: CLASS_IDS.Paladin, level: 87 },
  { id: 2002, name: 'Lumenbank', guildRank: 5, classID: CLASS_IDS.Priest, level: 1 },
  { id: 2003, name: 'Oldfriend', guildRank: 3, classID: CLASS_IDS.Druid, level: 90 },
];

function respond(query, variables) {
  const rate = { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: 212, pointsResetIn: 1800 } };
  const fid = variables.f?.[0] ?? fightsIn(query)?.[0];
  const fight = FIGHTS.find((x) => x.id === fid);
  const wrap = (report) => ({ data: { reportData: { report } } });
  if (/r\d+: report\(code:/.test(query) && query.includes('fights(') && !query.includes('playerDetails')) {
    // Boss pulls for a batch of guild logs, aliased r0, r1, …
    const reps = {};
    for (const m of query.matchAll(/(r\d+): report\(code: "([^"]+)"\)/g)) reps[m[1]] = { fights: GUILD_REPORTS.find((x) => x.code === m[2])?.fights || [] };
    return { data: { ...rate, reportData: reps } };
  }
  if (query.includes('worldData')) {
    const zones = [...query.matchAll(/z(\d+): zone/g)].map((m) => [`z${m[1]}`, {
      id: Number(m[1]), difficulties: [{ id: 3, name: 'Normal' }, { id: 4, name: 'Heroic' }],
      encounters: (ZONE_ENCOUNTERS[m[1]] || []).map(([id, name]) => ({ id, name })),
      expansion: { id: 1004, name: 'Mists of Pandaria' },
    }]);
    return { data: { worldData: Object.fromEntries(zones) } };
  }
  if (query.includes('playerDetails')) {
    // Shaped like Warcraft Logs' playerDetails JSON: players grouped by role, "Class-Spec" icons.
    const byRole = { tanks: [], healers: [], dps: [] };
    for (const [id, name, cls, spec] of PLAYERS) {
      const role = ROLE[spec] === 'tank' ? 'tanks' : ROLE[spec] === 'healer' ? 'healers' : 'dps';
      byRole[role].push({ name, id, type: cls, icon: `${cls}-${spec}`, specs: [{ spec, count: 1 }] });
    }
    const reps = {};
    for (const m of query.matchAll(/(r\d+): report/g)) reps[m[1]] = { playerDetails: { data: { playerDetails: byRole } } };
    return { data: { reportData: reps } };
  }
  if (query.includes('members(')) {
    return { data: { gameData: { classes: CLASS_LIST }, guildData: { guild: { members: { data: MEMBERS, has_more_pages: false } } } } };
  }
  if (query.includes('attendance(')) {
    // Like the real API: more than 25 per request is refused.
    if (variables.limit > 25) return { errors: [{ message: 'limit must be 25 or less' }] };
    const page = variables.page || 1;
    const data = ATTENDANCE.slice((page - 1) * variables.limit, page * variables.limit);
    return { data: { guildData: { guild: { attendance: { data, has_more_pages: page * variables.limit < ATTENDANCE.length } } } } };
  }
  if (query.includes('reports(guildID')) {
    const page = variables.page || 1;
    const data = GUILD_REPORTS.slice((page - 1) * variables.limit, page * variables.limit);
    return { data: { reportData: { reports: { data, has_more_pages: page * variables.limit < GUILD_REPORTS.length } } } };
  }
  if (query.includes('guildData')) return { data: { guildData: { guild: GUILD } } };
  if (query.includes('masterData')) return { data: { ...rate, reportData: { report: REPORT } } };
  if (query.includes('gameZone')) return wrap({ fights: FIGHTS.map((x) => ({ id: x.id, gameZone: ZONE_OF[x.encounterID] })) });
  if (/^\{\s*rateLimitData/.test(query.trim())) return { data: rate };
  if (query.includes('dataType: Deaths')) return wrap({ events: { data: deathEvents, nextPageTimestamp: null } });
  if (query.includes('d0:')) {
    const r = {};
    for (const m of query.matchAll(/([dh])(\d+): events/g)) r[`${m[1]}${m[2]}`] = { data: m[2] === '0' ? windowEvents[fid].filter((e) => (m[1] === 'd') === (e.type === 'damage')) : [] };
    return wrap(r);
  }
  if (query.includes('rankings(')) return wrap({ rankings: rankings(fight) });
  if (query.includes('buffs: table(dataType: Buffs')) {
    // One player's aura uptimes (ms): Frostbyte as a Nether Tempest / Invocation frost mage, Shank as combat.
    const span = fight.endTime - fight.startTime;
    const up = (name, share) => ({ name, guid: ABILITIES.find((a) => a[1] === name)?.[0] ?? 0, totalUptime: Math.round(span * share), totalUses: 3 });
    const buffs = { 6: [up('Invocation', 0.78)], 7: [up('Slice and Dice', 0.97)] }[variables.p] || [];
    const debuffs = { 6: [up('Nether Tempest', 0.93)], 7: [up('Revealing Strike', 0.71)] }[variables.p] || [];
    return wrap({ buffs: { data: { auras: buffs } }, debuffs: { data: { auras: debuffs } } });
  }
  if (query.includes('debuffs: table(dataType: Debuffs')) {
    // Raid debuffs on the boss: armor and Weakened Blows kept up, Physical Vulnerability patchy, no spell debuff.
    const span = fight.endTime - fight.startTime;
    const up = (name, share) => ({ name, totalUptime: Math.round(span * share) });
    return wrap({ debuffs: { data: { auras: [up('Weakened Armor', 0.98), up('Physical Vulnerability', 0.62), up('Weakened Blows', 0.93)] } } });
  }
  if (query.includes('dataType: DamageTaken') && query.includes('filterExpression')) {
    // Avoidable hits: Lightning Fists on Feng, Sonic Ring on Zor'lok.
    const want = fightsIn(query) || [];
    const hits = [];
    for (const f of FIGHTS.filter((x) => want.includes(x.id))) {
      const plan = f.encounterID === 1390 ? [116157, [7, 7, 9, 4, 7]] : f.encounterID === 1507 ? [122336, [6, 8]] : null;
      if (!plan) continue;
      plan[1].forEach((pid, i) => hits.push({ timestamp: f.startTime + 15_000 * (i + 1), type: 'damage', sourceID: boss(f), targetID: pid, abilityGameID: plan[0], amount: 95_000, fight: f.id }));
    }
    return wrap({ events: { data: hits, nextPageTimestamp: null } });
  }
  if (query.includes('hostilityType: Enemies')) return wrap({ events: { data: [], nextPageTimestamp: null } });
  if (query.includes('combatants:')) {
    return wrap({
      combatants: { data: combatants.filter((c) => c.fight === fid) }, interrupts: { data: interrupts.filter((e) => e.fight === fid) },
      dispels: { data: dispels.filter((e) => e.fight === fid) }, potions: { data: potions.filter((e) => e.fight === fid) },
      damage: { data: table(fight, 'dmg') }, healing: { data: table(fight, 'heal') },
    });
  }
  if (/\bd\d+: table\(/.test(query)) {
    // Per-fight tables, aliased d<fightId> / h<fightId>.
    const r = {};
    for (const m of query.matchAll(/\b([dh])(\d+): table\(/g)) {
      const f = FIGHTS.find((x) => x.id === Number(m[2]));
      r[`${m[1]}${m[2]}`] = { data: f ? table(f, m[1] === 'd' ? 'dmg' : 'heal') : null };
    }
    return wrap(r);
  }
  if (query.includes('damage: table')) return wrap({ damage: { data: table(null, 'dmg') }, healing: { data: table(null, 'heal') }, interrupts: { data: interrupts }, dispels: { data: dispels } });
  if (query.includes('dataType: CombatantInfo')) return wrap({ events: { data: combatants, nextPageTimestamp: null } });
  if (query.includes('dataType: Casts') && query.includes('filterExpression')) return wrap({ events: { data: potions, nextPageTimestamp: null } });
  if (query.includes('dataType: Casts')) {
    const pid = Number((query.match(/sourceID: (\d+)/) || [])[1]);
    return wrap({ events: { data: casts(FIGHTS.find((x) => x.id === fightsIn(query)[0]), pid), nextPageTimestamp: null } });
  }
  return { errors: [{ message: `preview fixture has no answer for: ${query.slice(0, 80)}` }] };
}

const ITEM_NAMES = {
  0: 'Helm of the Stonebound Guard', 1: "Amulet of Seven Curses", 2: "Spaulders of the Emperor's Rage", 4: 'Chestguard of Eternal Vigilance',
  5: 'Girdle of Endless Spite', 6: 'Leggings of Imprisoned Will', 7: 'Sabatons of the Superior Being', 8: 'Bracers of Six Oxen',
  9: 'Gauntlets of Undesired Gifts', 10: 'Ring of the Shado-Pan Assault', 11: 'Circuit of the Frail Soul', 12: 'Bottle of Infinite Stars',
  13: 'Relic of Xuen', 14: 'Cloak of Overwhelming Corruption', 15: "Starshatter", 16: "Fan of Fiery Winds",
};

export function installFixture() {
  try { localStorage.setItem('fl.token', JSON.stringify({ access: 'preview', expires: null })); } catch { /* ignore */ }
  window.fetch = async (url, init = {}) => {
    // Wowhead tooltip data for item names. Fixture item ids encode the slot: 86000 + slot * 10 + player.
    const item = String(url).match(/nether\.wowhead\.com\/.*\/tooltip\/item\/(\d+)/);
    if (item) {
      const slot = Math.floor((Number(item[1]) - 86000) / 10);
      const name = ITEM_NAMES[slot] || `Item ${item[1]}`;
      return new Response(JSON.stringify({ name, quality: 4 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!String(url).includes('/api/v2/')) return new Response('', { status: 404 });
    const { query, variables } = JSON.parse(init.body);
    let body;
    try { body = respond(query, variables || {}); } catch (err) { body = { errors: [{ message: `fixture error: ${err.message}` }] }; }
    log(`${query.replace(/\s+/g, ' ').slice(0, 120)} → ${body.errors ? body.errors[0].message : 'ok'}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

// With ?debug, every query and its outcome is listed at the bottom of the page.
function log(line) {
  if (!new URLSearchParams(location.search).has('debug')) return;
  let pre = document.getElementById('fixture-log');
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = 'fixture-log';
    document.body.appendChild(pre);
  }
  pre.textContent += `${line}\n`;
}
