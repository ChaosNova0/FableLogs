// Boss mechanics for MoP raids: damage that a good pull takes none of, and enemy casts that should be interrupted.
// Hand-written and matched by ability name, keyed by the boss name as Warcraft Logs writes it. An ability whose
// name never appears in the log is left out of the results rather than reported as dodged, so a wrong or missing
// name here can't claim the raid did well.
// avoid:     { name, tip, tanksOk? }  tanksOk: a frontal or tank hit; only non-tanks hit by it count.
// interrupt: { name, tip? }            casts by enemies that should never go off.
import { fmtNum, halfRaidDownAt } from './analysis.js';

const SPREAD = 'Spread out or move away from it.';
const POOL = 'Move out of it straight away; it keeps ticking while you stand in it.';
const FRONTAL = 'A frontal cone: only the tank should be in front of the boss.';

export const BOSS_MECHANICS = {
  // ---------- Mogu'shan Vaults ----------
  'Feng the Accursed': { avoid: [{ name: 'Lightning Fists', tip: 'Move out of the line in front of Feng.' }] },
  'The Spirit Kings': {
    avoid: [{ name: 'Annihilate', tip: 'Qiang\'s frontal: get out of the line.' }, { name: 'Volley', tip: 'Subetai\'s cone: stand behind or to the side.' }],
  },
  'Will of the Emperor': { avoid: [{ name: 'Devastating Arc', tip: FRONTAL, tanksOk: true }] },

  // ---------- Heart of Fear ----------
  "Imperial Vizier Zor'lok": { avoid: [{ name: 'Sonic Ring', tip: 'Dodge the rings as they pass.' }, { name: 'Sonic Pulse', tip: 'Dodge the pulses.' }] },
  "Blade Lord Ta'yak": { avoid: [{ name: 'Blade Tempest', tip: 'Run out as soon as it starts.' }] },
  Garalon: { avoid: [{ name: 'Crush', tip: 'Don\'t stand under Garalon.', tanksOk: true }] },
  "Wind Lord Mel'jarak": { avoid: [{ name: 'Whirling Blade', tip: 'Step out of the blade\'s path.' }] },
  "Amber-Shaper Un'sok": {
    avoid: [{ name: 'Burning Amber', tip: POOL }],
    interrupt: [{ name: 'Amber Explosion', tip: 'Mutated players and the boss\'s Amber Explosion must be interrupted.' }],
  },

  // ---------- Terrace of Endless Spring ----------
  'Protectors of the Endless': { avoid: [{ name: 'Defiled Ground', tip: POOL }], interrupt: [{ name: 'Water Bolt' }] },
  'Sha of Fear': { avoid: [{ name: 'Breath of Fear', tip: 'Stand in the Wall of Light when the breath comes.' }] },

  // ---------- Throne of Thunder ----------
  "Jin'rokh the Breaker": { avoid: [{ name: 'Focused Lightning', tip: 'Kite the orb into a conductive pool, away from the raid.' }] },
  Horridon: {
    avoid: [{ name: 'Sand Trap', tip: POOL }, { name: 'Living Poison', tip: POOL }, { name: 'Lightning Nova', tip: 'Move away from the Lightning Nova totem.' }],
    interrupt: [{ name: 'Dino-Mending', tip: 'The Farraki and Gurubashi healers must not heal Horridon\'s dinomancers.' }, { name: 'Venom Bolt Volley' }],
  },
  'Council of Elders': { avoid: [{ name: 'Quicksand', tip: POOL }] },
  Tortos: { avoid: [{ name: 'Rockfall', tip: 'Dodge the falling rocks.' }, { name: 'Spinning Shell', tip: 'Stay clear of spinning turtles.' }] },
  Megaera: { avoid: [{ name: 'Cinders', tip: POOL }, { name: 'Icy Ground', tip: POOL }] },
  Durumu: {
    avoid: [{ name: 'Lingering Gaze', tip: POOL }, { name: 'Disintegration Beam', tip: 'Stay ahead of the beam and out of the maze.' }],
  },
  'Dark Animus': { avoid: [{ name: 'Crimson Wake', tip: 'Kite the Crimson Wake away from the raid.' }] },
  'Iron Qon': { avoid: [{ name: 'Burning Cinders', tip: POOL }, { name: 'Frozen Blood', tip: POOL }] },
  'Twin Consorts': { avoid: [{ name: 'Flames of Passion', tip: 'Stay out of Suen\'s charge path and its fire.' }, { name: 'Cosmic Barrage', tip: 'Dodge the stars.' }] },
  'Lei Shen': {
    avoid: [{ name: 'Crashing Thunder', tip: POOL }, { name: 'Thunderstruck', tip: 'Move away from the targeted spot.' }, { name: 'Lightning Whip', tip: 'Get out of the whip\'s line.' }],
  },

  // ---------- Siege of Orgrimmar ----------
  Immerseus: { avoid: [{ name: 'Swirl', tip: 'Dodge the swirling water.' }, { name: 'Sha Pool', tip: POOL }] },
  'Fallen Protectors': { avoid: [{ name: 'Corrupted Brew', tip: 'Move away from where the brew lands.' }, { name: 'Noxious Poison', tip: POOL }] },
  Norushen: { avoid: [{ name: 'Residual Corruption', tip: 'Don\'t walk through the corruption pools.' }] },
  'Sha of Pride': { avoid: [{ name: 'Self-Reflection', tip: 'Move away from where the reflections spawn.' }] },
  Galakras: {
    avoid: [{ name: 'Muzzle Spray', tip: 'Stay out of the cone.' }],
    interrupt: [{ name: 'Chain Heal', tip: 'The Dragonmaw Tidal Shamans\' heals must be interrupted.' }],
  },
  'Iron Juggernaut': {
    avoid: [{ name: 'Borer Drill', tip: 'Move off the drills.' }, { name: 'Cutter Laser', tip: 'Stay away from the laser\'s target.' }, { name: 'Explosive Tar', tip: POOL }],
  },
  "Kor'kron Dark Shaman": { avoid: [{ name: 'Foul Stream', tip: 'Stay out of the stream\'s line.' }, { name: 'Falling Ash', tip: 'Dodge the falling ash.' }] },
  'General Nazgrim': {
    avoid: [{ name: 'Ravager', tip: 'Move away from the Ravager.' }, { name: 'Heroic Shockwave', tip: SPREAD }, { name: 'Aftershock', tip: 'Dodge the aftershocks.' }],
    interrupt: [{ name: 'Empowered Chain Heal', tip: 'Kor\'kron Warshamans\' heals must be interrupted.' }, { name: 'Earth Shield' }, { name: 'Arcane Shock' }],
  },
  Malkorok: { avoid: [{ name: "Breath of Y'Shaarj", tip: FRONTAL, tanksOk: true }] },
  'Thok the Bloodthirsty': {
    avoid: [
      { name: 'Fearsome Roar', tip: FRONTAL, tanksOk: true },
      { name: 'Acid Breath', tip: FRONTAL, tanksOk: true },
      { name: 'Freezing Breath', tip: FRONTAL, tanksOk: true },
      { name: 'Scorching Breath', tip: FRONTAL, tanksOk: true },
    ],
  },
  'Paragons of the Klaxxi': { avoid: [{ name: 'Fiery Edge', tip: 'Don\'t cross the fiery lines between players.' }] },
  'Garrosh Hellscream': {
    avoid: [
      { name: 'Desecrated', tip: POOL },
      { name: 'Iron Star Impact', tip: 'Get out of the Iron Star\'s path.' },
      { name: 'Whirling Corruption', tip: 'Move away from Garrosh while he whirls.' },
      { name: 'Empowered Whirling Corruption', tip: 'Move away from Garrosh while he whirls.' },
    ],
    interrupt: [{ name: 'Chain Heal', tip: 'Farseer Wolf Riders\' heals must be interrupted.' }, { name: 'Chain Lightning' }],
  },
};

export function mechanicsFor(bossName) {
  const m = BOSS_MECHANICS[bossName];
  return m ? { avoid: m.avoid || [], interrupt: m.interrupt || [] } : null;
}

// Every tracked ability name for these bosses, for one filtered events query.
export function trackedNames(bossNames) {
  const avoid = new Set();
  const interrupt = new Set();
  for (const name of new Set(bossNames)) {
    const m = mechanicsFor(name);
    m?.avoid.forEach((a) => avoid.add(a.name));
    m?.interrupt.forEach((a) => interrupt.add(a.name));
  }
  return { avoid: [...avoid], interrupt: [...interrupt] };
}

const hitSize = (e) => (e.amount || 0) + (e.absorbed || 0);
const HIT_GAP_MS = 3000;

// When half the raid had died on this pull, or null if it never did. Matches analyzeFight's cut-off for deaths.
function collapseTime(fight, deaths, lk) {
  const mine = deaths.filter((d) => d.fight === fight.id).sort((a, b) => a.timestamp - b.timestamp);
  const size = (fight.friendlyPlayers || []).filter((id) => lk.isPlayer(id)).length || fight.size || mine.length;
  return halfRaidDownAt(mine, size);
}

/**
 * One pull's mechanics: who was hit by avoidable damage and which casts got through.
 * @param fight       fight object
 * @param damage      DamageTaken events for the tracked avoidable abilities (any fights; filtered here)
 * @param enemyCasts  enemy cast events for the tracked interruptible abilities
 * @param interrupts  interrupt events for the fight
 * @param lk          lookups
 * @param roleOf      pid → 'tank'|'healer'|'dps'|null
 * @param deaths      player death events (any fights): on a wipe, hits after half the raid is dead aren't counted,
 *                    since by then the boss is hitting whoever is left (e.g. breaths on the raid once the tanks die)
 * Returns null when the boss has no mechanics list.
 */
export function analyzeMechanics(fight, damage, enemyCasts, interrupts, lk, roleOf = () => null, deaths = []) {
  const m = mechanicsFor(fight.name);
  if (!m) return null;
  const inFight = (e) => e.timestamp >= fight.startTime && e.timestamp <= fight.endTime && (e.fight == null || e.fight === fight.id);
  const seen = new Set([...lk.abilities.values()].map((a) => a.name));
  const until = fight.kill ? fight.endTime : collapseTime(fight, deaths, lk) ?? fight.endTime;

  const avoid = m.avoid.filter((a) => seen.has(a.name)).map((a) => {
    const events = damage.filter((e) => e.type === 'damage' && inFight(e) && e.timestamp <= until && lk.abilityName(e.abilityGameID) === a.name
      && lk.isPlayer(e.targetID) && !(a.tanksOk && roleOf(e.targetID) === 'tank'));
    // A hit is one time caught by it: DoT ticks it leaves, and the pulses of something like Ravager that hits every
    // second while you stand in it, add to the damage but only count again after a HIT_GAP_MS break.
    const byPlayer = new Map();
    for (const e of [...events].sort((x, y) => x.timestamp - y.timestamp)) {
      const p = byPlayer.get(e.targetID) || { pid: e.targetID, hits: 0, damage: 0, last: -Infinity };
      if (!e.tick && e.timestamp - p.last > HIT_GAP_MS) p.hits++;
      p.last = e.timestamp;
      p.damage += hitSize(e);
      byPlayer.set(e.targetID, p);
    }
    for (const p of byPlayer.values()) delete p.last;
    const players = [...byPlayer.values()].filter((p) => p.hits).sort((x, y) => y.hits - x.hits || y.damage - x.damage);
    return {
      ...a,
      abilityId: events[0]?.abilityGameID ?? [...lk.abilities.values()].find((x) => x.name === a.name)?.gameID ?? null,
      hits: players.reduce((n, p) => n + p.hits, 0),
      damage: players.reduce((n, p) => n + p.damage, 0),
      players,
    };
  }).sort((x, y) => y.hits - x.hits);

  const interrupt = m.interrupt.filter((a) => seen.has(a.name)).map((a) => {
    const wentOff = enemyCasts.filter((e) => e.type === 'cast' && inFight(e) && lk.abilityName(e.abilityGameID) === a.name).length;
    const stopped = interrupts.filter((e) => e.type === 'interrupt' && inFight(e) && lk.abilityName(e.extraAbilityGameID) === a.name);
    const by = new Map();
    for (const e of stopped) by.set(e.sourceID, (by.get(e.sourceID) || 0) + 1);
    return {
      ...a,
      abilityId: [...lk.abilities.values()].find((x) => x.name === a.name)?.gameID ?? null,
      wentOff,
      interrupted: stopped.length,
      by: [...by.entries()].sort((x, y) => y[1] - x[1]),
    };
  }).filter((a) => a.wentOff || a.interrupted);

  // Per player, across every tracked ability.
  const players = new Map();
  for (const a of avoid) {
    for (const p of a.players) {
      const t = players.get(p.pid) || { pid: p.pid, hits: 0, damage: 0, abilities: [] };
      t.hits += p.hits; t.damage += p.damage; t.abilities.push([a.name, p.hits]);
      players.set(p.pid, t);
    }
  }

  const summary = [];
  const totalHits = avoid.reduce((n, a) => n + a.hits, 0);
  if (avoid.length) {
    summary.push(totalHits
      ? `${totalHits} avoidable hit${totalHits === 1 ? '' : 's'} for ${fmtNum(avoid.reduce((n, a) => n + a.damage, 0))} damage, on ${players.size} player${players.size === 1 ? '' : 's'}.`
      : 'Nobody was hit by any of the tracked avoidable abilities.');
    const worst = avoid[0];
    if (worst?.hits >= 3) summary.push(`${worst.name} hit people most (${worst.hits} times). ${worst.tip}`);
  }
  for (const a of interrupt) {
    if (a.wentOff) summary.push(`${a.name} went off ${a.wentOff} time${a.wentOff === 1 ? '' : 's'} (${a.interrupted} interrupted).${a.tip ? ` ${a.tip}` : ''}`);
  }

  return {
    avoid, interrupt, summary,
    players: [...players.values()].sort((x, y) => y.hits - x.hits || y.damage - x.damage),
    untracked: m.avoid.filter((a) => !seen.has(a.name)).map((a) => a.name),
  };
}

// Avoidable hits per player across a whole night: Map pid → { hits, damage, pulls }, plus the worst abilities.
export function nightMechanics(fights, damage, lk, roleOf = () => null, deaths = []) {
  const players = new Map();
  const abilities = new Map();
  for (const f of fights) {
    const res = analyzeMechanics(f, damage, [], [], lk, roleOf, deaths);
    if (!res) continue;
    for (const p of res.players) {
      const t = players.get(p.pid) || { pid: p.pid, hits: 0, damage: 0, pulls: 0 };
      t.hits += p.hits; t.damage += p.damage; t.pulls++;
      players.set(p.pid, t);
    }
    for (const a of res.avoid) {
      if (!a.hits) continue;
      const key = `${f.name}|${a.name}`;
      const t = abilities.get(key) || { boss: f.name, name: a.name, abilityId: a.abilityId, tip: a.tip, hits: 0 };
      t.hits += a.hits;
      abilities.set(key, t);
    }
  }
  return {
    players: [...players.values()].sort((x, y) => y.hits - x.hits || y.damage - x.damage),
    abilities: [...abilities.values()].sort((x, y) => y.hits - x.hits),
  };
}
