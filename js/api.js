// Warcraft Logs v2 GraphQL access: link parsing, cached queries, and the fetches the views need.
import { CONFIG } from './config.js';
import { getToken, logout } from './auth.js';
import { cache } from './store.js';
import { POTION_NAMES } from './mop.js';

export class AuthError extends Error {}

const DEATH_WINDOW_MS = 10_000;
const WINDOWS_PER_QUERY = 8;

let rateListener = () => {};
export function onRateLimit(fn) { rateListener = fn; }

// Accepts a full report URL (any *.warcraftlogs.com site) or a bare report code.
export function parseReportLink(input) {
  const s = String(input || '').trim();
  const url = s.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)?warcraftlogs\.com)\/reports\/([A-Za-z0-9]+)(.*)$/i);
  if (url) {
    const host = url[1].toLowerCase().startsWith('warcraftlogs') ? `www.${url[1].toLowerCase()}` : url[1].toLowerCase();
    const fight = (url[3].match(/[?#&]fight=(\d+)/) || [])[1];
    return { host, code: url[2], fight: fight ? Number(fight) : null };
  }
  if (/^[A-Za-z0-9]{16}$/.test(s)) return { host: CONFIG.defaultHost, code: s, fight: null };
  return null;
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
  if (res.status === 429) throw new Error('Warcraft Logs rate limit reached. Try again when the hourly budget resets.');
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Warcraft Logs request failed (${res.status}).`);
  if (body.errors?.length && !body.data) throw new Error(body.errors.map((e) => e.message).join('; '));

  if (body.data?.rateLimitData) rateListener(body.data.rateLimitData);
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

export function fetchPlayerCasts(host, code, fight, pid) {
  return fetchAllEvents(host, code, { dataType: 'Casts', fightIDs: [fight.id], sourceID: pid },
    `${code}:casts:${fight.id}:${pid}`);
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
