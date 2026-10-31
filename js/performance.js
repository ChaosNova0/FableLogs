// Per-player performance breakdown and tips. Pure: takes fetched data, returns plain objects.
import { cooldownsFor, matchesCooldown, roleOf } from './cooldowns.js';
import { SPEC_MODULES } from './specs/index.js';
import { fmtTime } from './analysis.js';

const LEVEL_ORDER = { major: 0, minor: 1, info: 2, good: 3 };

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return `${n}${s}`;
}

// Warcraft Logs table entries carry "Class-Spec" in their icon field.
export function specOf(entry) {
  const icon = entry?.icon || '';
  const dash = icon.indexOf('-');
  return dash > 0 ? icon.slice(dash + 1) : null;
}

export function findEntry(table, pid) {
  return (table?.entries || []).find((e) => e.id === pid) || null;
}

// rankings() returns { data: [{ fightID, roles: { tanks|healers|dps: { characters: [...] } } }] }.
export function allRankings(rankings, fightId) {
  const fights = rankings?.data || (Array.isArray(rankings) ? rankings : []);
  const f = fights.find((x) => x.fightID === fightId) || fights[0];
  return Object.values(f?.roles || {}).flatMap((role) => role.characters || []);
}

export function findRanking(rankings, fightId, name) {
  return allRankings(rankings, fightId).find((c) => c.name === name) || null;
}

function analyzeCooldowns(list, casts, fight, alive, lk) {
  const start = fight.startTime;
  return list.map((cd) => {
    const used = casts.filter((c) => matchesCooldown(cd, lk.abilityName(c.abilityGameID)));
    const times = used.map((c) => c.timestamp);
    if (!times.length && cd.talent) return null;
    let eff = cd.cd * 1000;
    for (let i = 1; i < times.length; i++) eff = Math.min(eff, times[i] - times[i - 1]);
    eff = Math.max(eff, 10_000);
    // A cooldown that only comes back in the last few seconds doesn't count as a missed use.
    const usable = alive - 5000;
    const possible = usable > 0 ? Math.floor(usable / eff) + 1 : 0;
    return {
      name: cd.name,
      abilityId: used[0]?.abilityGameID ?? null,
      kind: cd.kind || 'throughput',
      cd: eff / 1000,
      uses: times.length,
      possible: Math.max(possible, times.length),
      times: times.map((t) => t - start),
    };
  }).filter(Boolean);
}

function castBreakdown(casts, alive, lk) {
  const m = new Map();
  for (const c of casts) m.set(c.abilityGameID, (m.get(c.abilityGameID) || 0) + 1);
  const minutes = Math.max(alive / 60000, 1 / 60);
  return [...m.entries()].map(([id, n]) => ({ id, name: lk.abilityName(id), casts: n, cpm: n / minutes }))
    .sort((a, b) => b.casts - a.casts);
}

/**
 * @param ctx.fight      fight object
 * @param ctx.pid        player actor id
 * @param ctx.lk         lookups from buildLookups
 * @param ctx.damage     DamageDone table
 * @param ctx.healing    Healing table
 * @param ctx.casts      this player's cast events in the fight
 * @param ctx.deaths     player death events in the fight
 * @param ctx.prep       this player's consumables row (from consumables()), or null
 * @param ctx.rankings   rankings JSON for the fight, or null
 */
export function analyzePlayer(ctx) {
  const { fight, pid, lk } = ctx;
  const actor = lk.actor(pid);
  const dmgEntry = findEntry(ctx.damage, pid);
  const healEntry = findEntry(ctx.healing, pid);
  const spec = specOf(dmgEntry) || specOf(healEntry);
  const className = actor?.subType || dmgEntry?.type || healEntry?.type;
  const role = roleOf(className, spec);

  const duration = fight.endTime - fight.startTime;
  const death = (ctx.deaths || []).filter((d) => d.targetID === pid).sort((a, b) => a.timestamp - b.timestamp)[0];
  const alive = death ? Math.max(0, death.timestamp - fight.startTime) : duration;
  const casts = (ctx.casts || []).filter((c) => c.type === 'cast' && c.sourceID === pid);

  const activeMs = Math.max(dmgEntry?.activeTime || 0, healEntry?.activeTime || 0);
  const activePct = alive > 0 && activeMs ? Math.min(1, activeMs / alive) : null;
  const secs = Math.max(1, duration / 1000);
  const dps = (dmgEntry?.total || 0) / secs;
  const hps = (healEntry?.total || 0) / secs;
  const overheal = healEntry?.overheal || 0;
  const overhealPct = healEntry && (healEntry.total + overheal) > 0 ? overheal / (healEntry.total + overheal) : null;

  const cooldowns = analyzeCooldowns(cooldownsFor(className, spec), casts, fight, alive, lk);
  const abilities = castBreakdown(casts, alive, lk);
  const ranking = findRanking(ctx.rankings, fight.id, actor?.name);

  const tips = [];
  const tip = (level, text) => tips.push({ level, text });

  if (death) {
    const lost = (fight.endTime - death.timestamp) / duration;
    tip(lost > 0.1 ? 'major' : 'minor',
      `You died at ${fmtTime(death.timestamp - fight.startTime)} and missed ${Math.round(lost * 100)}% of the fight. Nothing else on this page costs as much. The death recap on the pull page shows what killed you.`);
  }

  if (activePct != null && role !== 'healer') {
    const idle = Math.round((alive - activeMs) / 1000);
    if (activePct >= 0.9) tip('good', `Active ${Math.round(activePct * 100)}% of the time you were alive.`);
    else tip(activePct < 0.8 ? 'major' : 'minor',
      `You were active ${Math.round(activePct * 100)}% of the time you were alive, so ${idle} seconds with nothing being cast. Aim for 90% or more: use instant casts while moving, and start casting again as soon as a mechanic is dealt with.`);
  }

  const throughputCds = cooldowns.filter((c) => c.kind === 'throughput');
  let allCdsUsed = throughputCds.length > 0;
  for (const c of throughputCds) {
    if (c.uses >= c.possible) continue;
    allCdsUsed = false;
    const missed = c.possible - c.uses;
    if (c.uses === 0) {
      tip('major', `You never used ${c.name}. It could have been used ${c.possible} time${c.possible === 1 ? '' : 's'} this fight.`);
      continue;
    }
    const late = c.cd >= 120 && c.times[0] > 20_000
      ? ` Your first one was at ${fmtTime(c.times[0])}; using it at the pull leaves room for another before the fight ends.` : '';
    tip(missed >= 2 ? 'major' : 'minor',
      `You used ${c.name} ${c.uses} of a possible ${c.possible} times. Each skipped use is a lost burst window, so use it on cooldown unless your raid saves it for a specific phase.${late}`);
  }
  if (allCdsUsed) tip('good', 'You used every major cooldown as often as the fight allowed.');

  if (role === 'tank' && death) {
    const unused = cooldowns.filter((c) => c.kind === 'defensive' && c.uses === 0).map((c) => c.name);
    if (unused.length) tip('major', `You died without using ${unused.join(' or ')}.`);
  }

  if (role === 'healer' && overhealPct != null) {
    const pct = Math.round(overhealPct * 100);
    if (overhealPct > 0.6) tip('major', `${pct}% of your healing was overhealing. Save mana with smaller, cheaper heals, and let shields and HoTs do the topping off.`);
    else if (overhealPct > 0.4) tip('minor', `${pct}% of your healing was overhealing. Some is normal for a healer; above 40% usually means healing targets who were about to be topped off anyway.`);
  }

  if (ctx.prep?.hasInfo) {
    const missing = [!ctx.prep.flask && 'a flask', !ctx.prep.food && 'a food buff'].filter(Boolean);
    if (missing.length) tip('minor', `You pulled without ${missing.join(' or ')}.`);
  }
  const usedManaPot = role === 'healer' && ctx.prep?.otherPots.length > 0;
  if (ctx.prep && role !== 'tank' && !ctx.prep.prePot && !ctx.prep.combatPots && !usedManaPot) {
    tip('minor', role === 'healer'
      ? 'You didn\'t use a potion. A mana or intellect potion is free throughput on a long fight.'
      : 'You didn\'t use a potion. A pre-pot plus one during Bloodlust is free damage.');
  }

  if (ranking?.rankPercent != null) {
    const p = Math.round(ranking.rankPercent);
    tip(p >= 75 ? 'good' : 'info', `${ordinal(p)} percentile on Warcraft Logs for your spec on this boss.${p < 50 ? ' The tips above are the place to start.' : ''}`);
  }

  const module = SPEC_MODULES[`${String(className || '').replace(/\s+/g, '')}-${spec}`];
  const extra = module ? module({ fight, pid, actor, spec, casts, lk, alive, entry: dmgEntry || healEntry }) || {} : {};
  tips.push(...(extra.tips || []));
  tips.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    pid, actor, className, spec, role, alive, death, duration,
    activePct, dps, hps, overhealPct, damageTotal: dmgEntry?.total || 0, healingTotal: healEntry?.total || 0,
    cooldowns, abilities, ranking, tips,
    sections: extra.sections || [],
    hasSpecModule: !!module,
  };
}
