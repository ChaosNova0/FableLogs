// One player across several raid nights: parses, output, deaths and avoidable hits night by night, and which way
// they're heading. Pure, like analysis.js.
import { nightMechanics } from './mechanics.js';

// rankings() JSON → this player's entry per fight id: Map fightId → { parse, amount, role }.
// amount is DPS, or HPS when they're ranked as a healer.
function rankingsFor(rankings, name) {
  const out = new Map();
  const fights = rankings?.data || (Array.isArray(rankings) ? rankings : []);
  for (const f of fights) {
    for (const [role, list] of Object.entries(f.roles || {})) {
      const c = (list.characters || []).find((x) => x.name === name);
      if (c) out.set(f.fightID, { parse: c.rankPercent ?? null, amount: c.amount ?? null, role: role === 'healers' ? 'healer' : role === 'tanks' ? 'tank' : 'dps' });
    }
  }
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * One raid night for one player.
 * @param n.report    fetchReport() result
 * @param n.lk        lookups for the report
 * @param n.pid       the player's actor id in this report
 * @param n.deaths    player death events for the whole report
 * @param n.rankings  rankings JSON for the report's kills, or null
 * @param n.mech      fetchMechanicEvents() result for the report, or null
 * @param n.roleOf    pid → role, for frontal abilities tanks are meant to take (defaults to this player's ranked role)
 */
export function nightStats(n) {
  const { report, lk, pid } = n;
  const name = lk.actor(pid)?.name;
  const fights = (report.fights || []).filter((f) => (f.friendlyPlayers || []).includes(pid));
  const mine = (n.deaths || []).filter((d) => d.targetID === pid && fights.some((f) => f.id === d.fight));
  const ranks = rankingsFor(n.rankings, name);
  const bosses = fights.filter((f) => f.kill).map((f) => ({
    encounterID: f.encounterID, name: f.name, fightId: f.id, ...(ranks.get(f.id) || { parse: null, amount: null, role: null }),
  }));
  const parses = bosses.map((b) => b.parse).filter((p) => p != null);
  const role = bosses.find((b) => b.role)?.role || null;
  const roleOf = n.roleOf || ((id) => (id === pid ? role : null));
  const mech = n.mech ? nightMechanics(fights, n.mech.damage, lk, roleOf, n.deaths || []) : null;
  return {
    code: report.code,
    title: report.title,
    zone: report.zone?.name || '',
    start: report.startTime,
    pid,
    pulls: fights.length,
    kills: bosses.length,
    deaths: mine.length,
    pullsDied: new Set(mine.map((d) => d.fight)).size,
    avoid: mech ? mech.players.find((p) => p.pid === pid)?.hits || 0 : null,
    bosses,
    avgParse: avg(parses),
    bestParse: parses.length ? Math.max(...parses) : null,
    role,
  };
}

/**
 * The trend across nights (any order; sorted oldest first here). Compares the newer half of the nights with the
 * older half, so one odd night doesn't decide the direction.
 */
export function playerTrend(nightsIn) {
  const nights = [...nightsIn].sort((a, b) => a.start - b.start);
  const half = Math.floor(nights.length / 2);
  const older = nights.slice(0, half);
  const newer = nights.slice(nights.length - half);

  const perPull = (list, key) => {
    const pulls = list.reduce((s, x) => s + (key === 'avoid' && x.avoid == null ? 0 : x.pulls), 0);
    return pulls ? list.reduce((s, x) => s + (x[key] || 0), 0) / pulls : null;
  };
  const parseOf = (list) => avg(list.flatMap((x) => x.bosses.map((b) => b.parse).filter((p) => p != null)));

  // Each boss's parse night by night, for the boss × night table.
  const bossMap = new Map();
  for (const n of nights) {
    for (const b of n.bosses) {
      if (!bossMap.has(b.encounterID)) bossMap.set(b.encounterID, { encounterID: b.encounterID, name: b.name, byNight: new Map() });
      bossMap.get(b.encounterID).byNight.set(n.code, b);
    }
  }

  const summary = {
    nights: nights.length,
    pulls: nights.reduce((s, x) => s + x.pulls, 0),
    kills: nights.reduce((s, x) => s + x.kills, 0),
    avgParse: parseOf(nights),
    olderParse: parseOf(older),
    newerParse: parseOf(newer),
    deathsPerPull: perPull(nights, 'deaths'),
    olderDeaths: perPull(older, 'deaths'),
    newerDeaths: perPull(newer, 'deaths'),
    avoidPerPull: perPull(nights, 'avoid'),
    olderAvoid: perPull(older, 'avoid'),
    newerAvoid: perPull(newer, 'avoid'),
  };

  const highlights = [];
  const add = (level, text) => highlights.push({ level, text });
  if (half >= 1) {
    const span = `over the last ${newer.length} night${newer.length === 1 ? '' : 's'} compared with the ${older.length} before`;
    if (summary.olderParse != null && summary.newerParse != null) {
      const d = summary.newerParse - summary.olderParse;
      if (Math.abs(d) >= 5) add(d > 0 ? 'good' : 'major', `Average parse ${d > 0 ? 'up' : 'down'} from ${Math.round(summary.olderParse)} to ${Math.round(summary.newerParse)} ${span}.`);
      else add('info', `Parses steady around ${Math.round(summary.avgParse)} ${span}.`);
    }
    if (summary.olderDeaths != null && summary.newerDeaths != null && Math.abs(summary.newerDeaths - summary.olderDeaths) >= 0.05) {
      const better = summary.newerDeaths < summary.olderDeaths;
      add(better ? 'good' : 'major', `Dying on ${better ? 'fewer' : 'more'} pulls: ${pct(summary.olderDeaths)} → ${pct(summary.newerDeaths)} deaths per pull ${span}.`);
    }
    if (summary.olderAvoid != null && summary.newerAvoid != null && Math.abs(summary.newerAvoid - summary.olderAvoid) >= 0.1) {
      const better = summary.newerAvoid < summary.olderAvoid;
      add(better ? 'good' : 'minor', `${better ? 'Fewer' : 'More'} avoidable hits: ${summary.olderAvoid.toFixed(1)} → ${summary.newerAvoid.toFixed(1)} per pull ${span}.`);
    }
  }
  // Bosses where the latest parse is well below their own best on it.
  for (const b of bossMap.values()) {
    const list = nights.map((n) => b.byNight.get(n.code)).filter((x) => x?.parse != null);
    if (list.length < 2) continue;
    const best = Math.max(...list.map((x) => x.parse));
    const last = list[list.length - 1].parse;
    if (best - last >= 25) add('minor', `${b.name}: latest parse ${Math.round(last)}, well below their best of ${Math.round(best)} on it.`);
  }

  return { nights, bosses: [...bossMap.values()], summary, highlights };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
