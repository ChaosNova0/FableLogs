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
 * One player across every boss pull in a report: a row per pull plus night-wide totals and highlights.
 * @param ctx.report        report (fights, masterData)
 * @param ctx.lk            lookups
 * @param ctx.pid           player actor id
 * @param ctx.deaths        player death events for the whole report
 * @param ctx.firstDeaths   how many wipes this player died first on (from summarizeReport)
 * @param ctx.fightTables   Map fightId → { damage, healing } (fetchFightTables)
 * @param ctx.rankings      Map fightId → rankings JSON (kills only)
 * @param ctx.prep          this player's prepOverview() row, or null
 * @param ctx.avoidable     { hits, pulls } from nightMechanics() (zero hits when clean), or null when nothing is tracked
 */
export function analyzeNightPlayer(ctx) {
  const { report, lk, pid } = ctx;
  const actor = lk.actor(pid);
  const fights = (report.fights || []).filter((f) => (f.friendlyPlayers || []).includes(pid));
  const pullNo = new Map();
  const seenPerBoss = new Map();
  for (const f of report.fights || []) {
    const n = (seenPerBoss.get(f.encounterID) || 0) + 1;
    seenPerBoss.set(f.encounterID, n);
    pullNo.set(f.id, n);
  }

  const specCount = new Map();
  const rows = fights.map((f) => {
    const tables = ctx.fightTables.get(f.id) || {};
    const d = findEntry(tables.damage, pid);
    const h = findEntry(tables.healing, pid);
    const spec = specOf(d) || specOf(h);
    if (spec) specCount.set(spec, (specCount.get(spec) || 0) + 1);
    const duration = f.endTime - f.startTime;
    const death = (ctx.deaths || []).filter((x) => x.fight === f.id && x.targetID === pid).sort((a, b) => a.timestamp - b.timestamp)[0];
    const alive = death ? Math.max(0, death.timestamp - f.startTime) : duration;
    const activeMs = Math.max(d?.activeTime || 0, h?.activeTime || 0);
    return {
      fight: f, pullNo: pullNo.get(f.id), duration, alive, spec,
      damage: d?.total || 0, healing: h?.total || 0,
      dps: (d?.total || 0) / Math.max(1, duration / 1000), hps: (h?.total || 0) / Math.max(1, duration / 1000),
      activePct: activeMs && alive ? Math.min(1, activeMs / alive) : null,
      parse: f.kill ? findRanking(ctx.rankings?.get(f.id), f.id, actor?.name)?.rankPercent ?? null : null,
      diedAt: death ? death.timestamp - f.startTime : null,
    };
  });

  const spec = [...specCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const role = roleOf(actor?.subType, spec);
  const healer = role === 'healer';
  const time = rows.reduce((t, r) => t + r.duration, 0);
  const output = rows.reduce((t, r) => t + (healer ? r.healing : r.damage), 0) / Math.max(1, time / 1000);
  const activeRows = rows.filter((r) => r.activePct != null);
  const aliveTime = activeRows.reduce((t, r) => t + r.alive, 0);
  const activePct = aliveTime ? activeRows.reduce((t, r) => t + r.activePct * r.alive, 0) / aliveTime : null;
  const parses = rows.filter((r) => r.parse != null);
  const avgParse = parses.length ? parses.reduce((t, r) => t + r.parse, 0) / parses.length : null;
  const best = parses.reduce((b, r) => (!b || r.parse > b.parse ? r : b), null);
  const died = rows.filter((r) => r.diedAt != null);

  const highlights = [];
  const add = (level, text) => highlights.push({ level, text });
  if (rows.length) {
    const share = died.length / rows.length;
    if (died.length) {
      add(share >= 0.4 ? 'major' : 'minor', `Died on ${died.length} of ${rows.length} pulls${ctx.firstDeaths ? `, and was the first to die on ${ctx.firstDeaths} wipe${ctx.firstDeaths === 1 ? '' : 's'}` : ''}. Their pull pages show what killed them.`);
    } else {
      add('good', `Survived all ${rows.length} pulls.`);
    }
  }
  if (activePct != null && !healer) {
    const p = Math.round(activePct * 100);
    if (activePct >= 0.9) add('good', `Active ${p}% of the time alive across the night.`);
    else add(activePct < 0.8 ? 'major' : 'minor', `Active ${p}% of the time alive across the night. Aim for 90% or more.`);
  }
  if (ctx.avoidable?.hits) {
    add(ctx.avoidable.hits >= 5 ? 'major' : 'minor', `Took ${ctx.avoidable.hits} avoidable hit${ctx.avoidable.hits === 1 ? '' : 's'} across ${ctx.avoidable.pulls} pull${ctx.avoidable.pulls === 1 ? '' : 's'}. Each pull's Mechanics tab names them.`);
  } else if (ctx.avoidable) {
    add('good', 'No avoidable hits from the tracked boss abilities.');
  }
  if (best) add(best.parse >= 75 ? 'good' : 'info', `Best parse: ${Math.round(best.parse)} on ${best.fight.name}${parses.length > 1 ? `; ${Math.round(avgParse)} on average across ${parses.length} kills` : ''}.`);
  if (ctx.prep?.info) {
    const misses = [
      ctx.prep.flaskMissed && `no flask on ${ctx.prep.flaskMissed} of ${ctx.prep.info} pulls`,
      ctx.prep.foodMissed && `no food on ${ctx.prep.foodMissed} of ${ctx.prep.info} pulls`,
    ].filter(Boolean);
    if (misses.length) add('minor', `Prep: ${misses.join(', ')}.`);
    else add('good', 'Flasked and fed on every pull.');
  }
  highlights.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    pid, actor, className: actor?.subType, spec, role, rows, time, output, outputLabel: healer ? 'HPS' : 'DPS',
    activePct, avgParse, bestParse: best?.parse ?? null, deaths: died.length, highlights,
  };
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
 * @param ctx.auras      { buffs, debuffEvents } for this player (fetchPlayerAuras), or null
 * @param ctx.mechanics  analyzeMechanics() result for the fight, or null
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
  const auras = ctx.auras && {
    buffs: ctx.auras.buffs,
    debuffs: ctx.auras.debuffs ?? { auras: debuffAuras(ctx.auras.debuffEvents || [], fight.startTime, fight.startTime + alive, lk) },
  };
  const uptimes = module && auras ? specUptimes(module, auras, alive) : [];
  for (const u of uptimes) {
    const p = Math.round(u.uptime * 100);
    if (u.uptime >= u.target) tip('good', `${u.label} was up ${p}% of the time you were alive.`);
    else tip(u.uptime < u.target - 0.15 ? 'major' : 'minor', `${u.label} was up ${p}% of the time you were alive. Aim for ${Math.round(u.target * 100)}% or more. ${u.tip}`);
  }

  const mine = ctx.mechanics?.players.find((p) => p.pid === pid);
  if (mine) {
    const list = mine.abilities.map(([name, n]) => `${name}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    tip(mine.hits >= 3 ? 'major' : 'minor', `You took ${mine.hits} avoidable hit${mine.hits === 1 ? '' : 's'} (${list}). The pull page's Mechanics tab says how to avoid each.`);
  } else if (ctx.mechanics?.avoid.length) {
    tip('good', 'You weren\'t hit by any of the tracked avoidable abilities.');
  }
  tips.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    pid, actor, className, spec, role, alive, death, duration,
    activePct, dps, hps, overhealPct, damageTotal: dmgEntry?.total || 0, healingTotal: healEntry?.total || 0,
    cooldowns, abilities, ranking, tips, uptimes,
    hasSpecModule: !!module,
  };
}

// Aura tables come back as { auras: [...] } or wrapped in { data: { auras } }; each aura has name and totalUptime (ms).
const auraList = (table) => table?.auras || table?.data?.auras || [];

/**
 * Debuffs a player kept on enemies, from their applydebuff/removedebuff events, shaped like aura table entries:
 * [{ name, guid, totalUptime }]. Uptime is the time at least one enemy had it, between start and end (ms), so
 * spreading a DoT over several targets doesn't count twice.
 */
export function debuffAuras(events, start, end, lk) {
  const open = new Map();
  const spans = new Map();
  const close = (key, id, at) => {
    const from = open.get(key);
    open.delete(key);
    if (from == null) return;
    const a = Math.max(from, start);
    const b = Math.min(at, end);
    if (b > a) (spans.get(id) || spans.set(id, []).get(id)).push([a, b]);
  };
  for (const e of [...events].sort((x, y) => x.timestamp - y.timestamp)) {
    const key = `${e.targetID}:${e.targetInstance || 0}:${e.abilityGameID}`;
    if (e.type === 'applydebuff' || ((e.type === 'refreshdebuff' || e.type === 'applydebuffstack') && !open.has(key))) {
      if (!open.has(key)) open.set(key, e.timestamp);
    } else if (e.type === 'removedebuff') {
      // A remove with no apply seen means it was already up when the pull started.
      if (!open.has(key)) open.set(key, start);
      close(key, e.abilityGameID, e.timestamp);
    }
  }
  for (const key of [...open.keys()]) close(key, Number(key.split(':')[2]), end);

  return [...spans.entries()].map(([id, list]) => {
    list.sort((x, y) => x[0] - y[0]);
    let total = 0;
    let [s, t] = list[0];
    for (const [a, b] of list.slice(1)) {
      if (a > t) { total += t - s; [s, t] = [a, b]; } else t = Math.max(t, b);
    }
    total += t - s;
    return { name: lk.abilityName(id), guid: id, totalUptime: total };
  });
}

/**
 * Uptime of each spec check, over the time the player was alive. Talent checks the player never had are skipped.
 * @param checks  SPEC_MODULES entry
 * @param auras   { buffs, debuffs } aura tables (debuffs from debuffAuras())
 */
export function specUptimes(checks, auras, alive) {
  const span = Math.max(1, alive);
  return checks.map((c) => {
    const found = auraList(c.kind === 'buff' ? auras.buffs : auras.debuffs).filter((a) => c.names.includes(a.name));
    if (c.talent && !found.length) return null;
    const ms = found.reduce((t, a) => t + (a.totalUptime || 0), 0);
    return {
      label: c.label || c.names[0], kind: c.kind, target: c.target, tip: c.tip,
      abilityId: found[0]?.guid ?? null, uptime: Math.min(1, ms / span),
    };
  }).filter(Boolean);
}
