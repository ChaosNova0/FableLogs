// Guild synopsis across many reports: progression, raid-night trends and attendance. Pure, like analysis.js.
import { fmtTime, fmtDuration, fmtPct } from './analysis.js';

const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * @param reports  [{ code, title, startTime, endTime, zone: { id, name }, fights: [{ id, encounterID, name, kill,
 *                   bossPercentage, startTime, endTime, difficulty, size }] }] — fight times are relative to the report.
 * @param opts.difficultyNames  Map "zoneId:difficultyId" → name, from fetchZoneInfo().
 * @param opts.zoneEncounters   Map zoneId → [{ id, name }], every boss in each raid, from fetchZoneInfo().
 */
export function summarizeGuild(reports, { difficultyNames = new Map(), zoneEncounters = new Map() } = {}) {
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
          firstSeen: r.startTime + f.startTime, pulls: 0, wipes: 0, wipesBeforeKill: 0, bestWipe: null, kills: [], nights: new Set(), nightTimes: new Set(),
        });
      }
      const b = bosses.get(key);
      b.pulls++;
      b.nights.add(r.code);
      b.nightTimes.add(r.startTime);
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
      nightTimes: [...b.nightTimes],
      label,
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

  const progress = raidProgress(raids, zoneEncounters, nights.length ? nights[nights.length - 1].startTime : null);
  return { nights, bosses: bossList, raids, progress, takeaways: guildTakeaways(nights, bossList, progress) };
}

/**
 * One entry per raid with every boss once (all difficulties and sizes merged), in the raid's own order when
 * the site's boss list is known: { name, zoneId, killed, total, cleared, start, end, nights, bosses: [{ id, name,
 * killed, kills, firstKill, bestWipe, pulls }] }. start..end spans the raid's first night to the guild's latest
 * night, and nights are the dates the raid was pulled, for drawing it as a timeline.
 */
function raidProgress(raids, zoneEncounters, latestNight) {
  return raids.map((raid) => {
    const nights = [...new Set(raid.bosses.flatMap((b) => b.nightTimes))].sort((a, b) => a - b);
    const start = nights[0] ?? null;
    const end = Math.max(latestNight ?? 0, nights[nights.length - 1] ?? 0) || null;
    const byEncounter = new Map();
    for (const b of raid.bosses) {
      const e = byEncounter.get(b.encounterID) || { id: b.encounterID, name: b.name, kills: 0, pulls: 0, firstKill: null, bestWipe: null };
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
    return {
      name: raid.name, zoneId: raid.zoneId, bosses, killed, total: bosses.length,
      cleared: bosses.length > 0 && killed === bosses.length, start, end, nights,
    };
  });
}

/**
 * Places first kills along a raid's timeline. Returns [{ boss, pct, lane }] in date order: pct is 0-100 along the
 * line, and kills closer than minGap (in %) to an earlier one in the same lane drop to the next lane down.
 */
export function layoutTimeline(raid, minGap = 14) {
  const span = raid.end != null && raid.start != null ? raid.end - raid.start : 0;
  const lanes = [];
  return raid.bosses.filter((b) => b.killed)
    .sort((a, b) => a.firstKill.at - b.firstKill.at)
    .map((boss) => {
      // Keep markers off the very ends so portraits and labels aren't clipped.
      const raw = span > 0 ? ((boss.firstKill.at - raid.start) / span) * 100 : 50;
      const pct = Math.min(94, Math.max(6, raw));
      let lane = lanes.findIndex((last) => pct - last >= minGap);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = pct;
      return { boss, pct, lane };
    });
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
      member: true, present: 0, benched: 0, pct: 0, lastRaid: null, status: 'idle',
    });
  }
  for (const p of att.rows) {
    const row = byName.get(p.name) || { name: p.name, className: p.type, rank: null, level: null, member: !roster, status: 'idle' };
    Object.assign(row, { className: row.className || p.type, present: p.present, benched: p.benched, pct: p.pct });
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
