// Positive call-outs: who did well on a pull and across the night. Pure, like analysis.js.
import { raidPlayers, utility, fmtNum, fmtTime } from './analysis.js';
import { specOf, allRankings } from './performance.js';
import { roleOf } from './cooldowns.js';

function top(rows, value) {
  let best = null;
  for (const r of rows) if (value(r) > 0 && (!best || value(r) > value(best))) best = r;
  return best;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param ctx.fight     fight object
 * @param ctx.lk        lookups
 * @param ctx.detail    fetchFightDetail() result
 * @param ctx.deaths    player deaths in this fight
 * @param ctx.prep      consumables() result
 * @param ctx.rankings  rankings JSON or null
 * Each kudo: { icon, title, pids, text }
 */
export function fightKudos({ fight, lk, detail, deaths, prep, rankings }) {
  const kudos = [];
  const players = raidPlayers(fight, lk);
  const inRaid = new Set(players);
  const secs = Math.max(1, (fight.endTime - fight.startTime) / 1000);
  const entries = (table) => (table?.entries || []).filter((e) => inRaid.has(e.id));

  const dmgTop = top(entries(detail.damage), (e) => e.total || 0);
  if (dmgTop) kudos.push({ icon: '⚔', title: 'Top damage', pids: [dmgTop.id], text: `${fmtNum(dmgTop.total / secs)} DPS` });

  const healTop = top(entries(detail.healing), (e) => e.total || 0);
  if (healTop) kudos.push({ icon: '✚', title: 'Top healing', pids: [healTop.id], text: `${fmtNum(healTop.total / secs)} HPS` });

  const kicks = utility(detail.interrupts || [], 'interrupt', lk)[0];
  if (kicks) kudos.push({ icon: '✋', title: 'Most interrupts', pids: [kicks.pid], text: plural(kicks.count, 'interrupt') });

  const dispels = utility(detail.dispels || [], 'dispel', lk)[0];
  if (dispels) kudos.push({ icon: '✧', title: 'Most dispels', pids: [dispels.pid], text: plural(dispels.count, 'dispel') });

  // Active time among DPS players, who are the ones expected to be casting nonstop.
  const deathAt = new Map(deaths.map((d) => [d.targetID, d.timestamp]));
  const active = entries(detail.damage)
    .filter((e) => roleOf(e.type, specOf(e)) === 'dps' && e.activeTime)
    .map((e) => ({ id: e.id, pct: e.activeTime / Math.max(1, (deathAt.get(e.id) ?? fight.endTime) - fight.startTime) }));
  const busiest = top(active, (a) => a.pct);
  if (busiest && busiest.pct >= 0.9) {
    kudos.push({ icon: '⏱', title: 'Always casting', pids: [busiest.id], text: `${Math.min(100, Math.round(busiest.pct * 100))}% active time` });
  }

  const best = allRankings(rankings, fight.id)
    .map((c) => ({ ...c, pid: players.find((id) => lk.actor(id)?.name === c.name) }))
    .filter((c) => c.pid != null && c.rankPercent != null)
    .sort((a, b) => b.rankPercent - a.rankPercent);
  if (best[0] && best[0].rankPercent >= 75) {
    const great = best.filter((c) => c.rankPercent >= 95);
    kudos.push(great.length > 1
      ? { icon: '★', title: '95+ parses', pids: great.map((c) => c.pid), text: plural(great.length, 'player') }
      : { icon: '★', title: 'Top parse', pids: [best[0].pid], text: `${Math.round(best[0].rankPercent)} percentile` });
  }

  if (prep?.hasInfo) {
    const ready = prep.rows.filter((r) => r.hasInfo && r.flask && r.food && (r.prePot || r.combatPots || r.otherPots.length));
    if (ready.length === players.length && ready.length > 0) {
      kudos.push({ icon: '⚗', title: 'Fully prepared', pids: [], text: 'Everyone had a flask, food and a potion' });
    } else if (ready.length) {
      kudos.push({ icon: '⚗', title: 'Fully prepared', pids: ready.map((r) => r.pid), text: 'Flask, food and a potion' });
    }
  }

  if (fight.kill) {
    if (!deaths.length) kudos.push({ icon: '♥', title: 'Deathless kill', pids: [], text: 'Nobody died' });
  } else {
    // On a wipe, whoever lasted longest held on the most.
    const alive = players.filter((id) => !deathAt.has(id));
    const last = alive.length ? alive : [...deaths].sort((a, b) => b.timestamp - a.timestamp).slice(0, 1).map((d) => d.targetID);
    if (last.length && last.length <= 3) {
      kudos.push({
        icon: '⚑', title: 'Last standing', pids: last,
        text: alive.length ? 'Alive at the end of the wipe' : `Lasted until ${fmtTime(deathAt.get(last[0]) - fight.startTime)}`,
      });
    }
  }
  return kudos;
}

/**
 * Whole-night kudos from the death list plus one set of totals across every boss pull.
 * @param ctx.totals  fetchReportTotals() result, or null if it couldn't be loaded
 */
export function reportKudos({ report, lk, deaths, totals }) {
  const kudos = [];
  const fights = report.fights || [];
  const pullsFor = new Map();
  for (const f of fights) for (const id of raidPlayers(f, lk)) pullsFor.set(id, (pullsFor.get(id) || 0) + 1);
  const died = new Set(deaths.map((d) => d.targetID));
  const busiestNight = Math.max(0, ...pullsFor.values());

  // Only count raiders who were there for most of the night, so a late sub doesn't win by default.
  const regulars = [...pullsFor.entries()].filter(([, n]) => n >= Math.ceil(busiestNight * 0.75)).map(([id]) => id);
  const deathless = regulars.filter((id) => !died.has(id));
  if (deathless.length) kudos.push({ icon: '♥', title: 'Never died', pids: deathless, text: 'Not one death all night' });

  const wipes = fights.filter((f) => !f.kill);
  const lastCounts = new Map();
  for (const f of wipes) {
    const fd = deaths.filter((d) => d.fight === f.id);
    const dead = new Set(fd.map((d) => d.targetID));
    const alive = raidPlayers(f, lk).filter((id) => !dead.has(id));
    const last = alive.length ? alive : fd.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1).map((d) => d.targetID);
    if (last.length <= 3) for (const id of last) lastCounts.set(id, (lastCounts.get(id) || 0) + 1);
  }
  const survivor = top([...lastCounts.entries()].map(([id, n]) => ({ id, n })), (x) => x.n);
  if (survivor && survivor.n >= 2) kudos.push({ icon: '⚑', title: 'Last standing most often', pids: [survivor.id], text: `${survivor.n} of ${plural(wipes.length, 'wipe')}` });

  if (totals) {
    const dmg = top(totals.damage?.entries || [], (e) => (lk.isPlayer(e.id) ? e.total : 0));
    if (dmg) kudos.push({ icon: '⚔', title: 'Most damage tonight', pids: [dmg.id], text: fmtNum(dmg.total) });
    const heal = top(totals.healing?.entries || [], (e) => (lk.isPlayer(e.id) ? e.total : 0));
    if (heal) kudos.push({ icon: '✚', title: 'Most healing tonight', pids: [heal.id], text: fmtNum(heal.total) });
    const kicks = utility(totals.interrupts || [], 'interrupt', lk)[0];
    if (kicks) kudos.push({ icon: '✋', title: 'Most interrupts tonight', pids: [kicks.pid], text: plural(kicks.count, 'interrupt') });
    const dispels = utility(totals.dispels || [], 'dispel', lk)[0];
    if (dispels) kudos.push({ icon: '✧', title: 'Most dispels tonight', pids: [dispels.pid], text: plural(dispels.count, 'dispel') });
  }
  return kudos;
}
