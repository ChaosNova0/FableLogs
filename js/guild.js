// Guild synopsis across many reports: progression, raid-night trends and attendance. Pure, like analysis.js.
import { fmtTime, fmtDuration, fmtPct } from './analysis.js';

const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * @param reports  [{ code, title, startTime, endTime, zone: { id, name }, fights: [{ id, encounterID, name, kill,
 *                   bossPercentage, startTime, endTime, difficulty, size }] }] — fight times are relative to the report.
 * @param opts.difficultyNames  Map "zoneId:difficultyId" → name, from fetchDifficultyNames().
 */
export function summarizeGuild(reports, { difficultyNames = new Map() } = {}) {
  const sorted = [...reports].sort((a, b) => a.startTime - b.startTime);

  const nights = sorted.map((r) => {
    const fights = (r.fights || []).filter((f) => f.encounterID);
    const kills = fights.filter((f) => f.kill);
    return {
      code: r.code,
      title: r.title,
      startTime: r.startTime,
      zone: r.zone?.name || '',
      pulls: fights.length,
      kills: kills.length,
      wipes: fights.length - kills.length,
      bossTime: fights.reduce((t, f) => t + (f.endTime - f.startTime), 0),
      killNames: [...new Set(kills.map((f) => f.name))],
      newKills: [],
    };
  });

  const bosses = new Map();
  sorted.forEach((r, ri) => {
    for (const f of r.fights || []) {
      if (!f.encounterID) continue;
      // 10- and 25-player are separate lockouts in MoP, so size is part of what makes a boss row.
      const key = `${f.encounterID}:${f.difficulty ?? ''}:${f.size ?? ''}`;
      if (!bosses.has(key)) {
        bosses.set(key, {
          key, encounterID: f.encounterID, name: f.name, difficulty: f.difficulty ?? null, size: f.size ?? null,
          zoneId: r.zone?.id ?? null, zone: r.zone?.name || 'Other',
          firstSeen: r.startTime + f.startTime, pulls: 0, wipes: 0, wipesBeforeKill: 0, bestWipe: null, kills: [], nights: new Set(),
        });
      }
      const b = bosses.get(key);
      b.pulls++;
      b.nights.add(r.code);
      const at = r.startTime + f.startTime;
      if (f.kill) {
        if (!b.kills.length) nights[ri].newKills.push(key);
        b.kills.push({ at, duration: f.endTime - f.startTime, code: r.code, fightId: f.id });
      } else {
        b.wipes++;
        if (!b.kills.length) {
          b.wipesBeforeKill++;
          if (f.bossPercentage != null && (b.bestWipe == null || f.bossPercentage < b.bestWipe.pct)) {
            b.bestWipe = { pct: f.bossPercentage, code: r.code, fightId: f.id };
          }
        }
      }
    }
  });

  // A boss done on more than one difficulty or size gets a label so the rows can be told apart.
  const variants = new Map();
  for (const b of bosses.values()) {
    if (!variants.has(b.name)) variants.set(b.name, []);
    variants.get(b.name).push(b);
  }

  const bossList = [...bosses.values()].map((b) => {
    const fastest = b.kills.reduce((best, k) => (!best || k.duration < best.duration ? k : best), null);
    const siblings = variants.get(b.name);
    let label = b.name;
    if (siblings.length > 1) {
      const parts = [];
      if (new Set(siblings.map((s) => s.difficulty)).size > 1 && b.difficulty != null) {
        parts.push(difficultyNames.get(`${b.zoneId}:${b.difficulty}`) || `difficulty ${b.difficulty}`);
      }
      // Some sites already name difficulties by size ("25 Player (Heroic)"), so don't repeat it.
      if (new Set(siblings.map((s) => s.size)).size > 1 && b.size && !parts.some((p) => p.includes(String(b.size)))) {
        parts.push(`${b.size}-player`);
      }
      if (parts.length) label = `${b.name} (${parts.join(', ')})`;
    }
    return {
      ...b,
      nights: b.nights.size,
      label,
      firstKill: b.kills[0] || null,
      lastKill: b.kills[b.kills.length - 1] || null,
      fastest,
    };
  });

  const labelOf = new Map(bossList.map((b) => [b.key, b.label]));
  for (const n of nights) n.newKills = n.newKills.map((key) => labelOf.get(key));

  // A report has one zone even when the night covered two raids, so a boss goes in the raid where that
  // encounter was first seen, and later variants (e.g. its heroic) follow it there.
  const homeZone = new Map();
  for (const b of [...bossList].sort((a, c) => a.firstSeen - c.firstSeen)) {
    if (!homeZone.has(b.encounterID)) homeZone.set(b.encounterID, b.zone);
    b.zone = homeZone.get(b.encounterID);
  }
  const raidMap = new Map();
  for (const b of [...bossList].sort((a, c) => a.firstSeen - c.firstSeen)) {
    if (!raidMap.has(b.zone)) raidMap.set(b.zone, { name: b.zone, bosses: [] });
    raidMap.get(b.zone).bosses.push(b);
  }
  const raids = [...raidMap.values()].map((r) => ({ ...r, killed: r.bosses.filter((b) => b.kills.length).length }));

  return { nights, bosses: bossList, raids, takeaways: guildTakeaways(nights, bossList) };
}

function guildTakeaways(nights, bosses) {
  const out = [];
  if (!nights.length) return out;
  const killed = bosses.filter((b) => b.kills.length);
  const bossTime = nights.reduce((t, n) => t + n.bossTime, 0);
  out.push(`${plural(nights.length, 'raid night')} since ${fmtDate(nights[0].startTime)}: ${killed.length} of ${plural(bosses.length, 'boss', 'bosses')} killed, ${fmtDuration(bossTime)} in boss fights.`);

  const latest = nights[nights.length - 1];
  if (latest.newKills.length) out.push(`First kills on the latest night (${fmtDate(latest.startTime)}): ${latest.newKills.join(', ')}.`);

  const progressing = bosses.filter((b) => !b.kills.length).sort((a, c) => c.pulls - a.pulls);
  for (const b of progressing.slice(0, 2)) {
    out.push(`Still working on ${b.label}: ${plural(b.pulls, 'pull')} over ${plural(b.nights, 'night')}${b.bestWipe ? `, best attempt at ${fmtPct(b.bestWipe.pct)}` : ''}.`);
  }

  // Compare the older half of the nights with the newer half.
  if (nights.length >= 4) {
    const half = Math.floor(nights.length / 2);
    const avg = (list) => list.reduce((t, n) => t + n.wipes, 0) / list.length;
    const before = avg(nights.slice(0, half));
    const after = avg(nights.slice(nights.length - half));
    if (after < before * 0.8) out.push(`Wipes per night are down: ${before.toFixed(1)} → ${after.toFixed(1)} on average.`);
    else if (after > before * 1.25 && after - before >= 1) out.push(`Wipes per night are up: ${before.toFixed(1)} → ${after.toFixed(1)} on average. New progression bosses usually explain this.`);
  }

  const faster = killed.filter((b) => b.kills.length >= 2)
    .map((b) => ({ b, first: b.kills[0].duration, last: b.lastKill.duration }))
    .filter((x) => x.last < x.first * 0.9)
    .sort((a, c) => (c.first - c.last) - (a.first - a.last));
  if (faster.length) {
    out.push(`Kills getting faster: ${faster.slice(0, 3).map((x) => `${x.b.label} ${fmtTime(x.first)} → ${fmtTime(x.last)}`).join(', ')}.`);
  }

  const onePull = killed.filter((b) => b.kills.length >= 2 && b.wipes === 0);
  if (onePull.length) out.push(`On farm with no wipes: ${onePull.map((b) => b.label).join(', ')}.`);
  return out;
}

/**
 * @param attendance  guild.attendance data: [{ code, startTime, players: [{ name, type, presence }] }]
 *                    presence 1 = in the raid, 2 = benched; anything else counts as absent.
 */
export function summarizeAttendance(attendance) {
  const nights = attendance || [];
  const players = new Map();
  for (const night of nights) {
    for (const p of night.players || []) {
      if (!players.has(p.name)) players.set(p.name, { name: p.name, type: p.type, present: 0, benched: 0 });
      const row = players.get(p.name);
      if (p.presence === 1) row.present++;
      else if (p.presence === 2) row.benched++;
    }
  }
  const total = nights.length;
  const rows = [...players.values()]
    .map((p) => ({ ...p, pct: total ? (p.present + p.benched) / total : 0 }))
    .sort((a, b) => b.pct - a.pct || b.present - a.present || a.name.localeCompare(b.name));
  return { total, rows };
}
