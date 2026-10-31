// Guild synopsis across many reports: progression, raid-night trends and attendance. Pure, like analysis.js.
import { fmtTime, fmtDuration, fmtPct, fmtDay, remainingPct } from './analysis.js';

const fmtDate = (ms) => fmtDay(ms);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * @param reports  [{ code, title, startTime, endTime, zone: { id, name }, fights: [{ id, encounterID, name, kill,
 *                   bossPercentage, fightPercentage, startTime, endTime, difficulty, size }] }] — fight times are relative to the report.
 * @param opts.difficultyNames  Map "zoneId:difficultyId" → name, from fetchZoneInfo().
 * @param opts.zoneEncounters   Map zoneId → [{ id, name }], every boss in each raid, from fetchZoneInfo().
 * @param opts.topOnly          Only count each boss at its top size and difficulty: 25-player when the guild has pulled
 *                              it at 25 (else 10), then the highest difficulty pulled at that size. Raid-night totals
 *                              still count every pull.
 */
export function summarizeGuild(reports, { difficultyNames = new Map(), zoneEncounters = new Map(), topOnly = false } = {}) {
  const sorted = [...reports].sort((a, b) => a.startTime - b.startTime);

  const top = new Map();
  for (const r of sorted) {
    for (const f of r.fights || []) {
      if (!f.encounterID) continue;
      const t = top.get(f.encounterID);
      const size = f.size ?? 0;
      const diff = f.difficulty ?? 0;
      if (!t || size > t.size || (size === t.size && diff > t.difficulty)) top.set(f.encounterID, { size, difficulty: diff });
    }
  }
  const counts = (f) => {
    if (!topOnly) return true;
    const t = top.get(f.encounterID);
    return (f.size ?? 0) === t.size && (f.difficulty ?? 0) === t.difficulty;
  };

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
      if (!f.encounterID || !counts(f)) continue;
      // 10- and 25-player are separate lockouts in MoP, so size is part of what makes a boss row.
      const key = `${f.encounterID}:${f.difficulty ?? ''}:${f.size ?? ''}`;
      if (!bosses.has(key)) {
        bosses.set(key, {
          key, encounterID: f.encounterID, name: f.name, difficulty: f.difficulty ?? null, size: f.size ?? null,
          zoneId: r.zone?.id ?? null, zone: r.zone?.name || 'Other',
          firstSeen: r.startTime + f.startTime, lastSeen: 0, pulls: 0, wipes: 0, wipesBeforeKill: 0, bestWipe: null, kills: [], nights: new Set(), attempts: [],
        });
      }
      const b = bosses.get(key);
      b.pulls++;
      b.nights.add(r.code);
      const at = r.startTime + f.startTime;
      b.lastSeen = Math.max(b.lastSeen, at);
      b.attempts.push({ at, pct: remainingPct(f), kill: !!f.kill, code: r.code, fightId: f.id, duration: f.endTime - f.startTime });
      if (f.kill) {
        if (!b.kills.length) nights[ri].newKills.push(key);
        b.kills.push({ at, duration: f.endTime - f.startTime, code: r.code, fightId: f.id });
      } else {
        b.wipes++;
        if (!b.kills.length) {
          b.wipesBeforeKill++;
          const pct = remainingPct(f);
          if (pct != null && (b.bestWipe == null || pct < b.bestWipe.pct)) {
            b.bestWipe = { pct, code: r.code, fightId: f.id };
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
    // "Heroic · 25-player", shown beside the boss when only its top difficulty is counted.
    const diffName = b.difficulty != null ? difficultyNames.get(`${b.zoneId}:${b.difficulty}`) : null;
    const variant = [diffName, b.size && !(diffName || '').includes(String(b.size)) ? `${b.size}-player` : null].filter(Boolean).join(' · ');
    return {
      ...b,
      nights: b.nights.size,
      label,
      variant,
      firstKill: b.kills[0] || null,
      lastKill: b.kills[b.kills.length - 1] || null,
      fastest,
    };
  });

  const labelOf = new Map(bossList.map((b) => [b.key, b.label]));
  for (const n of nights) n.newKills = n.newKills.map((key) => labelOf.get(key));

  // A report has one zone even when the night covered two raids. When the site's boss lists are known, a boss
  // goes in the raid that lists it; otherwise in the raid where it was first seen, and its other variants follow.
  const zoneNames = new Map(sorted.filter((r) => r.zone?.id != null).map((r) => [r.zone.id, r.zone.name]));
  const listedIn = new Map();
  for (const [zoneId, list] of zoneEncounters) for (const e of list) listedIn.set(e.id, zoneId);
  const homeZone = new Map();
  for (const b of [...bossList].sort((a, c) => a.firstSeen - c.firstSeen)) {
    if (!homeZone.has(b.encounterID)) {
      const listed = listedIn.get(b.encounterID);
      homeZone.set(b.encounterID, listed != null && zoneNames.has(listed)
        ? { zone: zoneNames.get(listed), zoneId: listed } : { zone: b.zone, zoneId: b.zoneId });
    }
    Object.assign(b, homeZone.get(b.encounterID));
  }
  const raidMap = new Map();
  for (const b of [...bossList].sort((a, c) => a.firstSeen - c.firstSeen)) {
    if (!raidMap.has(b.zone)) raidMap.set(b.zone, { name: b.zone, zoneId: b.zoneId, bosses: [] });
    raidMap.get(b.zone).bosses.push(b);
  }
  const raids = [...raidMap.values()].map((r) => ({ ...r, killed: r.bosses.filter((b) => b.kills.length).length }));

  const progress = raidProgress(raids, zoneEncounters);
  return { nights, bosses: bossList, raids, progress, takeaways: guildTakeaways(nights, bossList, progress) };
}

/**
 * One entry per raid with every boss once (all difficulties and sizes merged), in the raid's own order when
 * the site's boss list is known: { name, zoneId, killed, total, cleared, bosses: [{ id, name, killed, kills,
 * firstKill, bestWipe, pulls }] }.
 */
function raidProgress(raids, zoneEncounters) {
  return raids.map((raid) => {
    const byEncounter = new Map();
    for (const b of raid.bosses) {
      const e = byEncounter.get(b.encounterID) || { id: b.encounterID, name: b.name, variant: b.variant, kills: 0, pulls: 0, firstKill: null, bestWipe: null };
      e.kills += b.kills.length;
      e.pulls += b.pulls;
      if (b.firstKill && (!e.firstKill || b.firstKill.at < e.firstKill.at)) e.firstKill = b.firstKill;
      if (b.bestWipe && (!e.bestWipe || b.bestWipe.pct < e.bestWipe.pct)) e.bestWipe = b.bestWipe;
      byEncounter.set(b.encounterID, e);
    }
    const listed = zoneEncounters.get(raid.zoneId);
    const bosses = (listed?.length ? listed : [...byEncounter.values()])
      .map((e) => byEncounter.get(e.id) || { id: e.id, name: e.name, kills: 0, pulls: 0, firstKill: null, bestWipe: null })
      .map((e) => ({ ...e, killed: e.kills > 0 }));
    const killed = bosses.filter((b) => b.killed).length;
    const lastSeen = Math.max(0, ...raid.bosses.map((b) => b.lastSeen));
    return { name: raid.name, zoneId: raid.zoneId, bosses, killed, total: bosses.length, cleared: bosses.length > 0 && killed === bosses.length, lastSeen };
  });
}

/**
 * Raid progress grouped by expansion, newest expansion first and the most recently raided raid first within it.
 * @param expansions  Map zoneId → { id, name } (fetchZoneExpansions); raids without one go under "Raids".
 */
export function groupByExpansion(progress, expansions = new Map()) {
  const groups = new Map();
  for (const raid of progress) {
    const exp = expansions.get(raid.zoneId) || { id: -1, name: 'Raids' };
    if (!groups.has(exp.name)) groups.set(exp.name, { ...exp, raids: [], lastSeen: 0 });
    const g = groups.get(exp.name);
    g.raids.push(raid);
    g.lastSeen = Math.max(g.lastSeen, raid.lastSeen || 0);
  }
  for (const g of groups.values()) g.raids.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return [...groups.values()].sort((a, b) => b.id - a.id || b.lastSeen - a.lastSeen);
}

/**
 * Guild-wide figures for the tiles above the latest-tier summary.
 * @param list      every report in the guild's history (no fights needed)
 * @param progress  raid progress across all loaded reports
 */
export function guildTotals(list, progress, capped = false) {
  const times = list.map((r) => r.startTime).filter(Number.isFinite);
  return {
    nights: list.length,
    capped,
    since: times.length ? Math.min(...times) : null,
    raids: progress.length,
    cleared: progress.filter((r) => r.cleared).length,
    bossesKilled: progress.reduce((n, r) => n + r.killed, 0),
  };
}

function guildTakeaways(nights, bosses, progress) {
  const out = [];
  if (!nights.length) return out;
  const killed = bosses.filter((b) => b.kills.length);
  const bossTime = nights.reduce((t, n) => t + n.bossTime, 0);
  // Count each boss once across difficulties, against every boss in the raids when the site listed them.
  const totalBosses = progress.reduce((n, r) => n + r.total, 0);
  const killedBosses = progress.reduce((n, r) => n + r.killed, 0);
  const cleared = progress.filter((r) => r.cleared).map((r) => r.name);
  out.push(`${plural(nights.length, 'raid night')} since ${fmtDate(nights[0].startTime)}: ${killedBosses} of ${plural(totalBosses, 'boss', 'bosses')} killed, ${fmtDuration(bossTime)} in boss fights.`);
  if (cleared.length) out.push(`Cleared: ${cleared.join(', ')}.`);

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

const RECENT_RAIDS = 3;

/**
 * Roster: the guild's members merged with who actually raided.
 * @param attendance  guild.attendance data (newest first), or null
 * @param roster      fetchGuildMembers() result { members, classNames }, or null when the site won't share it
 * Status: 'raiding' (in one of the last 3 raids), 'lapsed' (raided earlier in the window only),
 *         'idle' (member with no raids in the window); `member` is false for raiders not on the member list.
 */
export function buildRoster(attendance, roster) {
  const nights = [...(attendance || [])].sort((a, b) => b.startTime - a.startTime);
  const recent = new Set(nights.slice(0, RECENT_RAIDS).map((n) => n.code));
  const att = summarizeAttendance(nights);
  const byName = new Map();

  for (const m of roster?.members || []) {
    byName.set(m.name, {
      name: m.name, className: roster.classNames.get(m.classID) || '', rank: m.guildRank ?? null, level: m.level ?? null,
      member: true, present: 0, benched: 0, pct: 0, span: 0, lastRaid: null, status: 'idle',
    });
  }
  for (const p of att.rows) {
    const row = byName.get(p.name) || { name: p.name, className: p.type, rank: null, level: null, member: !roster, status: 'idle' };
    Object.assign(row, { className: row.className || p.type, present: p.present, benched: p.benched, pct: p.pct, span: p.span });
    byName.set(p.name, row);
  }
  for (const n of nights) {
    for (const p of n.players || []) {
      if (p.presence !== 1 && p.presence !== 2) continue;
      const row = byName.get(p.name);
      if (!row.lastRaid || n.startTime > row.lastRaid) row.lastRaid = n.startTime;
      row.status = recent.has(n.code) ? 'raiding' : row.status === 'raiding' ? 'raiding' : 'lapsed';
    }
  }

  const order = { raiding: 0, lapsed: 1, idle: 2 };
  const rows = [...byName.values()].sort((a, b) => order[a.status] - order[b.status] || b.pct - a.pct
    || (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));

  const composition = new Map();
  for (const r of rows) if (r.status === 'raiding') composition.set(r.className, (composition.get(r.className) || 0) + 1);

  return {
    rows,
    total: att.total,
    hasMembers: !!roster,
    counts: {
      members: rows.filter((r) => r.member).length,
      raiding: rows.filter((r) => r.status === 'raiding').length,
      lapsed: rows.filter((r) => r.status === 'lapsed').length,
      idle: rows.filter((r) => r.status === 'idle').length,
      outsiders: roster ? rows.filter((r) => !r.member).length : 0,
    },
    composition: [...composition.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/**
 * The current raid team grouped by role: everyone 'raiding' in the roster, with the role and spec they played
 * most often in the latest reports. Players never seen in those reports go under `unknown`.
 * @param roster     buildRoster() result
 * @param sightings  fetchTeamSpecs() result: [{ name, role, className, spec }]
 */
export function buildRaidTeam(roster, sightings) {
  const seen = new Map();
  for (const s of sightings) {
    if (!seen.has(s.name)) seen.set(s.name, new Map());
    const key = `${s.role}|${s.spec || ''}`;
    const tally = seen.get(s.name);
    tally.set(key, { ...s, n: (tally.get(key)?.n || 0) + 1 });
  }
  const team = { tank: [], healer: [], dps: [], unknown: [] };
  for (const p of roster.rows.filter((r) => r.status === 'raiding')) {
    const best = [...(seen.get(p.name)?.values() || [])].sort((a, b) => b.n - a.n)[0];
    const member = { name: p.name, className: best?.className || p.className, spec: best?.spec || null, pct: p.pct };
    team[best ? best.role : 'unknown'].push(member);
  }
  for (const list of Object.values(team)) list.sort((a, b) => (a.className || '').localeCompare(b.className || '') || a.name.localeCompare(b.name));
  return team;
}

/**
 * @param attendance  guild.attendance data: [{ code, startTime, players: [{ name, type, presence }] }]
 *                    presence 1 = in the raid, 2 = benched; anything else counts as absent.
 * Attendance is counted from each player's first raid (`span` raids), so over a long history someone who
 * joined recently isn't marked down for raids before their time.
 */
export function summarizeAttendance(attendance) {
  const nights = [...(attendance || [])].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  const players = new Map();
  nights.forEach((night, i) => {
    for (const p of night.players || []) {
      if (!players.has(p.name)) players.set(p.name, { name: p.name, type: p.type, present: 0, benched: 0, first: null });
      const row = players.get(p.name);
      if (p.presence === 1) row.present++;
      else if (p.presence === 2) row.benched++;
      if ((p.presence === 1 || p.presence === 2) && row.first == null) row.first = i;
    }
  });
  const total = nights.length;
  const rows = [...players.values()]
    .map(({ first, ...p }) => {
      const span = first == null ? 0 : total - first;
      return { ...p, span, pct: span ? (p.present + p.benched) / span : 0 };
    })
    .sort((a, b) => b.pct - a.pct || b.present - a.present || a.name.localeCompare(b.name));
  return { total, rows };
}
