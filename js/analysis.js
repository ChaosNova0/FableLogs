// Pure analysis over Warcraft Logs data. No DOM, no network: everything here takes plain objects.
import { isFlask, isFood, isPotion, DPS_POTIONS } from './mop.js';

const MELEE = 1;
const WINDOW_MS = 10_000;
const BURST_MS = 3_000;

export function buildLookups(report) {
  const actors = new Map((report.masterData?.actors || []).map((a) => [a.id, a]));
  const abilities = new Map((report.masterData?.abilities || []).map((a) => [a.gameID, a]));
  return {
    actors,
    abilities,
    actor: (id) => actors.get(id),
    isPlayer: (id) => actors.get(id)?.type === 'Player',
    abilityName(id) {
      if (id === MELEE) return 'Melee';
      return abilities.get(id)?.name || (id ? `Spell ${id}` : 'Unknown');
    },
    sourceName(id) {
      if (id == null || id < 0) return 'Environment';
      return actors.get(id)?.name || 'Unknown';
    },
  };
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "5 Sept", or "5 Sept 2025" when it isn't this year. opts adds fields such as weekday.
export function fmtDay(ms, opts = {}) {
  const d = new Date(ms);
  const year = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...year, ...opts });
}

// Totals that can run past an hour: "3h 6m" rather than "186:34".
export function fmtDuration(ms) {
  if (ms < 3_600_000) return fmtTime(ms);
  const mins = Math.round(ms / 60_000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function fmtNum(n) {
  n = n || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

// WCL reports boss health as 0-100 on most sites but 0-10000 on some.
export function fmtPct(p) {
  if (p == null) return '?';
  const v = p > 100 ? p / 100 : p;
  return `${v.toFixed(v < 10 ? 1 : 0)}%`;
}

export function playerDeaths(deathEvents, lk) {
  return deathEvents.filter((d) => d.type === 'death' && lk.isPlayer(d.targetID));
}

function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const killingAbility = (d) => d.killingAbilityGameID ?? d.abilityGameID ?? null;

// ---------- Report level ----------

export function summarizeReport(report, deaths, lk) {
  const byFight = new Map();
  for (const d of deaths) {
    if (!byFight.has(d.fight)) byFight.set(d.fight, []);
    byFight.get(d.fight).push(d);
  }
  for (const list of byFight.values()) list.sort((a, b) => a.timestamp - b.timestamp);

  const encounters = new Map();
  for (const f of report.fights || []) {
    if (!encounters.has(f.encounterID)) encounters.set(f.encounterID, { id: f.encounterID, name: f.name, pulls: [] });
    encounters.get(f.encounterID).pulls.push({
      fight: f,
      deaths: byFight.get(f.id) || [],
      duration: f.endTime - f.startTime,
    });
  }
  for (const enc of encounters.values()) {
    enc.kills = enc.pulls.filter((p) => p.fight.kill);
    enc.wipes = enc.pulls.filter((p) => !p.fight.kill);
    const wipePcts = enc.wipes.map((p) => remainingPct(p.fight)).filter((v) => v != null);
    enc.bestWipe = wipePcts.length ? Math.min(...wipePcts) : null;
    enc.fastestKill = enc.kills.length ? Math.min(...enc.kills.map((p) => p.duration)) : null;
  }

  const firstDeaths = [];
  for (const enc of encounters.values()) {
    for (const p of enc.wipes) if (p.deaths[0]) firstDeaths.push(p.deaths[0]);
  }

  const deathCounts = countBy(deaths, (d) => d.targetID);
  const firstDeathCounts = countBy(firstDeaths, (d) => d.targetID);
  const killers = countBy(deaths, killingAbility);
  const pullTime = (report.fights || []).reduce((t, f) => t + (f.endTime - f.startTime), 0);

  const takeaways = [];
  const encList = [...encounters.values()];
  const killed = encList.filter((e) => e.kills.length).length;
  const wipes = encList.reduce((n, e) => n + e.wipes.length, 0);
  takeaways.push(`${killed} of ${encList.length} bosses killed, ${wipes} wipe${wipes === 1 ? '' : 's'}, ${fmtDuration(pullTime)} spent in boss fights.`);

  const progression = encList.filter((e) => e.wipes.length >= 2 || (e.wipes.length && !e.kills.length))
    .sort((a, b) => b.wipes.length - a.wipes.length);
  for (const e of progression.slice(0, 3)) {
    takeaways.push(e.kills.length
      ? `${e.name}: ${e.wipes.length} wipes before the kill (best wipe at ${fmtPct(e.bestWipe)}).`
      : `${e.name}: not killed. ${e.wipes.length} wipe${e.wipes.length === 1 ? '' : 's'}, best attempt at ${fmtPct(e.bestWipe)}.`);
  }
  if (deathCounts.length) {
    takeaways.push(`Most deaths: ${deathCounts.slice(0, 3).map(([id, n]) => `${lk.sourceName(id)} (${n})`).join(', ')}.`);
  }
  const repeatFirst = firstDeathCounts.filter(([, n]) => n >= 2);
  if (repeatFirst.length) {
    takeaways.push(`First to die on a wipe more than once: ${repeatFirst.slice(0, 3).map(([id, n]) => `${lk.sourceName(id)} (${n} pulls)`).join(', ')}. Early deaths usually decide a wipe, so start the review there.`);
  }
  if (killers.length && killers[0][1] >= 3) {
    const [id, n] = killers[0];
    takeaways.push(`${lk.abilityName(id)} was the most common killing blow (${n} deaths).`);
  }

  return { encounters: encList, deathCounts, firstDeathCounts, killers, takeaways };
}

// Groups summarizeReport() encounters by raid, in the order each raid was first pulled.
// zoneOf(fight) returns { id, name } or null; null falls back to the report's own zone.
export function groupByRaid(encounters, zoneOf, fallbackName = 'Raid') {
  const raids = new Map();
  for (const enc of encounters) {
    const zone = zoneOf(enc.pulls[0].fight);
    const key = zone?.id ?? zone?.name ?? '_';
    if (!raids.has(key)) raids.set(key, { name: zone?.name || fallbackName, encounters: [], first: enc.pulls[0].fight.startTime });
    raids.get(key).encounters.push(enc);
  }
  return [...raids.values()].sort((a, b) => a.first - b.first).map((r) => ({
    name: r.name,
    encounters: r.encounters,
    killed: r.encounters.filter((e) => e.kills.length).length,
    pulls: r.encounters.reduce((n, e) => n + e.pulls.length, 0),
  }));
}

// ---------- Single death ----------

function sum(events, field = 'amount') {
  return events.reduce((t, e) => t + (e[field] || 0), 0);
}

const hitSize = (e) => (e.amount || 0) + (e.absorbed || 0);

function topAbilities(dmg, lk, n = 2) {
  const m = new Map();
  for (const e of dmg) m.set(e.abilityGameID, (m.get(e.abilityGameID) || 0) + hitSize(e));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => lk.abilityName(id));
}

function maxHealth(dmg) {
  for (let i = dmg.length - 1; i >= 0; i--) {
    const e = dmg[i];
    if (e.maxHitPoints > 0 && (e.resourceActor == null || e.resourceActor === 2)) return e.maxHitPoints;
  }
  return null;
}

// Explains one death from the damage taken and healing received in the 10 seconds before it.
export function analyzeDeath(death, events, lk, ctx = {}) {
  const pid = death.targetID;
  const t = death.timestamp;
  const win = events.filter((e) => e.targetID === pid && e.timestamp >= t - WINDOW_MS && e.timestamp <= t + 50);
  const dmg = win.filter((e) => e.type === 'damage');
  const heals = win.filter((e) => (e.type === 'heal' || e.type === 'absorbed') && (e.amount || 0) > 0);

  const kb = [...dmg].reverse().find((e) => (e.overkill || 0) > 0) || dmg[dmg.length - 1] || null;
  const kbAbility = kb ? kb.abilityGameID : killingAbility(death);
  const kbName = lk.abilityName(kbAbility);
  const kbSource = kb ? lk.sourceName(kb.sourceID) : lk.sourceName(death.killerID);
  const total = sum(dmg);
  const final = dmg.filter((e) => e.timestamp >= t - BURST_MS);
  const finalTotal = sum(final);
  const healTotal = sum(heals);
  const maxHp = maxHealth(dmg);
  const kbHit = kb ? hitSize(kb) : 0;
  const before = kb ? sum(dmg.filter((e) => e !== kb && e.timestamp >= kb.timestamp - 2000)) : 0;

  let kind;
  let headline;
  if (/falling/i.test(kbName)) {
    kind = 'fall';
    headline = 'Fell to their death.';
  } else if (!dmg.length) {
    kind = 'unknown';
    headline = `Died to ${kbName}. No damage events were found in the last 10 seconds, so the log doesn't show why.`;
  } else if (maxHp && kbHit >= 0.8 * maxHp) {
    kind = 'oneshot';
    headline = `One-shot by ${kbName}: a ${fmtNum(kbHit)} hit, about ${Math.round((kbHit / maxHp) * 100)}% of their max health.`;
  } else if (kbHit >= 0.6 * total && before < 0.2 * kbHit) {
    kind = 'spike';
    headline = `Killed by a single big hit: ${kbName} for ${fmtNum(kbHit)}.`;
  } else if (finalTotal >= 0.7 * total) {
    kind = 'burst';
    headline = `Burst down: ${fmtNum(finalTotal)} damage in the last 3 seconds, mostly from ${topAbilities(final, lk).join(' and ')}.`;
  } else {
    kind = 'attrition';
    headline = `Worn down: ${fmtNum(total)} damage over 10 seconds, mostly from ${topAbilities(dmg, lk).join(' and ')}.`;
  }

  const notes = [];
  if (kb) notes.push(`Killing blow: ${kbName} from ${kbSource}${kb.overkill ? ` (${fmtNum(kb.overkill)} overkill)` : ''}.`);

  const kbActor = kb && lk.actor(kb.sourceID);
  if (kbActor?.type === 'Player' || kbActor?.type === 'Pet') {
    notes.push(kb.sourceID === pid ? 'The killing blow was self-inflicted.' : 'The killing blow came from a friendly player.');
  }

  if (kb && kbAbility === MELEE && kbActor && kbActor.type !== 'Player') {
    const meleeHits = dmg.filter((e) => e.abilityGameID === MELEE && e.sourceID === kb.sourceID).length;
    notes.push(meleeHits >= 5
      ? `Took ${meleeHits} melee hits from ${kbSource} while tanking it. Check defensive cooldowns and whether healers were on them.`
      : `Killed by melee from ${kbSource}. If they weren't a tank, they likely pulled threat or were standing in front of it.`);
  }

  const lastHeal = heals.filter((e) => e.timestamp <= t).pop();
  if (!lastHeal) notes.push('No healing or shields landed on them in the last 10 seconds.');
  else if (t - lastHeal.timestamp > 4000) notes.push(`No healing for the last ${((t - lastHeal.timestamp) / 1000).toFixed(1)} seconds.`);
  else if (dmg.length) notes.push(`Got ${fmtNum(healTotal)} healing and shields in the last 10 seconds against ${fmtNum(total)} damage taken.`);

  const repeats = new Map();
  for (const e of dmg) {
    if (e.abilityGameID === MELEE) continue;
    const r = repeats.get(e.abilityGameID) || { n: 0, total: 0 };
    r.n++; r.total += hitSize(e);
    repeats.set(e.abilityGameID, r);
  }
  [...repeats.entries()].filter(([, r]) => r.n >= 3).sort((a, b) => b[1].total - a[1].total).slice(0, 2)
    .forEach(([id, r]) => notes.push(`Hit ${r.n} times by ${lk.abilityName(id)} (${fmtNum(r.total)} total). If that ability can be dodged, this is the fix.`));

  if (ctx.first) notes.push('First death of the pull.');
  if (ctx.afterWipe) notes.push('Died after half the raid was already dead, so this one probably didn\'t matter.');

  const timeline = [...dmg, ...heals].sort((a, b) => a.timestamp - b.timestamp).slice(-16).map((e) => ({
    before: (t - e.timestamp) / 1000,
    kind: e.type === 'damage' ? 'damage' : 'heal',
    ability: lk.abilityName(e.abilityGameID),
    abilityId: e.abilityGameID,
    source: lk.sourceName(e.sourceID),
    amount: e.type === 'damage' ? hitSize(e) : e.amount,
    overkill: e.overkill || 0,
    hpPct: e.type === 'damage' && e.maxHitPoints > 0 && e.hitPoints != null && (e.resourceActor == null || e.resourceActor === 2)
      ? Math.max(0, Math.round((e.hitPoints / e.maxHitPoints) * 100)) : null,
  }));

  return {
    death, pid, time: t, kind, headline, notes, timeline,
    killingAbilityId: kbAbility, killingAbility: kbName, minor: !!ctx.afterWipe,
  };
}

// ---------- Fight level ----------

export function raidPlayers(fight, lk) {
  return (fight.friendlyPlayers || []).filter((id) => lk.isPlayer(id));
}

export function analyzeFight(fight, deaths, windowEvents, lk) {
  const sorted = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
  const raidSize = raidPlayers(fight, lk).length || fight.size || sorted.length;
  const halfIdx = Math.ceil(raidSize / 2) - 1;
  const collapseAt = !fight.kill && sorted[halfIdx] ? sorted[halfIdx].timestamp : null;

  const analyses = sorted.map((d, i) => analyzeDeath(d, windowEvents, lk, {
    first: i === 0 && !fight.kill,
    afterWipe: collapseAt != null && d.timestamp > collapseAt,
  }));

  const rel = (ts) => fmtTime(ts - fight.startTime);
  const summary = [];
  const duration = fmtTime(fight.endTime - fight.startTime);
  if (fight.kill) {
    summary.push(`Killed in ${duration} with ${sorted.length} death${sorted.length === 1 ? '' : 's'}.`);
    analyses.forEach((a) => summary.push(`${lk.sourceName(a.pid)} died at ${rel(a.time)}: ${a.headline}`));
  } else {
    summary.push(`Wipe with ${fmtPct(remainingPct(fight))} of the fight left after ${duration}.`);
    if (analyses[0]) summary.push(`First death: ${lk.sourceName(analyses[0].pid)} at ${rel(analyses[0].time)}. ${analyses[0].headline}`);
    const decisive = analyses.filter((a) => !a.minor);
    if (collapseAt != null) {
      summary.push(`Half the raid was dead by ${rel(collapseAt)}. ${decisive.length} death${decisive.length === 1 ? '' : 's'} happened before that point and are the ones worth reviewing.`);
    }
    const top = countBy(decisive, (a) => a.killingAbilityId)[0];
    if (top && top[1] >= 2) summary.push(`${lk.abilityName(top[0])} caused ${top[1]} of those deaths.`);
  }
  return { analyses, summary, raidSize, collapseAt };
}

// ---------- Prep, utility, throughput ----------

function auraName(aura, lk) {
  return aura.name || lk.abilities.get(aura.ability)?.name || '';
}

function auraIcon(aura, lk) {
  return aura.icon || lk.abilities.get(aura.ability)?.icon || '';
}

// buffEvents: potion (and raid) buff events in the pull, from fetchRaidBuffEvents. The pull snapshot can leave out a
// pre-pot's buff and the drink itself happens before the pull, so a potion buff whose first event in the pull is it
// fading (or being refreshed) also counts as a pre-pot.
export function consumables(fight, combatants, potions, lk, buffEvents = []) {
  const prePotCutoff = fight.startTime + 2000;
  const firstPotionEvent = new Map();
  for (const e of [...buffEvents].sort((x, y) => x.timestamp - y.timestamp)) {
    if ((e.fight != null && e.fight !== fight.id) || !DPS_POTIONS.has(lk.abilityName(e.abilityGameID))) continue;
    if (!firstPotionEvent.has(e.targetID)) firstPotionEvent.set(e.targetID, e);
  }
  const potionUpAtPull = (pid) => ['removebuff', 'refreshbuff'].includes(firstPotionEvent.get(pid)?.type);
  const rows = raidPlayers(fight, lk).map((pid) => {
    const info = combatants.find((c) => c.sourceID === pid);
    const auras = info?.auras || [];
    const flask = auras.find((a) => isFlask(auraName(a, lk), auraIcon(a, lk)));
    const food = auras.find((a) => isFood(auraName(a, lk), auraIcon(a, lk)));
    const mine = potions.filter((p) => p.sourceID === pid && p.type === 'cast');
    const potName = (p) => lk.abilityName(p.abilityGameID);
    const prePot = auras.some((a) => isPotion(auraName(a, lk))) || potionUpAtPull(pid)
      || mine.some((p) => p.timestamp <= prePotCutoff && DPS_POTIONS.has(potName(p)));
    const combatPots = mine.filter((p) => p.timestamp > prePotCutoff && DPS_POTIONS.has(potName(p))).length;
    return {
      pid,
      hasInfo: !!info,
      flask: flask ? auraName(flask, lk) || 'Yes' : null,
      food: !!food,
      prePot,
      combatPots,
      otherPots: mine.filter((p) => !DPS_POTIONS.has(potName(p))).map(potName),
    };
  });
  const withInfo = rows.filter((r) => r.hasInfo);
  return {
    rows,
    hasInfo: withInfo.length > 0,
    missingFlask: withInfo.filter((r) => !r.flask).map((r) => r.pid),
    missingFood: withInfo.filter((r) => !r.food).map((r) => r.pid),
    // A mana or healing potion still counts as having used one; healers drink mana potions instead of DPS ones.
    noPotions: rows.filter((r) => !r.prePot && !r.combatPots && !r.otherPots.length).map((r) => r.pid),
  };
}

// Interrupts and dispels: who did them and what they stopped.
export function utility(events, type, lk) {
  const byPlayer = new Map();
  for (const e of events) {
    if (e.type !== type || !lk.isPlayer(e.sourceID)) continue;
    const p = byPlayer.get(e.sourceID) || { pid: e.sourceID, count: 0, spells: new Map() };
    p.count++;
    p.spells.set(e.extraAbilityGameID, (p.spells.get(e.extraAbilityGameID) || 0) + 1);
    byPlayer.set(e.sourceID, p);
  }
  return [...byPlayer.values()].sort((a, b) => b.count - a.count)
    .map((p) => ({ ...p, spells: [...p.spells.entries()].sort((a, b) => b[1] - a[1]) }));
}

export function throughput(table, fight, lk) {
  const entries = table?.entries || [];
  const secs = Math.max(1, (fight.endTime - fight.startTime) / 1000);
  return entries
    .filter((e) => lk.isPlayer(e.id) || e.type !== 'Pet')
    .map((e) => ({ pid: e.id, name: e.name, subType: e.type, total: e.total || 0, perSec: (e.total || 0) / secs }))
    .sort((a, b) => b.total - a.total);
}

// How much of the fight was left when a pull ended, 0-100 (0 for kills). Prefers fightPercentage, which counts
// phases and every boss in a council fight, over bossPercentage; either can be on a 0-10000 scale.
export function remainingPct(f) {
  if (f.kill) return 0;
  const v = f.fightPercentage ?? f.bossPercentage;
  if (v == null) return null;
  return v > 100 ? v / 100 : v;
}
