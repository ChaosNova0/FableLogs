// Two pulls of the same boss side by side: what went differently. Pure, like analysis.js.
import { remainingPct, consumables, halfRaidDownAt } from './analysis.js';
import { findEntry } from './performance.js';
import { analyzeMechanics } from './mechanics.js';
import { buffCoverage, debuffCoverage } from './buffs.js';

// Raid-wide cooldowns and Bloodlust, matched by cast name.
export const RAID_COOLDOWNS = [
  'Bloodlust', 'Heroism', 'Time Warp', 'Ancient Hysteria',
  'Tranquility', 'Divine Hymn', 'Power Word: Barrier', 'Rallying Cry', 'Spirit Link Totem', 'Healing Tide Totem',
  'Revival', 'Aura Mastery', 'Devotion Aura', 'Anti-Magic Zone', 'Smoke Bomb', 'Demoralizing Banner', 'Hymn of Hope',
];

const CHANNEL_MS = 15_000;

// When half the raid had died, or null if it never did (the same cut-off the pull page uses).
function collapseAt(fight, deaths, raidSize) {
  return fight.kill ? null : halfRaidDownAt(deaths, raidSize);
}

/**
 * One pull, summarised for comparing.
 * @param side.fight          fight object
 * @param side.deaths         player death events in the fight
 * @param side.detail         fetchFightDetail() result
 * @param side.mech           fetchMechanicEvents() result, or null
 * @param side.enemyDebuffs   fetchEnemyDebuffs() result, or null
 * @param side.buffEvents     raid buff events in the fight
 * @param side.cdCasts        raid cooldown casts (any fights; filtered here)
 * @param info                pid → { spec, classSpec, role }
 * Players are keyed by name and server rather than actor id, since ids differ between logs.
 */
export function summarizePull(side, lk, info) {
  const { fight } = side;
  const pids = (fight.friendlyPlayers || []).filter((id) => lk.isPlayer(id));
  const keyOf = (pid) => { const a = lk.actor(pid); return `${a?.name || pid}-${a?.server || ''}`; };
  const secs = Math.max(1, (fight.endTime - fight.startTime) / 1000);
  const deaths = [...side.deaths].sort((a, b) => a.timestamp - b.timestamp);
  const rel = (ts) => ts - fight.startTime;
  const role = (pid) => info(pid).role;
  const mech = side.mech ? analyzeMechanics(fight, side.mech.damage, side.mech.casts, side.detail.interrupts, lk, role, deaths) : null;
  const classSpecs = pids.map((pid) => info(pid).classSpec);
  const cons = consumables(fight, side.detail.combatants, side.detail.potions, lk, side.buffEvents || []);

  const players = new Map(pids.map((pid) => {
    const d = findEntry(side.detail.damage, pid);
    const h = findEntry(side.detail.healing, pid);
    const mine = deaths.filter((x) => x.targetID === pid);
    const death = mine[0];
    const alive = death ? Math.max(1, death.timestamp - fight.startTime) : fight.endTime - fight.startTime;
    const activeMs = Math.max(d?.activeTime || 0, h?.activeTime || 0);
    // Output per second alive, so an early death doesn't read as low output (the Died columns show the deaths).
    // Someone battle-ressed and killed again is measured over the whole pull, since the time they lay dead isn't known.
    const outSecs = mine.length > 1 ? secs : alive / 1000;
    return [keyOf(pid), {
      pid, key: keyOf(pid), spec: info(pid).spec, role: role(pid),
      dps: (d?.total || 0) / outSecs, hps: (h?.total || 0) / outSecs,
      active: activeMs ? Math.min(1, activeMs / alive) : null,
      diedAt: death ? rel(death.timestamp) : null,
      avoid: mech?.players.find((p) => p.pid === pid)?.hits || 0,
    }];
  }));

  const cooldowns = new Map();
  for (const c of side.cdCasts || []) {
    if (c.type !== 'cast' || c.timestamp < fight.startTime || c.timestamp > fight.endTime || !lk.isPlayer(c.sourceID)) continue;
    const name = lk.abilityName(c.abilityGameID);
    if (!RAID_COOLDOWNS.includes(name)) continue;
    // The four Bloodlust effects are one thing for comparing.
    const key = ['Heroism', 'Time Warp', 'Ancient Hysteria'].includes(name) ? 'Bloodlust' : name;
    if (!cooldowns.has(key)) cooldowns.set(key, []);
    // Channelled cooldowns (Tranquility, Divine Hymn) log a cast for every tick, so casts by the same player within
    // CHANNEL_MS of their last one are the same use.
    const list = cooldowns.get(key);
    const last = list.findLast((x) => x.pid === c.sourceID);
    if (last && rel(c.timestamp) - last.lastTick <= CHANNEL_MS) { last.lastTick = rel(c.timestamp); continue; }
    list.push({ at: rel(c.timestamp), pid: c.sourceID, lastTick: rel(c.timestamp) });
  }
  for (const list of cooldowns.values()) for (const x of list) delete x.lastTick;

  return {
    fight, lk, pids, keys: pids.map(keyOf), players,
    kill: !!fight.kill,
    remaining: remainingPct(fight),
    duration: fight.endTime - fight.startTime,
    deaths: deaths.map((d) => ({ pid: d.targetID, key: keyOf(d.targetID), at: rel(d.timestamp), abilityId: d.killingAbilityGameID ?? d.abilityGameID ?? null })),
    firstDeath: deaths[0] ? rel(deaths[0].timestamp) : null,
    collapse: (() => { const t = collapseAt(fight, deaths, pids.length || fight.size || 0); return t == null ? null : rel(t); })(),
    mech,
    cooldowns,
    buffs: buffCoverage(pids, side.detail.combatants, lk, classSpecs, side.buffEvents || []),
    debuffs: debuffCoverage(side.enemyDebuffs, fight, lk, classSpecs),
    noPotions: cons.noPotions,
  };
}

/**
 * Two pulls of one boss, A the earlier, B the later. Returns the rows each section of the compare page shows.
 */
export function comparePulls(a, b) {
  const all = [...new Set([...a.keys, ...b.keys])];
  const output = (p) => (p ? (p.role === 'healer' ? p.hps : p.dps) : null);

  const players = all.map((key) => {
    const pa = a.players.get(key);
    const pb = b.players.get(key);
    const oa = output(pa);
    const ob = output(pb);
    return {
      key, a: pa || null, b: pb || null,
      role: pb?.role || pa?.role || null,
      change: oa != null && ob != null && oa > 0 ? (ob - oa) / oa : null,
    };
  }).sort((x, y) => (x.change ?? Infinity) - (y.change ?? Infinity));

  const abilityRows = (pick) => {
    const names = new Set([...(pick(a) || []), ...(pick(b) || [])].map((x) => x.name));
    return [...names].map((name) => ({
      name,
      a: (pick(a) || []).find((x) => x.name === name) || null,
      b: (pick(b) || []).find((x) => x.name === name) || null,
    }));
  };
  const avoid = abilityRows((s) => s.mech?.avoid).filter((r) => (r.a?.hits || 0) + (r.b?.hits || 0) > 0)
    .sort((x, y) => ((y.b?.hits || 0) + (y.a?.hits || 0)) - ((x.b?.hits || 0) + (x.a?.hits || 0)));
  const interrupts = abilityRows((s) => s.mech?.interrupt);

  const cdNames = RAID_COOLDOWNS.filter((n) => a.cooldowns.has(n) || b.cooldowns.has(n));
  const cooldowns = cdNames.map((name) => ({ name, a: a.cooldowns.get(name) || [], b: b.cooldowns.get(name) || [] }));

  const diedBoth = [...new Set(a.deaths.filter((d) => b.deaths.some((e) => e.key === d.key)).map((d) => d.key))];
  const specChanges = all.filter((key) => a.players.get(key)?.spec && b.players.get(key)?.spec && a.players.get(key).spec !== b.players.get(key).spec)
    .map((key) => ({ key, pid: b.players.get(key).pid, from: a.players.get(key).spec, to: b.players.get(key).spec }));

  const highlights = [];
  const fmtS = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;
  if (a.firstDeath != null && b.firstDeath != null && Math.abs(a.firstDeath - b.firstDeath) >= 15000) {
    highlights.push(`The first death came ${b.firstDeath > a.firstDeath ? 'later' : 'earlier'} in the second pull (${fmtS(a.firstDeath)} → ${fmtS(b.firstDeath)}).`);
  }
  if (a.deaths.length !== b.deaths.length) highlights.push(`Deaths: ${a.deaths.length} → ${b.deaths.length}.`);
  const hitsA = a.mech ? a.mech.avoid.reduce((n, x) => n + x.hits, 0) : null;
  const hitsB = b.mech ? b.mech.avoid.reduce((n, x) => n + x.hits, 0) : null;
  if (hitsA != null && hitsB != null && hitsA !== hitsB) highlights.push(`Avoidable hits: ${hitsA} → ${hitsB}.`);
  const dropped = players.filter((p) => p.change != null && p.change <= -0.2);
  if (dropped.length) highlights.push(`${dropped.length} player${dropped.length === 1 ? '' : 's'} did 20% or more less in the second pull.`);
  if (diedBoth.length) highlights.push(`${diedBoth.length} player${diedBoth.length === 1 ? '' : 's'} died in both pulls.`);

  return {
    a, b, players, avoid, interrupts, cooldowns, highlights, diedBoth, specChanges,
    // As actor ids in their own pull, for showing names.
    swappedIn: b.pids.filter((pid, i) => !a.keys.includes(b.keys[i])),
    swappedOut: a.pids.filter((pid, i) => !b.keys.includes(a.keys[i])),
  };
}

// The pull to compare against by default: for a kill, the best wipe; for a wipe, the kill if there is one, else the
// pull before it (or after, for the first pull). pulls: this boss's pulls in order.
export function defaultComparison(pulls, fight) {
  const others = pulls.filter((f) => f.id !== fight.id);
  if (!others.length) return null;
  if (fight.kill) {
    const wipes = others.filter((f) => !f.kill);
    if (wipes.length) return wipes.reduce((best, f) => ((remainingPct(f) ?? 100) < (remainingPct(best) ?? 100) ? f : best));
  }
  const kill = others.find((f) => f.kill);
  if (!fight.kill && kill) return kill;
  const idx = pulls.findIndex((f) => f.id === fight.id);
  return pulls[idx - 1] || pulls[idx + 1] || others[0];
}
