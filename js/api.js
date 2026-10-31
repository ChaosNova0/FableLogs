// Warcraft Logs v2 GraphQL access: link parsing, cached queries, and the fetches the views need.
import { CONFIG } from './config.js';
import { getToken, logout } from './auth.js';
import { cache } from './store.js';
import { POTION_NAMES } from './mop.js';
import { RAID_BUFF_NAMES } from './buffs.js';

export class AuthError extends Error {}

const DEATH_WINDOW_MS = 10_000;
const WINDOWS_PER_QUERY = 8;

let rateListener = () => {};
let lastRate = null;
export function onRateLimit(fn) { rateListener = fn; }

export class RateLimitError extends Error {}

// Accepts a full report URL (any *.warcraftlogs.com site) or a bare report code.
export function parseReportLink(input) {
  const s = String(input || '').trim();
  const url = s.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)?warcraftlogs\.com)\/reports\/([A-Za-z0-9]+)(.*)$/i);
  if (url) {
    const host = normalizeHost(url[1]);
    const fight = (url[3].match(/[?#&]fight=(\d+)/) || [])[1];
    return { host, code: url[2], fight: fight ? Number(fight) : null };
  }
  if (/^[A-Za-z0-9]{16}$/.test(s)) return { host: CONFIG.defaultHost, code: s, fight: null };
  return null;
}

const normalizeHost = (h) => (h.toLowerCase().startsWith('warcraftlogs') ? `www.${h.toLowerCase()}` : h.toLowerCase());

// Guild pages: /guild/id/123, /guild/reports-list/123 (and other tabs), or /guild/us/server-slug/Guild%20Name.
export function parseGuildLink(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)?warcraftlogs\.com)\/guilds?\/(?:[a-z-]+\/(\d+)(?:[/?#]|$)|([a-z]{2,4})\/([^/?#]+)\/([^/?#]+))/i);
  if (!m) return null;
  const host = normalizeHost(m[1]);
  if (m[2]) return { host, guild: { id: Number(m[2]) } };
  let name = m[5];
  try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* keep as typed */ }
  return { host, guild: { region: m[3].toLowerCase(), server: m[4].toLowerCase(), name } };
}

// A report or guild link, tagged with its kind.
export function parseLink(input) {
  const report = parseReportLink(input);
  if (report) return { kind: 'report', ...report };
  const guild = parseGuildLink(input);
  return guild ? { kind: 'guild', ...guild } : null;
}

// The token is only ever sent to Warcraft Logs hosts, and links only ever point at them.
export function isAllowedHost(host) {
  return /^([a-z0-9-]+\.)?warcraftlogs\.com$/.test(host);
}

export async function gql(host, query, variables = {}, { cacheKey } = {}) {
  if (cacheKey) {
    const hit = await cache.get(cacheKey);
    if (hit !== undefined) return hit;
  }
  if (!isAllowedHost(host)) throw new Error(`Not a Warcraft Logs host: ${host}`);
  const token = getToken();
  if (!token) throw new AuthError('Connect your Warcraft Logs account to load reports.');

  const res = await fetch(`https://${host}/api/v2/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { logout(); throw new AuthError('Your Warcraft Logs login expired. Connect again.'); }
  if (res.status === 429) {
    const mins = lastRate ? Math.ceil(lastRate.pointsResetIn / 60) : null;
    throw new RateLimitError(`Your Warcraft Logs API budget for this hour is used up${mins ? `. It resets in about ${mins} minute${mins === 1 ? '' : 's'}` : ''}. `
      + 'Anything already loaded is cached, so pages you have seen will still open.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Warcraft Logs request failed (${res.status}).`);
  if (body.errors?.length && !body.data) throw new Error(body.errors.map((e) => e.message).join('; '));

  if (body.data?.rateLimitData) {
    lastRate = body.data.rateLimitData;
    rateListener(lastRate);
  }
  const result = { data: body.data, errors: body.errors || [] };
  if (cacheKey && !result.errors.length) await cache.set(cacheKey, result);
  return result;
}

const RATE_FIELDS = 'rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }';

export async function fetchRateLimit(host) {
  return gql(host, `{ ${RATE_FIELDS} }`);
}

export async function fetchReport(host, code) {
  const query = `query ($code: String!) {
    ${RATE_FIELDS}
    reportData { report(code: $code) {
      code title startTime endTime
      zone { id name }
      owner { name }
      guild { name server { name } }
      fights(killType: Encounters) {
        id encounterID name kill startTime endTime difficulty size
        bossPercentage fightPercentage friendlyPlayers
      }
      masterData {
        actors { id gameID name type subType server petOwner }
        abilities { gameID name icon type }
      }
    } }
  }`;
  const { data } = await gql(host, query, { code }, { cacheKey: `${code}:report` });
  const report = data?.reportData?.report;
  if (!report) throw new Error('Report not found, or it is private to an account you are not logged in as.');
  return report;
}

// Follows nextPageTimestamp until a single events() field is exhausted.
async function fetchAllEvents(host, code, args, cacheKey) {
  const hit = await cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const all = [];
  let startTime = args.startTime;
  for (let page = 0; page < 50; page++) {
    const argList = Object.entries({ ...args, startTime })
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${k === 'dataType' || k === 'hostilityType' ? v : JSON.stringify(v)}`)
      .join(', ');
    const { data } = await gql(host, `query ($code: String!) { reportData { report(code: $code) {
      events(${argList}, limit: 10000) { data nextPageTimestamp }
    } } }`, { code });
    const ev = data.reportData.report.events;
    all.push(...(ev.data || []));
    if (!ev.nextPageTimestamp) break;
    startTime = ev.nextPageTimestamp;
  }
  await cache.set(cacheKey, all);
  return all;
}

export function fetchDeaths(host, code, fightIDs) {
  return fetchAllEvents(host, code, { dataType: 'Deaths', fightIDs }, `${code}:deaths:${fightIDs.join(',')}`);
}

// Everything a single-fight page needs besides death windows. Fields that fail come back null with an error.
export async function fetchFightDetail(host, code, fight) {
  const potionFilter = `ability.name in (${POTION_NAMES.map((n) => JSON.stringify(n)).join(', ')})`;
  const query = `query ($code: String!, $f: [Int]!, $pf: String!) { reportData { report(code: $code) {
    combatants: events(dataType: CombatantInfo, fightIDs: $f, limit: 10000) { data }
    interrupts: events(dataType: Interrupts, fightIDs: $f, limit: 10000) { data }
    dispels: events(dataType: Dispels, fightIDs: $f, limit: 10000) { data }
    potions: events(dataType: Casts, fightIDs: $f, filterExpression: $pf, limit: 10000) { data }
    damage: table(dataType: DamageDone, fightIDs: $f)
    healing: table(dataType: Healing, fightIDs: $f)
  } } }`;
  const { data, errors } = await gql(host, query, { code, f: [fight.id], pf: potionFilter }, { cacheKey: `${code}:fight:${fight.id}` });
  const r = data?.reportData?.report || {};
  const failed = (field) => errors.find((e) => e.path?.includes(field))?.message;
  return {
    combatants: r.combatants?.data || [],
    interrupts: r.interrupts?.data || [],
    dispels: r.dispels?.data || [],
    potions: r.potions?.data || [],
    damage: r.damage?.data ?? r.damage ?? null,
    healing: r.healing?.data ?? r.healing ?? null,
    errors: Object.fromEntries(['combatants', 'interrupts', 'dispels', 'potions', 'damage', 'healing']
      .map((f) => [f, failed(f)]).filter(([, m]) => m)),
  };
}

// ---------- guilds ----------

// Guild data changes as new logs come in, so its cache entries roll over every hour.
const hourBucket = () => Math.floor(Date.now() / 3_600_000);
export const guildCachePrefix = (id) => `guild-${id}`;

// Looks a guild up by id or by region/server/name. Returns { id, name, faction, server }.
export async function fetchGuild(host, ref) {
  const byId = ref.id != null;
  const { data } = await gql(host, `query ($id: Int, $name: String, $slug: String, $region: String) { ${RATE_FIELDS} guildData {
    guild(id: $id, name: $name, serverSlug: $slug, serverRegion: $region) {
      id name faction { name } server { name slug region { slug } }
    } } }`,
  byId ? { id: ref.id } : { name: ref.name, slug: ref.server, region: ref.region },
  { cacheKey: byId ? `${guildCachePrefix(ref.id)}:info` : `guild-${ref.region}-${ref.server}-${ref.name}:info` });
  const guild = data?.guildData?.guild;
  if (!guild) throw new Error('Guild not found on Warcraft Logs. Check the link, or whether the guild is on this site (classic, fresh, retail…).');
  return guild;
}

// The guild's report list is cheap (no fights), so it covers up to GUILD_MAX reports. Boss pulls are only loaded
// for the current raids (see fetchReportFights), which is where nearly all the API cost is.
const LIST_PAGE = 100;
export const GUILD_MAX = 400;

// The guild's reports, newest first, without fights: { reports, capped }.
export async function fetchGuildReportList(host, guildId) {
  const reports = [];
  let capped = false;
  for (let page = 1; ; page++) {
    const { data } = await gql(host, `query ($gid: Int!, $limit: Int, $page: Int) { ${page === 1 ? RATE_FIELDS : ''} reportData {
      reports(guildID: $gid, limit: $limit, page: $page) { data { code title startTime endTime zone { id name } } has_more_pages }
    } }`, { gid: guildId, limit: LIST_PAGE, page },
    { cacheKey: `${guildCachePrefix(guildId)}:list:p${page}:${hourBucket()}` });
    const list = data?.reportData?.reports;
    reports.push(...(list?.data || []));
    if (!list?.has_more_pages) break;
    if (reports.length >= GUILD_MAX) { capped = true; break; }
  }
  return { reports: reports.slice(0, GUILD_MAX), capped };
}

const FIGHTS_PER_QUERY = 10;
const SETTLED_MS = 24 * 3_600_000;

// Boss pulls for the given reports, as Map code → fights. Each report is cached on its own and, once it is a day
// old (logs don't change after that), kept for good, so a guild page only ever pays for new reports.
// budgetShare stops fetching once that share of the user's hourly API points is spent (their limit depends on
// their Warcraft Logs subscription), so history fills in over several visits rather than using it all up.
// Also stops early, returning what it has, if the budget runs out outright.
export async function fetchReportFights(host, reports, { budgetShare = 1 } = {}) {
  const out = new Map();
  const missing = [];
  for (const r of reports) {
    const hit = await cache.get(`fights:${host}:${r.code}`);
    if (hit !== undefined) out.set(r.code, hit);
    else missing.push(r);
  }
  for (let i = 0; i < missing.length; i += FIGHTS_PER_QUERY) {
    if (lastRate && lastRate.pointsSpentThisHour >= lastRate.limitPerHour * budgetShare) break;
    const batch = missing.slice(i, i + FIGHTS_PER_QUERY);
    const fields = batch.map((r, j) => `r${j}: report(code: ${JSON.stringify(String(r.code))}) {
      fights(killType: Encounters) { id encounterID name kill bossPercentage fightPercentage startTime endTime difficulty size } }`).join(' ');
    let data;
    try {
      ({ data } = await gql(host, `{ ${RATE_FIELDS} reportData { ${fields} } }`));
    } catch (err) {
      if (err instanceof RateLimitError && out.size) break;
      throw err;
    }
    for (const [j, r] of batch.entries()) {
      const fights = data?.reportData?.[`r${j}`]?.fights || [];
      out.set(r.code, fights);
      if (Date.now() - (r.endTime || r.startTime) > SETTLED_MS) await cache.set(`fights:${host}:${r.code}`, fights);
    }
  }
  return out;
}

// Per raid, straight from the site: difficulty names (the numbers differ between Warcraft Logs sites and the
// game client) and the full boss list, so bosses nobody has pulled yet still show up.
// Returns { difficultyNames: Map "zoneId:difficultyId" → name, encounters: Map zoneId → [{ id, name }] };
// both empty on failure.
export async function fetchZoneInfo(host, zoneIds) {
  const info = { difficultyNames: new Map(), encounters: new Map() };
  const ids = [...new Set(zoneIds.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ids.length) return info;
  try {
    const fields = ids.map((id) => `z${id}: zone(id: ${id}) { id difficulties { id name } encounters { id name } }`).join(' ');
    const { data } = await gql(host, `{ worldData { ${fields} } }`, {}, { cacheKey: `zoneinfo:${host}:${ids.join(',')}` });
    for (const zone of Object.values(data?.worldData || {})) {
      if (!zone) continue;
      for (const d of zone.difficulties || []) info.difficultyNames.set(`${zone.id}:${d.id}`, d.name);
      if (zone.encounters?.length) info.encounters.set(zone.id, zone.encounters);
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }
  return info;
}

// Role and spec per player from the guild's latest reports (Warcraft Logs' playerDetails), so the raid team can
// be shown by role. Returns [{ name, role: 'tank'|'healer'|'dps', className, spec }] per report sighting;
// empty on failure.
export async function fetchTeamSpecs(host, reports) {
  const recent = reports.slice(0, 3);
  if (!recent.length) return [];
  try {
    const fields = recent.map((r, i) => `r${i}: report(code: ${JSON.stringify(String(r.code))}) {
      playerDetails(startTime: 0, endTime: ${Math.max(0, Number(r.endTime) - Number(r.startTime)) || 1e9}) }`).join(' ');
    const { data } = await gql(host, `{ reportData { ${fields} } }`, {},
      { cacheKey: `team:${host}:${recent.map((r) => r.code).join(',')}` });
    const roles = { tanks: 'tank', healers: 'healer', dps: 'dps' };
    const out = [];
    for (const rep of Object.values(data?.reportData || {})) {
      const raw = rep?.playerDetails;
      const details = raw?.data?.playerDetails ?? raw?.playerDetails ?? raw ?? {};
      for (const [key, role] of Object.entries(roles)) {
        for (const p of details[key] || []) {
          const iconSpec = typeof p.icon === 'string' && p.icon.includes('-') ? p.icon.split('-')[1] : null;
          out.push({ name: p.name, role, className: p.type, spec: p.specs?.[0]?.spec ?? iconSpec });
        }
      }
    }
    return out;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return [];
  }
}

// Spec icon ("Mage-Frost"), or the class icon when the spec isn't known.
export const specIcon = (className, spec) => {
  const cls = String(className || '').replace(/\s+/g, '');
  const sp = String(spec || '').replace(/\s+/g, '');
  return `https://assets.rpglogs.com/img/warcraft/icons/${encodeURIComponent(sp ? `${cls}-${sp}` : cls)}.jpg`;
};

// Which expansion each raid belongs to, for grouping raid progress. Kept apart from fetchZoneInfo so that if the
// field isn't available, difficulties and boss lists still load. Returns Map zoneId → { id, name }; empty on failure.
export async function fetchZoneExpansions(host, zoneIds) {
  const ids = [...new Set(zoneIds.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  try {
    const fields = ids.map((id) => `z${id}: zone(id: ${id}) { id expansion { id name } }`).join(' ');
    const { data } = await gql(host, `{ worldData { ${fields} } }`, {}, { cacheKey: `zoneexp:${host}:${ids.join(',')}` });
    return new Map(Object.values(data?.worldData || {}).filter((z) => z?.expansion?.name).map((z) => [z.id, z.expansion]));
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return new Map();
  }
}

export const bossImage = (encounterId) => `https://assets.rpglogs.com/img/warcraft/bosses/${Number(encounterId)}-icon.jpg`;
export const zoneImage = (zoneId) => `https://assets.rpglogs.com/img/warcraft/zones/zone-${Number(zoneId)}.png`;

// The guild's member list plus the site's class names. Returns null when the site won't share members
// (e.g. unclaimed guilds), so the roster can fall back to who was seen in raids.
export async function fetchGuildMembers(host, guildId) {
  try {
    const members = [];
    let classes = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await gql(host, `query ($gid: Int!, $page: Int) {
        ${page === 1 ? 'gameData { classes { id name } }' : ''}
        guildData { guild(id: $gid) { members(limit: 100, page: $page) { data { id name guildRank classID level } has_more_pages } } }
      }`, { gid: guildId, page }, { cacheKey: `${guildCachePrefix(guildId)}:members:${page}:${hourBucket()}` });
      if (page === 1) classes = data?.gameData?.classes || [];
      const list = data?.guildData?.guild?.members;
      if (!list) return null;
      members.push(...(list.data || []));
      if (!list.has_more_pages) break;
    }
    return { members, classNames: new Map(classes.map((c) => [c.id, c.name])) };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}

// Warcraft Logs caps attendance at 25 raids per request, so larger windows are fetched a page at a time.
const ATTENDANCE_PAGE = 25;

// Attendance for the guild's last ATTENDANCE_MAX raids (about a year of raiding). Returns null rather than failing
// the page; if a later page fails, returns what it already has.
export const ATTENDANCE_MAX = 100;
export async function fetchGuildAttendance(host, guildId) {
  const all = [];
  try {
    for (let page = 1; all.length < ATTENDANCE_MAX; page++) {
      const { data } = await gql(host, `query ($gid: Int!, $limit: Int, $page: Int) { guildData { guild(id: $gid) {
        attendance(limit: $limit, page: $page) { data { code startTime zone { name } players { name type presence } } has_more_pages }
      } } }`, { gid: guildId, limit: ATTENDANCE_PAGE, page },
      { cacheKey: `${guildCachePrefix(guildId)}:attendance:p${page}:${hourBucket()}` });
      const list = data?.guildData?.guild?.attendance;
      if (!list) break;
      all.push(...(list.data || []));
      if (!list.has_more_pages) break;
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (!all.length) return null;
  }
  return all.length ? all.slice(0, ATTENDANCE_MAX) : null;
}

// Which raid each boss pull was in, for logs that cover more than one raid. Kept out of fetchReport so
// a schema difference here can't break the whole report: returns an empty Map on failure.
export async function fetchFightZones(host, code) {
  try {
    const { data } = await gql(host, `query ($code: String!) { reportData { report(code: $code) {
      fights(killType: Encounters) { id gameZone { id name } }
    } } }`, { code }, { cacheKey: `${code}:zones` });
    const fights = data?.reportData?.report?.fights || [];
    return new Map(fights.filter((f) => f.gameZone?.name).map((f) => [f.id, f.gameZone]));
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return new Map();
  }
}

// Night-wide totals for the report kudos. Returns null rather than failing the page.
export async function fetchReportTotals(host, code, fightIDs) {
  try {
    const { data } = await gql(host, `query ($code: String!, $f: [Int]!) { reportData { report(code: $code) {
      damage: table(dataType: DamageDone, fightIDs: $f)
      healing: table(dataType: Healing, fightIDs: $f)
      interrupts: events(dataType: Interrupts, fightIDs: $f, limit: 10000) { data }
      dispels: events(dataType: Dispels, fightIDs: $f, limit: 10000) { data }
    } } }`, { code, f: fightIDs }, { cacheKey: `${code}:totals:${fightIDs.join(',')}` });
    const r = data?.reportData?.report;
    if (!r) return null;
    return {
      damage: r.damage?.data ?? r.damage ?? null,
      healing: r.healing?.data ?? r.healing ?? null,
      interrupts: r.interrupts?.data || [],
      dispels: r.dispels?.data || [],
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}

// CombatantInfo (buffs and gear at each pull) and potion casts for the whole night. Null on failure.
export async function fetchReportPrep(host, code, fightIDs) {
  try {
    const pf = `ability.name in (${POTION_NAMES.map((n) => JSON.stringify(n)).join(', ')})`;
    const [combatants, potions] = await Promise.all([
      fetchAllEvents(host, code, { dataType: 'CombatantInfo', fightIDs }, `${code}:prep-ci:${fightIDs.join(',')}`),
      fetchAllEvents(host, code, { dataType: 'Casts', fightIDs, filterExpression: pf }, `${code}:prep-pots:${fightIDs.join(',')}`)
        .catch((err) => { if (err instanceof AuthError) throw err; return []; }),
    ]);
    return { combatants, potions };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}

// Damage and healing tables for every boss pull in one request (aliased per fight), for the player-across-the-
// night page. Returns Map fightId → { damage, healing }; empty on failure.
export async function fetchFightTables(host, code, fightIDs) {
  const ids = fightIDs.map(Number).filter(Number.isFinite);
  const out = new Map();
  if (!ids.length) return out;
  try {
    const fields = ids.map((id) => `d${id}: table(dataType: DamageDone, fightIDs: [${id}]) h${id}: table(dataType: Healing, fightIDs: [${id}])`).join(' ');
    const { data } = await gql(host, `query ($code: String!) { reportData { report(code: $code) { ${fields} } } }`, { code },
      { cacheKey: `${code}:fighttables:${ids.join(',')}` });
    const r = data?.reportData?.report || {};
    for (const id of ids) {
      out.set(id, { damage: r[`d${id}`]?.data ?? r[`d${id}`] ?? null, healing: r[`h${id}`]?.data ?? r[`h${id}`] ?? null });
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }
  return out;
}

export function fetchPlayerCasts(host, code, fight, pid) {
  return fetchAllEvents(host, code, { dataType: 'Casts', fightIDs: [fight.id], sourceID: pid },
    `${code}:casts:${fight.id}:${pid}`);
}

const nameFilter = (names) => `ability.name in (${names.map((n) => JSON.stringify(n)).join(', ')})`;

// Damage taken from the given avoidable abilities and enemy casts of the given interruptible ones, for any set of
// pulls (filtered by name so only the relevant events come back). Returns { damage, casts }; empty lists on failure.
export async function fetchMechanicEvents(host, code, fightIDs, { avoid = [], interrupt = [] }) {
  const ids = fightIDs.join(',');
  const get = (names, args, key) => (names.length
    ? fetchAllEvents(host, code, { ...args, fightIDs, filterExpression: nameFilter(names) }, `${code}:${key}:${ids}:${names.length}`)
      .catch((err) => { if (err instanceof AuthError || err instanceof RateLimitError) throw err; return []; })
    : []);
  const [damage, casts] = await Promise.all([
    get(avoid, { dataType: 'DamageTaken' }, 'avoid'),
    get(interrupt, { dataType: 'Casts', hostilityType: 'Enemies' }, 'enemycasts'),
  ]);
  return { damage, casts };
}

// Raid buff and potion buff events (applies, refreshes, fades) for any set of pulls, to tell which buffs were up at
// the pull (and who pre-potted) when the pull snapshot leaves them out. Empty on failure.
export async function fetchRaidBuffEvents(host, code, fightIDs) {
  try {
    return await fetchAllEvents(host, code, { dataType: 'Buffs', fightIDs, filterExpression: nameFilter([...RAID_BUFF_NAMES, ...POTION_NAMES]) },
      `${code}:buffevents:${fightIDs.join(',')}`);
  } catch (err) {
    if (err instanceof AuthError || err instanceof RateLimitError) throw err;
    return [];
  }
}

// One pull over time, for the compare page's timeline: raid damage done, and enemy hit points (resource 1000 is
// health on Warcraft Logs). Either can come back null on its own; both null on failure. Not yet checked against a
// real log, so the compare page shows the raw result for checking.
export async function fetchFightGraphs(host, code, fight) {
  try {
    // Without a time window the graph spans the whole log in coarse steps (47 seconds on a real 3-hour night), with
    // zeros outside the pull; limited to the pull, the steps are a second or two.
    const { data } = await gql(host, `query ($code: String!, $f: [Int]!, $s: Float, $e: Float) { reportData { report(code: $code) {
      damage: graph(dataType: DamageDone, fightIDs: $f, startTime: $s, endTime: $e)
      health: graph(dataType: Resources, hostilityType: Enemies, abilityID: 1000, fightIDs: $f, startTime: $s, endTime: $e)
    } } }`, { code, f: [fight.id], s: fight.startTime, e: fight.endTime }, { cacheKey: `${code}:graphs2:${fight.id}` });
    const r = data?.reportData?.report || {};
    return { damage: r.damage ?? null, health: r.health ?? null };
  } catch (err) {
    if (err instanceof AuthError || err instanceof RateLimitError) throw err;
    return { damage: null, health: null };
  }
}

// Casts of the given spells (raid cooldowns, Bloodlust) for any set of pulls, by name. Empty on failure.
export async function fetchNamedCasts(host, code, fightIDs, names) {
  try {
    return await fetchAllEvents(host, code, { dataType: 'Casts', fightIDs, filterExpression: nameFilter(names) },
      `${code}:namedcasts:${fightIDs.join(',')}:${[...names].sort().join('|')}`);
  } catch (err) {
    if (err instanceof AuthError || err instanceof RateLimitError) throw err;
    return [];
  }
}

// Debuffs on enemies over one pull, for raid debuff coverage. Null on failure.
export async function fetchEnemyDebuffs(host, code, fight) {
  try {
    const { data } = await gql(host, `query ($code: String!, $f: [Int]!) { reportData { report(code: $code) {
      debuffs: table(dataType: Debuffs, hostilityType: Enemies, fightIDs: $f)
    } } }`, { code, f: [fight.id] }, { cacheKey: `${code}:enemydebuffs:${fight.id}` });
    const t = data?.reportData?.report?.debuffs;
    return t?.data ?? t ?? null;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}

// One player's buffs (the Buffs table: auras on them, with uptimes) and the debuff events they caused on enemies,
// for the spec checks. Neither the Debuffs table nor events filtered by sourceID gave a player's own DoTs on a real
// log, so the debuffs are fetched by name for everyone (a small set) and kept where this player is the source.
// debuffNames: the spec's debuffs to check. Returns { buffs, debuffEvents }; null on failure.
export async function fetchPlayerAuras(host, code, fight, pid, debuffNames = []) {
  try {
    const [{ data }, debuffEvents] = await Promise.all([
      gql(host, `query ($code: String!, $f: [Int]!, $p: Int!) { reportData { report(code: $code) {
        buffs: table(dataType: Buffs, fightIDs: $f, sourceID: $p)
      } } }`, { code, f: [fight.id], p: pid }, { cacheKey: `${code}:buffs:${fight.id}:${pid}` }),
      debuffNames.length
        ? fetchAllEvents(host, code, { dataType: 'Debuffs', hostilityType: 'Enemies', fightIDs: [fight.id], filterExpression: nameFilter(debuffNames) },
          `${code}:dots:${fight.id}:${[...debuffNames].sort().join('|')}`)
        : [],
    ]);
    const r = data?.reportData?.report;
    if (!r) return null;
    return { buffs: r.buffs?.data ?? r.buffs ?? null, debuffEvents: debuffEvents.filter((e) => e.sourceID === pid) };
  } catch (err) {
    if (err instanceof AuthError || err instanceof RateLimitError) throw err;
    return null;
  }
}

// Parse percentiles for everyone in the fight. Returns null rather than failing the page.
export async function fetchRankings(host, code, fight) {
  try {
    const { data } = await gql(host, `query ($code: String!, $f: [Int]!) { reportData { report(code: $code) {
      rankings(fightIDs: $f)
    } } }`, { code, f: [fight.id] }, { cacheKey: `${code}:rankings:${fight.id}` });
    return data?.reportData?.report?.rankings ?? null;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return null;
  }
}

// Merge overlapping 10s pre-death windows so a wipe costs a few queries, not one per death.
function mergeWindows(deaths) {
  // Timestamps are written into the query text, so make sure they really are numbers.
  const spans = deaths.map((d) => Number(d.timestamp)).filter(Number.isFinite)
    .map((t) => [t - DEATH_WINDOW_MS, t + 50]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

// Damage taken and healing received by friendlies around each death, as one flat sorted list.
export async function fetchDeathWindows(host, code, fight, deaths) {
  const key = `${code}:windows:${fight.id}`;
  const hit = await cache.get(key);
  if (hit !== undefined) return hit;

  const windows = mergeWindows(deaths);
  const events = [];
  for (let i = 0; i < windows.length; i += WINDOWS_PER_QUERY) {
    const chunk = windows.slice(i, i + WINDOWS_PER_QUERY);
    const fields = chunk.map(([s, e], j) => `
      d${j}: events(dataType: DamageTaken, fightIDs: $f, startTime: ${s}, endTime: ${e}, includeResources: true, limit: 10000) { data }
      h${j}: events(dataType: Healing, fightIDs: $f, startTime: ${s}, endTime: ${e}, limit: 10000) { data }`).join('');
    const { data } = await gql(host, `query ($code: String!, $f: [Int]!) { reportData { report(code: $code) { ${fields} } } }`,
      { code, f: [fight.id] });
    const r = data?.reportData?.report || {};
    chunk.forEach((_, j) => events.push(...(r[`d${j}`]?.data || []), ...(r[`h${j}`]?.data || [])));
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  await cache.set(key, events);
  return events;
}

export function clearReportCache(code) {
  return cache.clear(code ? `${code}:` : '');
}
