import { CONFIG } from './config.js';
import { store } from './store.js';
import { getClientId, setClientId, getToken, login, logout, handleRedirect, redirectUri } from './auth.js';
import {
  AuthError, isAllowedHost, parseLink, parseReportLink, onRateLimit, fetchRateLimit, fetchReport, fetchDeaths,
  fetchFightDetail, fetchDeathWindows, fetchPlayerCasts, fetchRankings, fetchReportTotals, fetchReportPrep, fetchFightZones, fetchFightTables,
  fetchGuild, fetchGuildReportList, fetchReportFights, fetchGuildAttendance, fetchGuildMembers, fetchZoneInfo, fetchZoneExpansions, fetchTeamSpecs, bossImage, zoneImage, specIcon, guildCachePrefix,
  fetchMechanicEvents, fetchEnemyDebuffs, fetchPlayerAuras, fetchRaidBuffEvents, fetchNamedCasts, fetchFightGraphs, clearReportCache,
} from './api.js';
import { mechanicsFor, trackedNames, analyzeMechanics, nightMechanics } from './mechanics.js';
import { buffCoverage, debuffCoverage, nightBuffCoverage } from './buffs.js';
import { progressChart, lineChart } from './charts.js';
import { raidDps, bossHealth } from './timeline.js';
import { RAID_COOLDOWNS, summarizePull, comparePulls, defaultComparison } from './compare.js';
import { SPEC_MODULES } from './specs/index.js';
import { prepOverview, SLOT_NAMES, ENCHANT_SLOTS } from './prep.js';
import { fightKudos, reportKudos } from './kudos.js';
import { summarizeGuild, buildRoster, buildRaidTeam, groupByExpansion, guildTotals } from './guild.js';
import { analyzePlayer, analyzeNightPlayer, findEntry, findRanking, specOf } from './performance.js';
import {
  buildLookups, playerDeaths, summarizeReport, groupByRaid, analyzeFight, consumables, utility, throughput, raidPlayers,
  fmtTime, fmtDuration, fmtNum, fmtPct, fmtDay, remainingPct,
} from './analysis.js';
import { classColor } from './mop.js';
import { fillItemNames } from './items.js';
import { roleOf } from './cooldowns.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- helpers ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k) => (p.get(k) ? Number(p.get(k)) : null);
  const host = (p.get('h') || '').toLowerCase();
  const guild = p.get('g') ? { id: Number(p.get('g')) }
    : p.get('gn') ? { name: p.get('gn'), server: p.get('gs') || '', region: p.get('gr') || '' } : null;
  return { code: p.get('r'), guild, host: isAllowedHost(host) ? host : CONFIG.defaultHost, fight: num('f'), player: num('p'), compare: num('c'), code2: /^[A-Za-z0-9]{1,40}$/.test(p.get('r2') || '') ? p.get('r2') : null };
}

function href({ code, host, fight, player, compare, code2 }) {
  const p = new URLSearchParams({ r: code, h: host });
  if (fight != null) p.set('f', fight);
  if (code2) p.set('r2', code2);
  if (compare != null) p.set('c', compare);
  if (player != null) p.set('p', player);
  return `#${p}`;
}

function guildHref({ host, guild }) {
  const p = guild.id != null
    ? new URLSearchParams({ g: guild.id, h: host })
    : new URLSearchParams({ gn: guild.name, gs: guild.server, gr: guild.region, h: host });
  return `#${p}`;
}

const linkHref = (item) => (item.kind === 'guild' ? guildHref(item) : href(item));

function playerLink(lk, id, r, fightId) {
  return `<a class="player-link" href="${href({ ...r, fight: fightId, player: id, compare: null, code2: null })}">${playerTag(lk, id)}</a>`;
}

function playerTag(lk, id) {
  const a = lk.actor(id);
  return `<span class="player" style="--cls:${classColor(a?.subType)}">${esc(a?.name || 'Unknown')}</span>`;
}

// Warcraft Logs' percentile colour bands.
function parseTier(p) {
  if (p == null) return '';
  if (p >= 100) return 'gold';
  if (p >= 99) return 'pink';
  if (p >= 95) return 'orange';
  if (p >= 75) return 'purple';
  if (p >= 50) return 'blue';
  if (p >= 25) return 'green';
  return 'grey';
}

function parseBadge(p) {
  return p == null ? '<span class="muted">–</span>' : `<span class="parse parse-${parseTier(p)}">${Math.round(p)}</span>`;
}

// Tabbed sections. The last tab picked is remembered per page type.
function tabbed(key, tabs) {
  const list = tabs.filter((t) => t.html);
  const saved = store.get(key);
  const active = list.some((t) => t.id === saved) ? saved : list[0]?.id;
  return `<div class="tabs" data-tabs="${esc(key)}">
    <div class="tab-bar" role="tablist">${list.map((t) => `<button type="button" role="tab" class="tab" id="tab-${t.id}" data-tab="${t.id}"
      aria-controls="panel-${t.id}" aria-selected="${t.id === active}" tabindex="${t.id === active ? 0 : -1}">${esc(t.label)}${t.count ? ` <span class="tab-count">${t.count}</span>` : ''}</button>`).join('')}</div>
    ${list.map((t) => `<div class="tab-panel" role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" data-panel="${t.id}"${t.id === active ? '' : ' hidden'}>${t.html}</div>`).join('')}
  </div>`;
}

function bindTabs() {
  for (const root of view.querySelectorAll('[data-tabs]')) {
    const tabs = [...root.querySelectorAll('[data-tab]')];
    const select = (btn) => {
      for (const t of tabs) {
        const on = t === btn;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        root.querySelector(`[data-panel="${t.dataset.tab}"]`).hidden = !on;
      }
      store.set(root.dataset.tabs, btn.dataset.tab);
    };
    root.querySelector('.tab-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) select(btn);
    });
    root.querySelector('.tab-bar').addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  }
}

function spellLink(lk, id, name) {
  const ab = lk.abilities.get(id);
  const icon = ab?.icon ? `<img class="icon" alt="" loading="lazy" src="https://assets.rpglogs.com/img/warcraft/abilities/${encodeURIComponent(ab.icon)}" data-optional>` : '';
  if (!id || id <= 1) return `${icon}${esc(name)}`;
  return `<a class="spell" href="https://www.wowhead.com/${CONFIG.wowheadFlavor}/spell=${Number(id)}" target="_blank" rel="noopener">${icon}${esc(name)}</a>`;
}

function setLoading(msg) {
  view.innerHTML = `<div class="loading"><div class="spinner"></div><p>${esc(msg)}</p></div>`;
}

function showError(err) {
  if (err instanceof AuthError) {
    view.innerHTML = `<section class="card notice"><h2>Connect Warcraft Logs</h2><p>${esc(err.message)}</p>
      <button id="err-login">Connect</button></section>`;
    $('#err-login').onclick = startLogin;
    renderAuth();
    return;
  }
  view.innerHTML = `<section class="card notice error"><h2>Something went wrong</h2><p>${esc(err.message || err)}</p></section>`;
}

async function startLogin() {
  try { await login(); } catch (e) { openSettings(e.message); }
}

function rawBlock(label, data) {
  if (!store.get('fl.showRaw', false)) return '';
  return `<details class="raw"><summary>Raw: ${esc(label)}</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
}

// ---------- chrome ----------

function renderAuth() {
  const area = $('#auth-area');
  const connected = !!getToken();
  area.innerHTML = `${connected
    ? '<span class="status ok">Connected</span><button id="logout" class="link-btn">Log out</button>'
    : '<button id="login">Connect Warcraft Logs</button>'}
    <button id="open-settings" class="icon-btn" title="Settings" aria-label="Settings">⚙</button>`;
  $('#open-settings').onclick = () => openSettings();
  // Logging out also forgets cached report data and recent reports, which can include private logs.
  if (connected) {
    $('#logout').onclick = async () => {
      logout();
      store.remove('fl.recent');
      await clearReportCache();
      renderAuth();
      render();
    };
  }
  else $('#login').onclick = startLogin;
}

function openSettings(message) {
  const dlg = $('#settings');
  $('#client-id').value = getClientId();
  $('#client-id-field').hidden = !!CONFIG.clientId;
  $('#show-raw').checked = store.get('fl.showRaw', false);
  $('#redirect-hint').textContent = redirectUri();
  dlg.querySelector('.settings-msg')?.remove();
  if (message) dlg.querySelector('h2').insertAdjacentHTML('afterend', `<p class="settings-msg">${esc(message)}</p>`);
  dlg.showModal();
}

$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  if (!CONFIG.clientId) setClientId($('#client-id').value);
  store.set('fl.showRaw', $('#show-raw').checked);
  renderAuth();
  render();
});

$('#clear-cache').onclick = async () => {
  await clearReportCache();
  $('#clear-cache').textContent = 'Cleared';
  setTimeout(() => { $('#clear-cache').textContent = 'Clear cache'; }, 1500);
};

// Icons that fail to load are removed. One listener instead of inline onerror="" handlers,
// so the Content Security Policy can forbid inline script.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-optional')) e.target.remove();
}, true);

$('#link-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseLink($('#link-input').value);
  if (!parsed) {
    $('#link-input').setCustomValidity('That doesn\'t look like a Warcraft Logs report or guild link.');
    $('#link-input').reportValidity();
    return;
  }
  $('#link-input').value = '';
  location.hash = linkHref(parsed);
});
$('#link-input').addEventListener('input', () => $('#link-input').setCustomValidity(''));

// Links can ask the pull page to open on a given tab, e.g. a player's "see the death recap".
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-open-tab]');
  if (link) store.set('fl.tab.fight', link.dataset.openTab);
});

onRateLimit((r) => {
  $('#rate-limit').textContent = `API budget: ${Math.round(r.pointsSpentThisHour)} / ${r.limitPerHour} points this hour, resets in ${Math.ceil(r.pointsResetIn / 60)} min`;
});

// ---------- views ----------

function renderHome() {
  const recent = store.get('fl.recent', []);
  view.innerHTML = `
    <section class="hero">
      <h1>Why did we wipe?</h1>
      <p>Paste a Warcraft Logs report link above. FableLogs goes through every boss pull and explains, in plain words, why each player died,
      what started each wipe, and who pulled without a flask, food or potion.</p>
      <p>Paste a guild link instead for the guild's progression, raid-night trends and attendance.</p>
      ${getToken() ? '' : '<p><button id="hero-login">Connect Warcraft Logs</button> <span class="hint">You log in with your own Warcraft Logs account. Nothing is stored except in this browser.</span></p>'}
    </section>
    ${recent.length ? `<section class="card"><h2>Recent</h2><ul class="recent">
      ${recent.map((r) => `<li>${r.kind === 'guild' ? '<span class="kind-tag">Guild</span>' : ''}<a href="${linkHref(r)}">${esc(r.title || r.code)}</a>
        <span class="muted">${esc(r.host)} · ${new Date(r.at).toLocaleDateString()}</span></li>`).join('')}
    </ul></section>` : ''}`;
  $('#hero-login')?.addEventListener('click', startLogin);
}

// Recent list holds reports and guilds; a guild is keyed by its id once it has been looked up.
function remember(item) {
  const same = (x) => (item.kind === 'guild'
    ? x.kind === 'guild' && x.guild?.id === item.guild.id
    : x.kind !== 'guild' && x.code === item.code);
  const recent = store.get('fl.recent', []).filter((x) => !same(x));
  recent.unshift({ ...item, at: Date.now() });
  store.set('fl.recent', recent.slice(0, 10));
}

async function loadReport(r) {
  const report = await fetchReport(r.host, r.code);
  const lk = buildLookups(report);
  const fightIDs = (report.fights || []).map((f) => f.id);
  const deaths = fightIDs.length ? playerDeaths(await fetchDeaths(r.host, r.code, fightIDs), lk) : [];
  return { report, lk, deaths };
}

// crumbs: [{ label (HTML), href? }] shown after the report title, e.g. boss pull › player.
function reportHeader(r, report, crumbs = []) {
  const date = new Date(report.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const guild = report.guild ? `${esc(report.guild.name)}${report.guild.server ? ` · ${esc(report.guild.server.name)}` : ''}` : esc(report.owner?.name || '');
  const trail = [{ label: esc(report.title), href: crumbs.length ? href({ ...r, fight: null, player: null, compare: null, code2: null }) : null }, ...crumbs];
  return `<section class="report-head">
    <div class="report-title">
      <nav class="crumbs" aria-label="Breadcrumb">${trail.map((c, i) => (c.href && i < trail.length - 1
        ? `<a href="${c.href}">${c.label}</a>` : `<span${i === trail.length - 1 ? ' aria-current="page"' : ''}>${c.label}</span>`)).join('<span class="sep" aria-hidden="true">›</span>')}</nav>
      <p class="muted">${esc(report.zone?.name || '')} · ${guild} · ${date}</p>
    </div>
    <div class="head-actions">
      <a class="button secondary" href="https://${esc(r.host)}/reports/${esc(r.code)}" target="_blank" rel="noopener">Warcraft Logs ↗</a>
      <button id="refresh" class="secondary" title="Reload from Warcraft Logs (for live logs)">Refresh</button>
    </div>
  </section>`;
}

function pullNumber(report, fight) {
  return report.fights.filter((f) => f.encounterID === fight.encounterID).findIndex((f) => f.id === fight.id) + 1;
}

function bindRefresh(r) {
  $('#refresh')?.addEventListener('click', async () => { await clearReportCache(r.code); render(); });
}

async function renderReport(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember({ kind: 'report', code: r.code, host: r.host, title: report.title });
  const s = summarizeReport(report, deaths, lk);
  const fightIDs = (report.fights || []).map((f) => f.id);
  const tracked = trackedNames(s.encounters.map((e) => e.name));
  const [totals, prepData, zones, mech, buffEvents] = fightIDs.length
    ? await Promise.all([
      fetchReportTotals(r.host, r.code, fightIDs), fetchReportPrep(r.host, r.code, fightIDs), fetchFightZones(r.host, r.code),
      tracked.avoid.length ? fetchMechanicEvents(r.host, r.code, fightIDs, { avoid: tracked.avoid }) : null,
      fetchRaidBuffEvents(r.host, r.code, fightIDs),
    ])
    : [null, null, new Map(), null, []];
  const kudos = reportKudos({ report, lk, deaths, totals });
  const prep = prepData ? prepOverview(report, lk, prepData.combatants, prepData.potions, buffEvents) : null;
  const info = specInfo(lk, [totals?.damage, totals?.healing]);
  const nm = mech ? nightMechanics(report.fights || [], mech.damage, lk, (pid) => info(pid).role, deaths) : null;
  const nightBuffs = prepData ? nightBuffCoverage((report.fights || []).map((f) => {
    const pids = raidPlayers(f, lk);
    return {
      fight: f,
      coverage: buffCoverage(pids, prepData.combatants.filter((c) => c.fight === f.id), lk, pids.map((pid) => info(pid).classSpec),
        buffEvents.filter((e) => e.fight === f.id)),
    };
  })) : null;

  if (!s.encounters.length) {
    view.innerHTML = `${reportHeader(r, report)}<section class="card notice"><p>This report has no boss encounters.</p></section>`;
    bindRefresh(r);
    return;
  }

  const pullChip = (p, i) => {
    const f = p.fight;
    const label = f.kill ? 'Kill' : fmtPct(remainingPct(f));
    return `<a class="chip ${f.kill ? 'kill' : 'wipe'}" href="${href({ ...r, fight: f.id })}" title="Pull ${i + 1}: ${fmtTime(p.duration)}, ${p.deaths.length} deaths">
      <b>#${i + 1}</b> ${label} <span>${fmtTime(p.duration)}</span>${p.deaths.length ? ` <span class="deaths">☠${p.deaths.length}</span>` : ''}</a>`;
  };

  const encounterCard = (e) => `<article class="card encounter">
    <header><h3>${esc(e.name)}</h3>
      <span class="badge ${e.kills.length ? 'kill' : 'wipe'}">${e.kills.length ? `Killed${e.fastestKill ? ` · ${fmtTime(e.fastestKill)}` : ''}` : `Best ${fmtPct(e.bestWipe)}`}</span>
    </header>
    <p class="muted">${e.pulls.length} pull${e.pulls.length === 1 ? '' : 's'} · ${e.wipes.length} wipe${e.wipes.length === 1 ? '' : 's'}</p>
    <div class="chips">${e.pulls.map(pullChip).join('')}</div>
    ${encounterChart(e, r)}
  </article>`;

  // One collapsible section per raid; a log can span several (e.g. a full-tier clear).
  const raids = groupByRaid(s.encounters, (f) => zones.get(f.id) || null, report.zone?.name);
  const overview = `
    <section class="card takeaways"><h2>Summary</h2><ul>${s.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
    ${kudosCard(kudos, lk, r, null)}
    ${raids.map((raid) => `<details class="raid" open>
      <summary><span class="raid-name">${esc(raid.name)}</span>
        <span class="muted">${raid.killed}/${raid.encounters.length} killed · ${raid.pulls} pull${raid.pulls === 1 ? '' : 's'}</span></summary>
      <div class="encounters">${raid.encounters.map(encounterCard).join('')}</div>
    </details>`).join('')}`;

  const deathsTab = `
    <section class="grid2">
      <article class="card"><h2>Deaths by player</h2>
        ${s.deathCounts.length ? `<table class="table"><thead><tr><th>Player</th><th>Deaths</th><th>First death on a wipe</th></tr></thead><tbody>
        ${s.deathCounts.map(([id, n]) => `<tr><td>${playerTag(lk, id)}</td><td>${n}</td><td>${(s.firstDeathCounts.find(([x]) => x === id) || [0, 0])[1] || ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No player deaths. Nice.</p>'}
      </article>
      <article class="card"><h2>Most common killing blows</h2>
        ${s.killers.length ? `<table class="table"><thead><tr><th>Ability</th><th>Deaths</th></tr></thead><tbody>
        ${s.killers.slice(0, 12).map(([id, n]) => `<tr><td>${spellLink(lk, id, lk.abilityName(id))}</td><td>${n}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No killing blow data in this report.</p>'}
      </article>
    </section>`;

  view.innerHTML = `
    ${reportHeader(r, report)}
    ${tabbed('fl.tab.report', [
    { id: 'overview', label: 'Overview', html: `<div class="report-overview"><div class="report-main">${overview}</div>${reportRosterHtml(report, lk, totals, s, r)}</div>` },
    { id: 'deaths', label: 'Deaths', count: deaths.length, html: deathsTab },
    { id: 'mechanics', label: 'Mechanics', count: nm?.players.reduce((n, p) => n + p.hits, 0), html: nm ? mechanicsNightHtml(nm, lk, r) : '' },
    { id: 'prep', label: 'Prep & gear', html: `${raidBuffsNightHtml(nightBuffs)}${prepCard(prep, lk)}` },
  ])}
    ${rawBlock('fights', report.fights)}${prepData ? rawBlock('combatant info', prepData.combatants.slice(0, 5)) : ''}`;
  bindTabs();
  bindRefresh(r);
}

const QUALITY = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom'];

function rateCell(p, d) {
  if (p == null) return '<td class="muted">?</td>';
  const cls = p >= 1 ? 'yes' : p >= 0.75 ? 'partial' : 'no';
  return `<td class="${cls}" title="${d}">${Math.round(p * 100)}%</td>`;
}

// Wowhead link attributes for an equipped item, so tooltips show its item level, enchant and gems.
function itemLinkAttrs(g) {
  const extra = new URLSearchParams();
  if (g.itemLevel) extra.set('ilvl', g.itemLevel);
  if (g.permanentEnchant) extra.set('ench', g.permanentEnchant);
  const gems = (g.gems || []).map((x) => x.id).filter(Boolean);
  if (gems.length) extra.set('gems', gems.join(':'));
  return `href="https://www.wowhead.com/${CONFIG.wowheadFlavor}/item=${Number(g.id)}" data-wowhead="${esc(extra.toString())}" target="_blank" rel="noopener"`;
}

function gearIcon(g) {
  const icon = g.icon ? `<img alt="" loading="lazy" src="https://assets.rpglogs.com/img/warcraft/abilities/${encodeURIComponent(g.icon)}" data-optional>` : '';
  return `<a class="gear-item q-${QUALITY[g.quality] || 'common'}" ${itemLinkAttrs(g)} title="${esc(SLOT_NAMES[g.slot] || '')}">
    ${icon}${g.itemLevel ? `<span class="gear-ilvl">${Number(g.itemLevel)}</span>` : ''}</a>`;
}

// The combat log has item ids but not names: fillItemNames() swaps this text for the item's name from Wowhead
// once the page is up. The slot name is the fallback if Wowhead can't be reached.
function itemNameLink(g) {
  return `<a class="item-name qt-${QUALITY[g.quality] || 'common'}" ${itemLinkAttrs(g)} data-item-id="${Number(g.id)}">${esc(SLOT_NAMES[g.slot] || 'Item')}</a>`;
}

function prepCard(prep, lk) {
  if (!prep) return '<section class="card"><h2>Raid prep &amp; gear</h2><p class="muted">Couldn\'t load buff and gear data for this report.</p></section>';
  if (!prep.hasInfo) return '<section class="card"><h2>Raid prep &amp; gear</h2><p class="muted">No combatant info in this log. It needs Advanced Combat Logging turned on in game.</p></section>';
  const summary = [
    prep.avgIlvl ? `Average item level <b>${prep.avgIlvl.toFixed(1)}</b>` : '',
    prep.flaskPct != null ? `flasks on <b>${Math.round(prep.flaskPct * 100)}%</b> of pulls` : '',
    prep.foodPct != null ? `food on <b>${Math.round(prep.foodPct * 100)}%</b>` : '',
  ].filter(Boolean).join(' · ');
  return `<section class="card"><h2>Raid prep &amp; gear</h2>
    <p>${summary}</p>
    ${prep.issues.length ? `<ul class="issues">${prep.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>Everyone was flasked, fed and enchanted all night.</p>'}
    <table class="table prep"><thead><tr>
      <th>Player</th><th class="num">ilvl</th><th>Flask</th><th>Food</th><th>Pre-pot</th><th class="num">Pots</th><th>Enchants</th><th>Gear</th>
    </tr></thead><tbody>
    ${prep.players.map((p) => `<tr>
      <td>${playerTag(lk, p.pid)}</td>
      <td class="num">${p.ilvl ? p.ilvl.toFixed(1) : '?'}</td>
      ${rateCell(p.flaskPct, `${p.info - p.flaskMissed} of ${p.info} pulls`)}
      ${rateCell(p.foodPct, `${p.info - p.foodMissed} of ${p.info} pulls`)}
      ${rateCell(p.prePotPct, `${Math.round((p.prePotPct || 0) * p.pulls)} of ${p.pulls} pulls`)}
      <td class="num">${p.combatPots || ''}</td>
      <td>${!p.gear.length ? '<span class="muted">?</span>' : p.missingEnchants.length
        ? `<span class="no">Missing: ${esc(p.missingEnchants.join(', '))}</span>` : '<span class="yes">✓</span>'}</td>
      <td>${p.gear.length ? `<details><summary>${p.gear.length} items</summary><div class="gear">${p.gear.map(gearIcon).join('')}</div></details>` : ''}</td>
    </tr>`).join('')}
    </tbody></table>
    <p class="hint">Flask and food are the share of pulls where the buff was up at the pull. Gear is from each player's last pull of the night.
      Enchants are checked on shoulder, back, chest, wrist, hands, legs, feet and weapons. Rings (enchanters only) aren't judged.</p>
  </section>`;
}

function kudosCard(kudos, lk, r, fightId) {
  if (!kudos.length) return '';
  const who = (pids) => pids.map((id) => (fightId != null ? playerLink(lk, id, r, fightId) : playerTag(lk, id))).join(', ');
  return `<section class="card"><h2>Kudos</h2><div class="kudos">
    ${kudos.map((k) => `<div class="kudo">
      <span class="kudo-icon" aria-hidden="true">${esc(k.icon)}</span>
      <div><div class="kudo-title">${esc(k.title)}</div>
        ${k.pids.length ? `<div class="kudo-who">${who(k.pids)}</div>` : ''}
        <div class="kudo-text muted">${esc(k.text)}</div></div>
    </div>`).join('')}
  </div></section>`;
}

const DEATH_KINDS = { oneshot: 'One-shot', spike: 'Big hit', burst: 'Burst', attrition: 'Worn down', fall: 'Fall', unknown: 'Unclear' };

function deathCard(a, lk, fight, r) {
  return `<article class="death ${a.minor ? 'minor' : ''} kind-${a.kind}">
    <header>
      <span class="time">${fmtTime(a.time - fight.startTime)}</span>
      ${playerLink(lk, a.pid, r, fight.id)}
      <span class="tag">${esc(DEATH_KINDS[a.kind] || a.kind)}</span>
    </header>
    <p class="headline">${esc(a.headline)}</p>
    <ul class="notes">${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    ${a.timeline.length ? `<details><summary>Last ${a.timeline.length} events</summary>
      <table class="table timeline"><thead><tr><th>Before death</th><th>Ability</th><th>Source</th><th class="num">Amount</th><th class="num">HP after</th></tr></thead><tbody>
      ${a.timeline.map((e) => `<tr class="${e.kind}">
        <td>-${e.before.toFixed(1)}s</td>
        <td>${spellLink(lk, e.abilityId, e.ability)}</td>
        <td>${esc(e.source)}</td>
        <td class="num">${e.kind === 'heal' ? '+' : '-'}${fmtNum(e.amount)}${e.overkill ? ` <span class="muted">(${fmtNum(e.overkill)} overkill)</span>` : ''}</td>
        <td class="num">${e.hpPct == null ? '' : `${e.hpPct}%`}</td>
      </tr>`).join('')}
      </tbody></table></details>` : ''}
  </article>`;
}

function consumablesCard(c, lk, err) {
  if (err) return `<article class="card"><h2>Consumables</h2><p class="muted">Couldn't load: ${esc(err)}</p></article>`;
  if (!c.hasInfo) return `<article class="card"><h2>Consumables</h2><p class="muted">No combatant info in this log. It needs Advanced Combat Logging turned on in game.</p></article>`;
  const yes = '<span class="yes">✓</span>';
  const no = '<span class="no">✗</span>';
  const issues = [];
  if (c.missingFlask.length) issues.push(`No flask: ${c.missingFlask.map((id) => playerTag(lk, id)).join(', ')}`);
  if (c.missingFood.length) issues.push(`No food buff: ${c.missingFood.map((id) => playerTag(lk, id)).join(', ')}`);
  if (c.noPotions.length) issues.push(`No potion at all: ${c.noPotions.map((id) => playerTag(lk, id)).join(', ')}`);
  return `<article class="card"><h2>Consumables</h2>
    ${issues.length ? `<ul class="issues">${issues.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p>Everyone had a flask, food and a potion.</p>'}
    <details><summary>Full table</summary>
    <table class="table"><thead><tr><th>Player</th><th>Flask</th><th>Food</th><th>Pre-pot</th><th>Pots in fight</th></tr></thead><tbody>
    ${c.rows.map((row) => `<tr><td>${playerTag(lk, row.pid)}</td>
      <td>${row.hasInfo ? (row.flask ? `${yes} <span class="muted">${esc(row.flask)}</span>` : no) : '<span class="muted">?</span>'}</td>
      <td>${row.hasInfo ? (row.food ? yes : no) : '<span class="muted">?</span>'}</td>
      <td>${row.prePot ? yes : no}</td><td>${row.combatPots || ''}</td></tr>`).join('')}
    </tbody></table></details>
    <p class="hint">Flask and food come from the buffs each player had at the pull. Potions are matched by name.</p>
  </article>`;
}

function utilityCard(title, rows, lk, err, emptyText) {
  return `<article class="card"><h2>${esc(title)}</h2>
    ${err ? `<p class="muted">Couldn't load: ${esc(err)}</p>` : rows.length ? `<table class="table"><tbody>
      ${rows.map((p) => `<tr><td>${playerTag(lk, p.pid)}</td><td class="num">${p.count}</td>
        <td class="muted">${p.spells.map(([id, n]) => `${spellLink(lk, id, lk.abilityName(id))}${n > 1 ? ` ×${n}` : ''}`).join(', ')}</td></tr>`).join('')}
    </tbody></table>` : `<p class="muted">${esc(emptyText)}</p>`}
  </article>`;
}

function throughputCard(title, rows, lk, err, r, fight) {
  if (err) return `<article class="card"><h2>${esc(title)}</h2><p class="muted">Couldn't load: ${esc(err)}</p></article>`;
  const top = rows[0]?.total || 1;
  return `<article class="card"><h2>${esc(title)}</h2>
    ${rows.length ? `<div class="bars">${rows.map((row) => `<div class="bar">
      <a class="bar-name" href="${href({ ...r, fight: fight.id, player: row.pid })}" title="Performance breakdown">${esc(row.name)}</a>
      <span class="bar-track"><span class="bar-fill" style="width:${((row.total / top) * 100).toFixed(1)}%;background:${classColor(row.subType)}"></span></span>
      <span class="bar-val">${fmtNum(row.perSec)}/s</span></div>`).join('')}</div>` : '<p class="muted">No data.</p>'}
  </article>`;
}

// Spec, "Class-Spec" and role per player, from whichever damage or healing tables are at hand.
function specInfo(lk, tables) {
  return (pid) => {
    const spec = tables.map((t) => specOf(findEntry(t, pid))).find(Boolean) || null;
    const cls = String(lk.actor(pid)?.subType || '').replace(/\s+/g, '');
    return { spec, classSpec: `${cls}-${spec || ''}`, role: spec ? roleOf(cls, spec) : null };
  };
}

// Fight left at the end of each pull of one boss tonight, when there's progress to show.
function encounterChart(e, r) {
  if (e.wipes.length < 2) return '';
  return progressChart(e.pulls.map((p, i) => {
    const pct = remainingPct(p.fight);
    return {
      pct, kill: p.fight.kill, href: href({ ...r, fight: p.fight.id }),
      title: `Pull ${i + 1}: ${p.fight.kill ? 'kill' : `wipe with ${fmtPct(pct)} left`} after ${fmtTime(p.duration)}`,
    };
  }), `${e.name}: how much of the fight was left at the end of each pull`);
}

const meter = (pct, good, ok) => `<span class="meter"><span class="meter-fill ${pct >= good ? 'good' : pct >= ok ? 'ok' : 'low'}" style="width:${(Math.min(1, pct) * 100).toFixed(0)}%"></span></span>`;

function mechanicsFightHtml(ma, lk, r, fight) {
  if (!ma) {
    return `<section class="card"><h2>Mechanics</h2><p class="muted">There's no mechanics list for ${esc(fight.name)} yet, so avoidable damage and interrupts aren't checked on this boss.</p></section>`;
  }
  const avoidRows = ma.avoid.map((a) => `<tr>
    <td>${spellLink(lk, a.abilityId, a.name)}<div class="muted small">${esc(a.tip)}</div></td>
    <td class="num">${a.hits || '<span class="yes">0</span>'}</td>
    <td class="num">${a.hits ? fmtNum(a.damage) : ''}</td>
    <td>${a.players.map((p) => `${playerLink(lk, p.pid, r, fight.id)}${p.hits > 1 ? ` <span class="muted">×${p.hits}</span>` : ''}`).join(', ')}</td>
  </tr>`).join('');
  const intRows = ma.interrupt.map((a) => `<tr>
    <td>${spellLink(lk, a.abilityId, a.name)}${a.tip ? `<div class="muted small">${esc(a.tip)}</div>` : ''}</td>
    <td class="num">${a.interrupted}</td>
    <td class="num ${a.wentOff ? 'no' : 'yes'}">${a.wentOff}</td>
    <td>${a.by.map(([pid, n]) => `${playerTag(lk, pid)}${n > 1 ? ` <span class="muted">×${n}</span>` : ''}`).join(', ')}</td>
  </tr>`).join('');
  return `<section class="card"><h2>Avoidable damage</h2>
      ${ma.summary.length ? `<ul class="issues">${ma.summary.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${avoidRows ? `<table class="table mechanics"><thead><tr><th>Ability</th><th class="num">Hits</th><th class="num">Damage</th><th>Who</th></tr></thead><tbody>${avoidRows}</tbody></table>`
        : '<p class="muted">None of the tracked abilities for this boss appear in the log.</p>'}
      <p class="hint">A hand-picked list of avoidable abilities per boss, matched by name. Hits are times caught: pulses within 3 seconds count once. Tank hits from frontal abilities aren't counted.</p>
    </section>
    ${intRows ? `<section class="card"><h2>Interrupts</h2>
      <table class="table mechanics"><thead><tr><th>Enemy cast</th><th class="num">Interrupted</th><th class="num">Went off</th><th>Interrupted by</th></tr></thead><tbody>${intRows}</tbody></table>
    </section>` : ''}`;
}

function mechanicsNightHtml(nm, lk, r) {
  if (!nm.players.length) return '<section class="card"><h2>Avoidable damage</h2><p class="yes">Nobody was hit by the tracked avoidable abilities all night.</p></section>';
  return `<section class="grid2">
    <article class="card"><h2>Avoidable hits by player</h2>
      <table class="table"><thead><tr><th>Player</th><th class="num">Hits</th><th class="num">Damage</th><th class="num">Pulls</th></tr></thead><tbody>
      ${nm.players.map((p) => `<tr><td><a class="player-link" href="${href({ ...r, fight: null, player: p.pid })}">${playerTag(lk, p.pid)}</a></td>
        <td class="num">${p.hits}</td><td class="num">${fmtNum(p.damage)}</td><td class="num">${p.pulls}</td></tr>`).join('')}
      </tbody></table>
    </article>
    <article class="card"><h2>What hit people</h2>
      <table class="table"><thead><tr><th>Ability</th><th>Boss</th><th class="num">Hits</th></tr></thead><tbody>
      ${nm.abilities.map((a) => `<tr><td>${spellLink(lk, a.abilityId, a.name)}<div class="muted small">${esc(a.tip)}</div></td>
        <td class="muted">${esc(a.boss)}</td><td class="num">${a.hits}</td></tr>`).join('')}
      </tbody></table>
    </article>
  </section>
  <p class="hint">A hand-picked list of avoidable abilities per boss, matched by name. Each pull's Mechanics tab also checks interrupts.</p>`;
}

const providerNote = (b) => (b.canProvide ? 'Someone in the raid can provide it.' : b.hunter ? 'Nobody brings it, but a hunter pet could.' : 'Nobody in this raid brings it.');

function raidBuffsHtml(buffs, debuffs) {
  if (!buffs && !debuffs) return '';
  const buffRows = (buffs || []).map((b) => `<tr><td>${esc(b.label)}</td>
    <td>${meter(b.pct, 1, 0.75)} <span class="meter-val">${b.have}/${b.total}</span></td>
    <td class="muted">${b.pct >= 1 ? '' : esc(providerNote(b))}</td></tr>`).join('');
  const debuffRows = (debuffs || []).map((d) => `<tr><td>${esc(d.label)}</td>
    <td>${meter(d.uptime, d.target, d.target - 0.2)} <span class="meter-val">${Math.round(d.uptime * 100)}%</span></td>
    <td class="muted">${d.uptime >= d.target ? '' : esc(d.uptime ? d.tip : `${providerNote(d)} ${d.tip}`)}</td></tr>`).join('');
  return `<article class="card"><h2>Raid buffs &amp; debuffs</h2>
    ${buffRows ? `<table class="table buffs"><thead><tr><th>Buff</th><th>Players with it at the pull</th><th></th></tr></thead><tbody>${buffRows}</tbody></table>` : ''}
    ${debuffRows ? `<table class="table buffs"><thead><tr><th>Debuff on enemies</th><th>Uptime</th><th></th></tr></thead><tbody>${debuffRows}</tbody></table>` : ''}
    <p class="hint">Buffs are read from each player's auras at the pull; debuff uptime is the best of the matching debuffs across enemies.</p>
  </article>`;
}

function raidBuffsNightHtml(nb) {
  if (!nb) return '';
  return `<section class="card"><h2>Raid buffs</h2>
    <table class="table buffs"><thead><tr><th>Buff</th><th>Pulls with it on everyone</th><th></th></tr></thead><tbody>
    ${nb.map((b) => `<tr><td>${esc(b.label)}</td>
      <td>${meter(b.full / b.pulls, 1, 0.75)} <span class="meter-val">${b.full}/${b.pulls}</span></td>
      <td class="muted">${b.full === b.pulls ? '' : b.missing.length ? `Missing entirely on ${b.missing.length} pull${b.missing.length === 1 ? '' : 's'}. ${esc(providerNote(b))}` : 'Some players were missing it.'}</td></tr>`).join('')}
    </tbody></table>
    <p class="hint">From each player's auras at the pull. Each pull's Prep &amp; utility tab also shows debuff uptime on the boss.</p>
  </section>`;
}

function uptimesHtml(uptimes, lk) {
  if (!uptimes.length) return '';
  return `<section class="card"><h2>Uptimes</h2>
    <table class="table buffs"><thead><tr><th>Buff or debuff</th><th>Uptime while alive</th><th class="num">Target</th></tr></thead><tbody>
    ${uptimes.map((u) => `<tr><td>${spellLink(lk, u.abilityId, u.label)} <span class="muted">${u.kind === 'debuff' ? 'on enemies' : 'on you'}</span></td>
      <td>${meter(u.uptime, u.target, u.target - 0.15)} <span class="meter-val">${Math.round(u.uptime * 100)}%</span></td>
      <td class="num muted">${Math.round(u.target * 100)}%</td></tr>`).join('')}
    </tbody></table>
    <p class="hint">A debuff counts as up while it's on at least one enemy.</p>
  </section>`;
}

async function renderFight(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember({ kind: 'report', code: r.code, host: r.host, title: report.title });
  const fight = (report.fights || []).find((f) => f.id === r.fight);
  if (!fight) throw new Error(`Fight ${r.fight} isn't a boss pull in this report.`);

  const fightDeaths = deaths.filter((d) => d.fight === fight.id);
  setLoading(`Analysing ${fight.name}…`);
  const tracked = trackedNames([fight.name]);
  const [windows, detail, rankings, mech, enemyDebuffs, buffEvents] = await Promise.all([
    fightDeaths.length ? fetchDeathWindows(r.host, r.code, fight, fightDeaths) : [],
    fetchFightDetail(r.host, r.code, fight),
    fetchRankings(r.host, r.code, fight),
    mechanicsFor(fight.name) ? fetchMechanicEvents(r.host, r.code, [fight.id], tracked) : null,
    fetchEnemyDebuffs(r.host, r.code, fight),
    fetchRaidBuffEvents(r.host, r.code, [fight.id]),
  ]);

  const fa = analyzeFight(fight, fightDeaths, windows, lk);
  const cons = consumables(fight, detail.combatants, detail.potions, lk, buffEvents);
  const kudos = fightKudos({ fight, lk, detail, deaths: fightDeaths, prep: cons, rankings });
  const info = specInfo(lk, [detail.damage, detail.healing]);
  const ma = mech ? analyzeMechanics(fight, mech.damage, mech.casts, detail.interrupts, lk, (pid) => info(pid).role, fightDeaths) : null;
  const pids = raidPlayers(fight, lk);
  const classSpecs = pids.map((pid) => info(pid).classSpec);
  const buffs = buffCoverage(pids, detail.combatants, lk, classSpecs, buffEvents);
  const debuffs = debuffCoverage(enemyDebuffs, fight, lk, classSpecs);
  const avoidHits = ma ? ma.avoid.reduce((n, a) => n + a.hits, 0) : 0;

  const pulls = report.fights.filter((f) => f.encounterID === fight.encounterID);
  const idx = pulls.findIndex((f) => f.id === fight.id);
  const nav = `<nav class="pull-nav">
    ${idx > 0 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx - 1].id })}">← Pull ${idx}</a>` : ''}
    <span>Pull ${idx + 1} of ${pulls.length}</span>
    ${idx < pulls.length - 1 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx + 1].id })}">Pull ${idx + 2} →</a>` : ''}
  </nav>`;
  const suggested = defaultComparison(pulls, fight);
  const compareHtml = `<div class="compare-pick">
      ${suggested ? `<a class="button secondary" href="${href({ ...r, compare: suggested.id })}">Compare with ${esc(pullLabel(pulls, suggested))} →</a>` : ''}
      ${pulls.length > 2 ? `<select id="compare-pull" aria-label="Compare with another pull"><option value="">Or another pull…</option>
        ${pulls.filter((f) => f.id !== fight.id).map((f) => `<option value="${f.id}">${esc(pullLabel(pulls, f))}</option>`).join('')}</select>` : ''}
      <form id="compare-log" class="compare-log">
        <input type="text" name="link" autocomplete="off" placeholder="Or paste another log's link to compare with its ${esc(fight.name)} pulls" aria-label="Another log to compare with">
        <button type="submit" class="secondary">Compare</button>
        <span class="form-error no" hidden></span>
      </form>
    </div>`;

  const decisive = fa.analyses.filter((a) => !a.minor);
  const late = fa.analyses.filter((a) => a.minor);
  const deathsTab = fa.analyses.length ? `<section class="card"><h2>Death recaps</h2>
      <p class="hint">Each death is explained from the damage taken and healing received in the 10 seconds before it.</p>
      <div class="deaths-list">${decisive.map((a) => deathCard(a, lk, fight, r)).join('')}</div>
      ${late.length ? `<details class="after-wipe"><summary>${late.length} more death${late.length === 1 ? '' : 's'} after half the raid was down</summary>
        <div class="deaths-list">${late.map((a) => deathCard(a, lk, fight, r)).join('')}</div></details>` : ''}
    </section>` : '<section class="card"><p class="muted">Nobody died on this pull.</p></section>';

  view.innerHTML = `
    ${reportHeader(r, report, [{ label: `${esc(fight.name)} · pull ${idx + 1}` }])}
    <section class="fight-head card">
      <p class="fight-meta"><span class="badge ${fight.kill ? 'kill' : 'wipe'}">${fight.kill ? 'Kill' : `Wipe · ${fmtPct(remainingPct(fight))}`}</span>
        <span class="muted">${fmtTime(fight.endTime - fight.startTime)} · ${fa.raidSize} players · ${fightDeaths.length} death${fightDeaths.length === 1 ? '' : 's'}</span></p>
      ${nav}
      ${compareHtml}
    </section>
    ${tabbed('fl.tab.fight', [
    { id: 'overview', label: 'Overview', html: `<section class="card takeaways"><h2>What happened</h2><ul>${[...fa.summary, ...(ma?.summary || [])].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>${kudosCard(kudos, lk, r, fight.id)}` },
    { id: 'deaths', label: 'Deaths', count: fightDeaths.length, html: deathsTab },
    { id: 'mechanics', label: 'Mechanics', count: avoidHits, html: mechanicsFightHtml(ma, lk, r, fight) },
    { id: 'players', label: 'Players', html: `${playersCard(fight, detail, fightDeaths, rankings, lk, r)}
      <section class="grid2">
        ${throughputCard('Damage done', throughput(detail.damage, fight, lk), lk, detail.errors.damage, r, fight)}
        ${throughputCard('Healing done', throughput(detail.healing, fight, lk), lk, detail.errors.healing, r, fight)}
      </section>` },
    { id: 'prep', label: 'Prep & utility', html: `<section class="grid2">
        <div class="stack">
          ${consumablesCard(cons, lk, detail.errors.combatants || detail.errors.potions)}
          ${raidBuffsHtml(buffs, debuffs)}
        </div>
        <div class="stack">
          ${utilityCard('Interrupts', utility(detail.interrupts, 'interrupt', lk), lk, detail.errors.interrupts, 'No interrupts recorded.')}
          ${utilityCard('Dispels', utility(detail.dispels, 'dispel', lk), lk, detail.errors.dispels, 'No dispels recorded.')}
        </div>
      </section>` },
  ])}
    ${rawBlock('fight', fight)}${rawBlock('deaths', fightDeaths)}${rawBlock('death windows', windows)}${rawBlock('fight detail', detail)}${rawBlock('mechanic events', mech)}${rawBlock('enemy debuffs', enemyDebuffs)}`;
  bindTabs();
  bindRefresh(r);
  $('#compare-pull')?.addEventListener('change', (e) => {
    if (e.target.value) location.hash = href({ ...r, compare: Number(e.target.value) });
  });
  $('#compare-log')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = e.target.querySelector('.form-error');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    const link = parseReportLink(e.target.link.value);
    if (!link) return fail('That doesn\'t look like a Warcraft Logs report link.');
    if (link.host !== r.host) return fail('That log is on a different Warcraft Logs site.');
    if (link.code === r.code) {
      if (link.fight != null && link.fight !== fight.id) location.hash = href({ ...r, compare: link.fight });
      else fail('That\'s this log. Pick a pull from the menu instead.');
      return;
    }
    // A link to a specific pull (?fight=N) compares with that pull; otherwise the compare page picks one.
    location.hash = href({ ...r, code2: link.code, compare: link.fight });
  });
}

// "Pull 3 · wipe 9.3%" / "Pull 4 · kill", numbered among this boss's pulls in the log.
function pullLabel(pulls, f) {
  return `Pull ${pulls.findIndex((x) => x.id === f.id) + 1} · ${f.kill ? 'kill' : `wipe ${fmtPct(remainingPct(f))}`}`;
}

// ---------- compare two pulls ----------

const signed = (n, fmt = String) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

function changeCell(change) {
  if (change == null) return '<td class="num muted">–</td>';
  const p = Math.round(change * 100);
  return `<td class="num ${p <= -10 ? 'no' : p >= 10 ? 'yes' : 'muted'}">${signed(p)}%</td>`;
}

// Boss health and raid DPS over time for both pulls, on a shared time axis: where the later pull pulled ahead or
// fell behind. Each chart is one measure, so there's only one y-axis.
function compareTimeline(fa, fb, ga, gb, A, B) {
  const xMax = Math.max(fa.endTime - fa.startTime, fb.endTime - fb.startTime);
  const plain = (s) => s.replace(/&[^;]+;/g, (m) => ({ '&amp;': '&', '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' })[m] || m);
  const health = lineChart([{ label: plain(A), points: bossHealth(ga?.health, fa) }, { label: plain(B), points: bossHealth(gb?.health, fb) }],
    { label: 'Boss health over time in both pulls', yMax: 100, yFmt: (v) => `${Math.round(v)}%`, xMax });
  const dps = lineChart([{ label: plain(A), points: raidDps(ga?.damage, fa) }, { label: plain(B), points: raidDps(gb?.damage, fb) }],
    { label: 'Raid DPS over time in both pulls', yFmt: fmtNum, xMax });
  if (!health && !dps) {
    return '<section class="card"><h2>Over time</h2><p class="muted">Couldn\'t load boss health or raid DPS over time for these pulls.</p></section>';
  }
  return `<section class="card timeline"><h2>Over time</h2>
    ${health ? `<h3>Boss health</h3>${health}` : '<p class="muted">Boss health over time isn\'t available for these pulls.</p>'}
    ${dps ? `<h3>Raid DPS <span class="muted small">(10-second average)</span></h3>${dps}` : '<p class="muted">Raid DPS over time isn\'t available for these pulls.</p>'}
    <p class="hint">Hover the charts for both pulls' values every 5 seconds. Where the later pull's line is lower on boss health, it was ahead.</p>
  </section>`;
}

// Two pulls of one boss. r.fight is a pull in r.code; r.compare is a pull in r.code2 when comparing across logs
// (this week against last), else in the same log. Across logs without r.compare, the other log's kill (or best
// wipe) is picked. The earlier pull is always on the left.
async function renderCompare(r) {
  setLoading('Loading report…');
  const home = await loadReport(r);
  const { report, lk } = home;
  remember({ kind: 'report', code: r.code, host: r.host, title: report.title });
  const fight = (report.fights || []).find((f) => f.id === r.fight);
  if (!fight) throw new Error('That pull isn\'t a boss pull in this report.');
  const crossLog = !!r.code2 && r.code2 !== r.code;
  const otherR = crossLog ? { ...r, code: r.code2, code2: null } : r;
  if (crossLog) setLoading('Loading the other report…');
  const other = crossLog ? await loadReport(otherR) : home;
  const otherPulls = (other.report.fights || []).filter((f) => f.encounterID === fight.encounterID);
  if (!otherPulls.length) throw new Error(`That log has no ${fight.name} pulls to compare with.`);
  const target = r.compare != null ? (other.report.fights || []).find((f) => f.id === r.compare)
    : otherPulls.find((f) => f.kill) || otherPulls.reduce((best, f) => ((remainingPct(f) ?? 100) < (remainingPct(best) ?? 100) ? f : best));
  if (!target) throw new Error('That pull isn\'t a boss pull in the other report.');
  if (target.encounterID !== fight.encounterID) throw new Error('Those pulls are on different bosses, so there\'s nothing to compare.');
  if (!crossLog && target.id === fight.id) throw new Error('That\'s the same pull twice.');

  const [sa, sb] = [{ ...home, r: { ...r, code2: null }, fight }, { ...other, r: { ...otherR, code2: null }, fight: target }]
    .sort((x, y) => (x.report.startTime + x.fight.startTime) - (y.report.startTime + y.fight.startTime));
  const [fa, fb] = [sa.fight, sb.fight];

  setLoading(`Comparing ${fa.name} pulls…`);
  const tracked = trackedNames([fa.name]);
  const load = (s) => Promise.all([
    fetchFightDetail(s.r.host, s.r.code, s.fight),
    mechanicsFor(s.fight.name) ? fetchMechanicEvents(s.r.host, s.r.code, [s.fight.id], tracked) : null,
    fetchEnemyDebuffs(s.r.host, s.r.code, s.fight),
    fetchRaidBuffEvents(s.r.host, s.r.code, [s.fight.id]),
    fetchNamedCasts(s.r.host, s.r.code, [s.fight.id], RAID_COOLDOWNS),
    fetchFightGraphs(s.r.host, s.r.code, s.fight),
  ]);
  const [da, db] = await Promise.all([load(sa), load(sb)]);
  const side = (s, [detail, mech, enemyDebuffs, buffEvents, cdCasts]) => ({
    ...summarizePull({ fight: s.fight, deaths: s.deaths.filter((d) => d.fight === s.fight.id), detail, mech, enemyDebuffs, buffEvents, cdCasts },
      s.lk, specInfo(s.lk, [detail.damage, detail.healing])),
    r: s.r,
  });
  const c = comparePulls(side(sa, da), side(sb, db));
  const label = (s) => {
    const pulls = s.report.fights.filter((f) => f.encounterID === s.fight.encounterID);
    return esc(`${crossLog ? `${fmtDay(s.report.startTime + s.fight.startTime)} · ` : ''}${pullLabel(pulls, s.fight)}`);
  };
  const A = label(sa);
  const B = label(sb);
  const timelineHtml = compareTimeline(fa, fb, da[5], db[5], A, B);
  const pullLinkOf = (s, text) => `<a href="${href({ ...s.r, fight: s.fight.id, compare: null })}">${text}</a>`;
  const pullLink = (f, text) => pullLinkOf(f === fa ? c.a : c.b, text);
  const headRow = (first) => `<thead><tr><th>${first}</th><th>${pullLink(fa, A)}</th><th>${pullLink(fb, B)}</th></tr></thead>`;
  // Across logs, any of the other log's pulls of this boss can be picked instead.
  const otherPicker = crossLog && otherPulls.length > 1 ? `<label class="select-label">Pull from ${esc(other.report.title)}:
      <select id="compare-other">${otherPulls.map((f) => `<option value="${f.id}"${f.id === target.id ? ' selected' : ''}>${esc(pullLabel(otherPulls, f))}</option>`).join('')}</select></label>` : '';
  const t = (ms) => (ms == null ? '<span class="muted">–</span>' : fmtTime(ms));
  const hitsOf = (s) => (s.mech ? s.mech.avoid.reduce((n, x) => n + x.hits, 0) : null);

  const outcome = `<section class="card"><h2>${esc(fa.name)}: ${A} vs ${B}</h2>
    ${otherPicker}
    ${c.highlights.length ? `<ul class="issues">${c.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    <table class="table compare">${headRow('')}<tbody>
      <tr><td>Result</td>${[c.a, c.b].map((s) => `<td><span class="badge ${s.kill ? 'kill' : 'wipe'}">${s.kill ? 'Kill' : `Wipe · ${fmtPct(s.remaining)}`}</span></td>`).join('')}</tr>
      <tr><td>Duration</td><td>${fmtTime(c.a.duration)}</td><td>${fmtTime(c.b.duration)}</td></tr>
      <tr><td>Deaths</td><td>${c.a.deaths.length}</td><td>${c.b.deaths.length}</td></tr>
      <tr><td>First death</td><td>${t(c.a.firstDeath)}</td><td>${t(c.b.firstDeath)}</td></tr>
      <tr><td>Half the raid down</td><td>${t(c.a.collapse)}</td><td>${t(c.b.collapse)}</td></tr>
      ${c.a.mech || c.b.mech ? `<tr><td>Avoidable hits</td><td>${hitsOf(c.a) ?? '–'}</td><td>${hitsOf(c.b) ?? '–'}</td></tr>` : ''}
      <tr><td>Players</td><td>${c.a.pids.length}</td><td>${c.b.pids.length}</td></tr>
    </tbody></table>
  </section>`;

  const deathList = (s) => (s.deaths.length ? `<table class="table"><tbody>${s.deaths.map((d) => `<tr>
      <td class="num muted">${fmtTime(d.at)}</td>
      <td>${playerLink(s.lk, d.pid, s.r, s.fight.id)}${c.diedBoth.includes(d.key) ? ' <span class="tag" title="Died in both pulls">both</span>' : ''}</td>
      <td class="muted">${d.abilityId ? spellLink(s.lk, d.abilityId, s.lk.abilityName(d.abilityId)) : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody died.</p>');
  const deathsHtml = `<section class="grid2">
    <article class="card"><h2>Deaths · ${pullLink(fa, A)}</h2>${deathList(c.a)}</article>
    <article class="card"><h2>Deaths · ${pullLink(fb, B)}</h2>${deathList(c.b)}</article>
  </section>`;

  const avoidRows = c.avoid.map((x) => `<tr><td>${spellLink(x.a ? c.a.lk : c.b.lk, x.a?.abilityId ?? x.b?.abilityId, x.name)}</td>
    <td class="num">${x.a?.hits ?? 0}</td><td class="num">${x.b?.hits ?? 0}</td></tr>`).join('');
  const intRows = c.interrupts.map((x) => `<tr><td>${spellLink(x.a ? c.a.lk : c.b.lk, x.a?.abilityId ?? x.b?.abilityId, x.name)}</td>
    <td class="num">${x.a ? `${x.a.wentOff} went off · ${x.a.interrupted} stopped` : '–'}</td>
    <td class="num">${x.b ? `${x.b.wentOff} went off · ${x.b.interrupted} stopped` : '–'}</td></tr>`).join('');
  // After the first lust the raid is sated for 10 minutes, so another cast in that time only reaches pets.
  const satedNote = (name, list, x) => (name === 'Bloodlust' && list[0] !== x && x.at - list[0].at < 600_000 ? ' <span class="muted">(pets only: the raid is sated)</span>' : '');
  const cdTimes = (name, list, s) => (list.length ? list.map((x) => `${fmtTime(x.at)} <span class="muted">${esc(s.lk.actor(x.pid)?.name || '')}</span>${satedNote(name, list, x)}`).join('<br>') : '<span class="no">not used</span>');
  const cdRows = c.cooldowns.map((x) => `<tr><td>${esc(x.name)}</td><td>${cdTimes(x.name, x.a, c.a)}</td><td>${cdTimes(x.name, x.b, c.b)}</td></tr>`).join('');
  const mechanicsHtml = `
    ${avoidRows ? `<section class="card"><h2>Avoidable hits</h2><table class="table compare">${headRow('Ability')}<tbody>${avoidRows}</tbody></table></section>` : ''}
    ${intRows ? `<section class="card"><h2>Interrupts</h2><table class="table compare">${headRow('Enemy cast')}<tbody>${intRows}</tbody></table></section>` : ''}
    <section class="card"><h2>Raid cooldowns</h2>
      ${cdRows ? `<table class="table compare">${headRow('Cooldown')}<tbody>${cdRows}</tbody></table>` : '<p class="muted">No raid cooldowns or Bloodlust were cast in either pull.</p>'}
      <p class="hint">Bloodlust, Heroism, Time Warp and Ancient Hysteria are shown together as Bloodlust.</p>
    </section>
    ${!avoidRows && !intRows && !(c.a.mech || c.b.mech) ? `<p class="hint">There's no mechanics list for ${esc(fa.name)} yet, so only cooldowns are compared.</p>` : ''}`;

  const out = (p) => (p ? fmtNum(p.role === 'healer' ? p.hps : p.dps) : '<span class="muted">–</span>');
  const playerRows = c.players.map((p) => `<tr>
    <td>${p.b ? playerTag(c.b.lk, p.b.pid) : playerTag(c.a.lk, p.a.pid)} <span class="muted">${esc(p.b?.spec || p.a?.spec || '')}</span></td>
    <td class="num">${out(p.a)}</td><td class="num">${out(p.b)}</td>${changeCell(p.change)}
    <td class="num">${p.a?.active != null ? `${Math.round(p.a.active * 100)}%` : '–'} → ${p.b?.active != null ? `${Math.round(p.b.active * 100)}%` : '–'}</td>
    <td class="num">${p.a ? (p.a.diedAt != null ? `<span class="no">${fmtTime(p.a.diedAt)}</span>` : '') : '<span class="muted">out</span>'}</td>
    <td class="num">${p.b ? (p.b.diedAt != null ? `<span class="no">${fmtTime(p.b.diedAt)}</span>` : '') : '<span class="muted">out</span>'}</td>
    <td class="num">${p.a?.avoid ?? '–'} → ${p.b?.avoid ?? '–'}</td>
  </tr>`).join('');
  const playersHtml = `<section class="card"><h2>Players</h2>
    <p class="hint">DPS (HPS for healers) per second alive in each pull, so an early death doesn't read as low output; the Died columns show the deaths. Biggest drop first. "out" means they weren't in that pull.</p>
    <table class="table compare players"><thead><tr><th>Player</th><th class="num">${A}</th><th class="num">${B}</th><th class="num">Change</th>
      <th class="num">Active</th><th class="num">Died (A)</th><th class="num">Died (B)</th><th class="num">Avoidable hits</th></tr></thead>
    <tbody>${playerRows}</tbody></table></section>`;

  const coverageRow = (label, va, vb) => `<tr><td>${esc(label)}</td><td>${va}</td><td>${vb}</td></tr>`;
  const buffRows = (c.a.buffs || c.b.buffs ? (c.a.buffs || c.b.buffs).map((x) => {
    const ba = c.a.buffs?.find((y) => y.key === x.key);
    const bb = c.b.buffs?.find((y) => y.key === x.key);
    const cell = (y) => (y ? `<span class="${y.pct >= 1 ? 'yes' : 'no'}">${y.have}/${y.total}</span>` : '–');
    return coverageRow(x.label, cell(ba), cell(bb));
  }) : []).join('');
  const debuffRows = (c.a.debuffs || c.b.debuffs ? (c.a.debuffs || c.b.debuffs).map((x) => {
    const cell = (y) => (y ? `<span class="${y.uptime >= y.target ? 'yes' : 'no'}">${Math.round(y.uptime * 100)}%</span>` : '–');
    return coverageRow(x.label, cell(c.a.debuffs?.find((y) => y.key === x.key)), cell(c.b.debuffs?.find((y) => y.key === x.key)));
  }) : []).join('');
  const who = (pids, s) => pids.map((id) => playerTag(s.lk, id)).join(', ');
  const setupHtml = `<section class="card"><h2>Setup</h2>
    <ul class="issues">
      <li>${c.swappedIn.length || c.swappedOut.length
    ? `${c.swappedOut.length ? `Out: ${who(c.swappedOut, c.a)}. ` : ''}${c.swappedIn.length ? `In: ${who(c.swappedIn, c.b)}.` : ''}` : 'Same players in both pulls.'}</li>
      ${c.specChanges.map((s) => `<li>${playerTag(c.b.lk, s.pid)} changed spec: ${esc(s.from)} → ${esc(s.to)}.</li>`).join('')}
      <li>No potion at all: ${c.a.noPotions.length} → ${c.b.noPotions.length}.</li>
    </ul>
    ${buffRows || debuffRows ? `<table class="table compare">${headRow('Buff or debuff')}<tbody>${buffRows}${debuffRows}</tbody></table>
      <p class="hint">Buffs are players who had it at the pull; debuffs are uptime on enemies.</p>` : ''}
  </section>`;

  view.innerHTML = `
    ${reportHeader(r, report, [{ label: `${esc(fa.name)} · ${crossLog ? `compare with ${esc(fmtDay(other.report.startTime))}` : 'compare'}` }])}
    ${tabbed('fl.tab.compare', [
    { id: 'overview', label: 'Overview', html: `${outcome}${timelineHtml}${deathsHtml}` },
    { id: 'mechanics', label: 'Mechanics & cooldowns', html: mechanicsHtml },
    { id: 'players', label: 'Players', html: playersHtml },
    { id: 'setup', label: 'Setup', html: setupHtml },
  ])}
    ${rawBlock('timeline graphs', { a: da[5], b: db[5] })}${rawBlock('compare', { a: { ...c.a, lk: undefined, players: [...c.a.players.values()], cooldowns: [...c.a.cooldowns] }, b: { ...c.b, lk: undefined, players: [...c.b.players.values()], cooldowns: [...c.b.cooldowns] } })}`;
  bindTabs();
  bindRefresh(r);
  $('#compare-other')?.addEventListener('change', (e) => { location.hash = href({ ...r, compare: Number(e.target.value) }); });
}

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 };

const ROLE_LABEL = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };

function playersCard(fight, detail, fightDeaths, rankings, lk, r) {
  const secs = Math.max(1, (fight.endTime - fight.startTime) / 1000);
  const diedAt = new Map(fightDeaths.map((d) => [d.targetID, d.timestamp]));
  const rows = raidPlayers(fight, lk).map((pid) => {
    const d = findEntry(detail.damage, pid);
    const h = findEntry(detail.healing, pid);
    const spec = specOf(d) || specOf(h);
    const role = roleOf(lk.actor(pid)?.subType, spec);
    const output = role === 'healer' ? (h?.total || 0) / secs : (d?.total || 0) / secs;
    return { pid, spec, role, output, parse: findRanking(rankings, fight.id, lk.actor(pid)?.name)?.rankPercent ?? null };
  }).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.output - a.output);
  if (!rows.length) return '';
  return `<section class="card"><h2>Players</h2>
    <p class="hint">Pick a player for their cooldown usage, active time and tips on this pull.</p>
    <table class="table players"><thead><tr><th>Player</th><th>Spec</th><th>Role</th><th class="num">Output</th><th class="num">Parse</th><th>Died</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td>${playerLink(lk, p.pid, r, fight.id)}</td><td>${esc(p.spec || '?')}</td><td class="muted">${ROLE_LABEL[p.role]}</td>
      <td class="num">${fmtNum(p.output)} <span class="muted">${p.role === 'healer' ? 'HPS' : 'DPS'}</span></td>
      <td class="num">${parseBadge(p.parse)}</td>
      <td class="muted">${diedAt.has(p.pid) ? fmtTime(diedAt.get(p.pid) - fight.startTime) : ''}</td></tr>`).join('')}
    </tbody></table></section>`;
}

const TIP_ICONS = { major: '!', minor: '•', info: 'i', good: '✓' };

// Everyone in the log, by role, beside the report overview. Each name opens their whole-night page.
function reportRosterHtml(report, lk, totals, s, r) {
  const ids = [...new Set((report.fights || []).flatMap((f) => raidPlayers(f, lk)))];
  if (!ids.length) return '';
  const deathsOf = new Map(s.deathCounts);
  const groups = { tank: [], healer: [], dps: [], unknown: [] };
  for (const pid of ids) {
    const spec = specOf(findEntry(totals?.damage, pid)) || specOf(findEntry(totals?.healing, pid));
    const className = lk.actor(pid)?.subType;
    groups[spec ? roleOf(className, spec) : 'unknown'].push({ pid, spec, className, name: lk.actor(pid)?.name || '' });
  }
  const item = (p) => `<li><a class="team-member" style="--cls:${classColor(p.className)}" href="${href({ ...r, fight: null, player: p.pid })}"
      title="${esc([p.spec, p.className].filter(Boolean).join(' '))}">
    <img class="spec-icon" src="${specIcon(p.className, p.spec)}" alt="" loading="lazy" data-optional>
    <span class="player">${esc(p.name)}</span>
    ${deathsOf.get(p.pid) ? `<span class="team-att" title="Deaths">☠${deathsOf.get(p.pid)}</span>` : ''}
  </a></li>`;
  return `<aside class="card raid-team report-roster"><h2>Raid roster <span class="muted">${ids.length}</span></h2>
    <p class="hint">Pick a player for their whole night, then drill into any boss.</p>
    ${TEAM_ROLES.filter(([role]) => groups[role].length).map(([role, label]) => `<div class="team-role">
      <h3>${label} <span class="muted">${groups[role].length}</span></h3>
      <ul class="team-list">${groups[role].sort((a, b) => (a.className || '').localeCompare(b.className || '') || a.name.localeCompare(b.name)).map(item).join('')}</ul>
    </div>`).join('')}
  </aside>`;
}

// One player's gear, laid out like the character sheet: armour on the left, jewellery and weapons on the right.
const GEAR_COLUMNS = [[0, 1, 2, 14, 4, 8, 9, 5], [6, 7, 10, 11, 12, 13, 15, 16]];

function playerGearHtml(prepRow) {
  if (!prepRow?.gear.length) {
    return '<section class="card"><h2>Gear</h2><p class="muted">No gear in this log. It needs Advanced Combat Logging turned on in game.</p></section>';
  }
  const bySlot = new Map(prepRow.gear.map((g) => [g.slot, g]));
  const row = (slot) => {
    const g = bySlot.get(slot);
    if (!g) return `<li class="gear-row empty"><span class="gear-item q-poor"></span><span class="gear-slot">${esc(SLOT_NAMES[slot])}</span><span class="muted">Empty</span></li>`;
    const gems = (g.gems || []).filter((x) => x.id).length;
    const enchant = ENCHANT_SLOTS.includes(slot)
      ? (g.permanentEnchant ? '<span class="yes">Enchanted</span>' : '<span class="no">No enchant</span>') : '';
    return `<li class="gear-row">
      ${gearIcon(g)}
      <span class="gear-slot">${itemNameLink(g)}</span>
      <span class="gear-meta">${g.itemLevel ? `<b>${Number(g.itemLevel)}</b>` : ''}${gems ? ` · ${gems} gem${gems === 1 ? '' : 's'}` : ''}</span>
      <span class="gear-enchant">${enchant}</span>
    </li>`;
  };
  // A two-hander leaves the off hand empty, which isn't a problem worth showing.
  const shown = (slot) => bySlot.has(slot) || slot !== 16;
  return `<section class="card"><h2>Gear <span class="muted">${prepRow.ilvl ? `· item level ${prepRow.ilvl.toFixed(1)}` : ''}</span></h2>
    ${prepRow.missingEnchants.length ? `<p class="no">Missing enchants: ${esc(prepRow.missingEnchants.join(', '))}</p>` : '<p class="yes">Every enchantable slot is enchanted.</p>'}
    <div class="gear-sheet">${GEAR_COLUMNS.map((col) => `<ul class="gear-list">${col.filter(shown).map(row).join('')}</ul>`).join('')}</div>
    <p class="hint">From their last pull of the night. Hover an item for its Wowhead tooltip with enchant and gems.</p>
  </section>`;
}

async function renderNightPlayer(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember({ kind: 'report', code: r.code, host: r.host, title: report.title });
  const actor = lk.actor(r.player);
  if (!actor || actor.type !== 'Player') throw new Error('That player isn\'t in this report.');

  setLoading(`Analysing ${actor.name}'s night…`);
  const fightIDs = (report.fights || []).map((f) => f.id);
  const kills = (report.fights || []).filter((f) => f.kill && (f.friendlyPlayers || []).includes(r.player));
  const tracked = trackedNames((report.fights || []).map((f) => f.name));
  const [tables, prepData, rankingList, mech, buffEvents] = await Promise.all([
    fetchFightTables(r.host, r.code, fightIDs),
    fetchReportPrep(r.host, r.code, fightIDs),
    Promise.all(kills.map((f) => fetchRankings(r.host, r.code, f))),
    tracked.avoid.length ? fetchMechanicEvents(r.host, r.code, fightIDs, { avoid: tracked.avoid }) : null,
    fetchRaidBuffEvents(r.host, r.code, fightIDs),
  ]);
  const s = summarizeReport(report, deaths, lk);
  const tableList = [...tables.values()].flatMap((t) => [t.damage, t.healing]);
  const info = specInfo(lk, tableList);
  const myFights = (report.fights || []).filter((f) => (f.friendlyPlayers || []).includes(r.player) && mechanicsFor(f.name));
  const avoidable = mech && myFights.length
    ? nightMechanics(myFights, mech.damage, lk, (pid) => info(pid).role, deaths).players.find((p) => p.pid === r.player) || { hits: 0, pulls: 0 }
    : null;
  const prepRow = prepData ? prepOverview(report, lk, prepData.combatants, prepData.potions, buffEvents).players.find((p) => p.pid === r.player) : null;
  const np = analyzeNightPlayer({
    report, lk, pid: r.player, deaths,
    firstDeaths: (s.firstDeathCounts.find(([id]) => id === r.player) || [0, 0])[1],
    fightTables: tables,
    rankings: new Map(kills.map((f, i) => [f.id, rankingList[i]])),
    prep: prepRow,
    avoidable,
  });

  const stat = (label, value, cls = '') => `<div class="stat ${cls}"><span class="stat-val">${value}</span><span class="stat-label">${esc(label)}</span></div>`;
  const stats = [
    stat(`${np.outputLabel} (boss fights)`, fmtNum(np.output)),
    np.activePct != null ? stat('Active time', `${Math.round(np.activePct * 100)}%`) : '',
    np.avgParse != null ? stat('Average parse', `${Math.round(np.avgParse)}`, `parse-${parseTier(np.avgParse)}`) : '',
    np.bestParse != null ? stat('Best parse', `${Math.round(np.bestParse)}`, `parse-${parseTier(np.bestParse)}`) : '',
    stat('Deaths', `${np.deaths} / ${np.rows.length}`),
    prepRow?.ilvl ? stat('Item level', prepRow.ilvl.toFixed(1)) : '',
    stat('Time in boss fights', fmtDuration(np.time)),
  ].join('');

  view.innerHTML = `
    ${reportHeader(r, report, [{ label: esc(actor.name) }])}
    <section class="card fight-head">
      <div>
        <h2>${playerTag(lk, r.player)} <span class="muted">${esc(np.spec || '')} ${esc(actor.subType || '')}</span></h2>
        <p class="fight-meta"><span class="muted">${esc(ROLE_LABEL[np.role])} · ${np.rows.length} boss pull${np.rows.length === 1 ? '' : 's'}</span></p>
      </div>
    </section>
    <section class="stats">${stats}</section>
    <section class="card"><h2>Night summary</h2>
      ${np.highlights.length ? `<ul class="tips">${np.highlights.map((t) => `<li class="tip ${t.level}"><span class="tip-icon">${TIP_ICONS[t.level]}</span><span>${esc(t.text)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to flag.</p>'}
    </section>
    ${playerGearHtml(prepRow)}
    <section class="card"><h2>Boss by boss</h2>
      <p class="hint">Open a pull for that boss's cooldown usage, casts, tips and death recap.</p>
      <table class="table night-pulls"><thead><tr>
        <th>Boss</th><th>Result</th><th class="num">${np.outputLabel}</th><th class="num">Active</th><th class="num">Parse</th><th>Died</th><th></th>
      </tr></thead><tbody>
      ${np.rows.map((row) => `<tr>
        <td>${esc(row.fight.name)} <span class="muted">#${row.pullNo}</span></td>
        <td><span class="badge ${row.fight.kill ? 'kill' : 'wipe'}">${row.fight.kill ? `Kill · ${fmtTime(row.duration)}` : `Wipe · ${fmtPct(remainingPct(row.fight))}`}</span></td>
        <td class="num">${fmtNum(np.role === 'healer' ? row.hps : row.dps)}</td>
        <td class="num">${row.activePct == null ? '' : `${Math.round(row.activePct * 100)}%`}</td>
        <td class="num">${row.fight.kill ? parseBadge(row.parse) : ''}</td>
        <td class="${row.diedAt != null ? 'no' : 'muted'}">${row.diedAt != null ? fmtTime(row.diedAt) : ''}</td>
        <td><a href="${href({ ...r, fight: row.fight.id, player: r.player })}">Details →</a></td>
      </tr>`).join('')}
      </tbody></table>
    </section>
    ${rawBlock('night rows', np.rows.map((x) => ({ ...x, fight: x.fight.id })))}`;
  bindRefresh(r);
}

async function renderPlayer(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember({ kind: 'report', code: r.code, host: r.host, title: report.title });
  const fight = (report.fights || []).find((f) => f.id === r.fight);
  if (!fight) throw new Error(`Fight ${r.fight} isn't a boss pull in this report.`);
  const actor = lk.actor(r.player);
  if (!actor || actor.type !== 'Player') throw new Error('That player isn\'t in this report.');

  setLoading(`Analysing ${actor.name}…`);
  const fightDeaths = deaths.filter((d) => d.fight === fight.id);
  const [detail, casts, rankings, mech, buffEvents] = await Promise.all([
    fetchFightDetail(r.host, r.code, fight),
    fetchPlayerCasts(r.host, r.code, fight, r.player),
    fetchRankings(r.host, r.code, fight),
    mechanicsFor(fight.name) ? fetchMechanicEvents(r.host, r.code, [fight.id], trackedNames([fight.name])) : null,
    fetchRaidBuffEvents(r.host, r.code, [fight.id]),
  ]);
  const info = specInfo(lk, [detail.damage, detail.healing]);
  // Aura uptimes are only fetched for specs that have checks written.
  const checks = SPEC_MODULES[info(r.player).classSpec];
  const auras = checks
    ? await fetchPlayerAuras(r.host, r.code, fight, r.player, checks.filter((c) => c.kind === 'debuff').flatMap((c) => c.names))
    : null;
  const prep = consumables(fight, detail.combatants, detail.potions, lk, buffEvents).rows.find((x) => x.pid === r.player) || null;
  const pa = analyzePlayer({
    fight, pid: r.player, lk, damage: detail.damage, healing: detail.healing,
    casts, deaths: fightDeaths, prep, rankings, auras,
    mechanics: mech ? analyzeMechanics(fight, mech.damage, mech.casts, detail.interrupts, lk, (pid) => info(pid).role, fightDeaths) : null,
  });

  const pulls = report.fights.filter((f) => f.encounterID === fight.encounterID && (f.friendlyPlayers || []).includes(r.player));
  const idx = pulls.findIndex((f) => f.id === fight.id);
  const nav = `<nav class="pull-nav">
    ${idx > 0 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx - 1].id })}">← Previous pull</a>` : ''}
    ${idx >= 0 && idx < pulls.length - 1 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx + 1].id })}">Next pull →</a>` : ''}
    <a class="button secondary" href="${href({ ...r, fight: null })}">Whole night</a>
  </nav>`;
  const pullNo = pullNumber(report, fight);

  const stat = (label, value, cls = '') => `<div class="stat ${cls}"><span class="stat-val">${value}</span><span class="stat-label">${esc(label)}</span></div>`;
  const stats = [
    pa.role !== 'healer' || pa.damageTotal ? stat('DPS', fmtNum(pa.dps)) : '',
    pa.role === 'healer' || pa.hps >= 1000 ? stat('HPS', fmtNum(pa.hps)) : '',
    pa.activePct != null ? stat('Active time', `${Math.round(pa.activePct * 100)}%`) : '',
    pa.overhealPct != null && pa.role === 'healer' ? stat('Overheal', `${Math.round(pa.overhealPct * 100)}%`) : '',
    pa.ranking?.rankPercent != null ? stat('Parse', `${Math.round(pa.ranking.rankPercent)}`, `parse-${parseTier(pa.ranking.rankPercent)}`) : '',
    stat('Alive', pa.death ? `${fmtTime(pa.alive)} / ${fmtTime(pa.duration)}` : 'Whole fight'),
  ].join('');

  const cdRows = pa.cooldowns.map((c) => `<tr class="${c.uses < c.possible ? 'short' : ''}">
    <td>${spellLink(lk, c.abilityId, c.name)}${c.kind === 'defensive' ? ' <span class="muted">(defensive)</span>' : ''}</td>
    <td class="num"><b>${c.uses}</b> / ${c.possible}</td>
    <td class="muted">${c.times.map((t) => fmtTime(t)).join(', ') || 'never'}</td></tr>`).join('');

  view.innerHTML = `
    ${reportHeader(r, report, [
    { label: `${esc(fight.name)} · pull ${pullNo}`, href: href({ ...r, player: null }) },
    { label: esc(actor.name) },
  ])}
    <section class="card fight-head">
      <div>
        <h2>${playerTag(lk, r.player)} <span class="muted">${esc(pa.spec || '')} ${esc(actor.subType || '')}</span></h2>
        <p class="fight-meta"><span class="badge ${fight.kill ? 'kill' : 'wipe'}">${fight.kill ? 'Kill' : `Wipe · ${fmtPct(remainingPct(fight))}`}</span>
          <span class="muted">${esc(ROLE_LABEL[pa.role])}</span></p>
      </div>
      ${nav}
    </section>
    <section class="stats">${stats}</section>
    <section class="card"><h2>Tips</h2>
      ${pa.tips.length ? `<ul class="tips">${pa.tips.map((t) => `<li class="tip ${t.level}"><span class="tip-icon">${TIP_ICONS[t.level]}</span><span>${esc(t.text)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to flag.</p>'}
      ${pa.death ? `<p><a href="${href({ ...r, player: null })}" data-open-tab="deaths">See the death recap on the pull page →</a></p>` : ''}
      ${pa.hasSpecModule ? '' : `<p class="hint">These are general checks. Buff and DoT uptime checks for ${esc(pa.spec || 'this spec')} ${esc(actor.subType || '')} aren't written yet.</p>`}
    </section>
    ${uptimesHtml(pa.uptimes, lk)}
    <section class="grid2">
      <article class="card"><h2>Cooldowns</h2>
        ${cdRows ? `<table class="table cds"><thead><tr><th>Cooldown</th><th class="num">Used / possible</th><th>When</th></tr></thead><tbody>${cdRows}</tbody></table>
        <p class="hint">"Possible" assumes the cooldown was ready at the pull and used again as soon as it came back, while the player was alive.</p>`
        : '<p class="muted">No tracked cooldowns for this spec.</p>'}
      </article>
      <article class="card"><h2>Casts</h2>
        ${pa.abilities.length ? `<table class="table"><thead><tr><th>Ability</th><th class="num">Casts</th><th class="num">Per min</th></tr></thead><tbody>
        ${pa.abilities.slice(0, 25).map((a) => `<tr><td>${spellLink(lk, a.id, a.name)}</td><td class="num">${a.casts}</td><td class="num">${a.cpm.toFixed(1)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No casts recorded.</p>'}
      </article>
    </section>
    ${rawBlock('casts', casts)}${rawBlock('auras', auras)}${rawBlock('rankings', rankings)}${rawBlock('damage entry', findEntry(detail.damage, r.player))}${rawBlock('healing entry', findEntry(detail.healing, r.player))}`;
  bindRefresh(r);
}

// ---------- guild view ----------

const GUILD_LIMITS = [10, 25, 50];
// The latest tier's summary uses at most this many logs; older history only loads while under this share of the
// user's hourly API points, leaving the rest for report and player pages.
const LATEST_LOGS = 25;
const HISTORY_BUDGET = 0.6;

function guildHeader(r, guild) {
  const where = [guild.server?.name, guild.server?.region?.slug?.toUpperCase(), guild.faction?.name].filter(Boolean).map(esc).join(' · ');
  return `<section class="report-head">
    <div class="report-title">
      <nav class="crumbs" aria-label="Breadcrumb"><span aria-current="page">${esc(guild.name)}</span></nav>
      <p class="muted">${where}</p>
    </div>
    <div class="head-actions">
      <a class="button secondary" href="https://${esc(r.host)}/guild/id/${Number(guild.id)}" target="_blank" rel="noopener">Warcraft Logs ↗</a>
      <button id="refresh" class="secondary" title="Fetch the latest reports from Warcraft Logs">Refresh</button>
    </div>
  </section>`;
}

function progressionHtml(r, gs) {
  if (!gs.raids.length) return '<section class="card"><p class="muted">No boss pulls in these reports.</p></section>';
  const fightLink = (k, label) => `<a href="${href({ code: k.code, host: r.host, fight: k.fightId })}">${label}</a>`;
  return gs.raids.map((raid) => `<details class="raid" open>
    <summary><span class="raid-name">${esc(raid.name)}</span>
      <span class="muted">${raid.killed}/${raid.bosses.length} killed</span></summary>
    <section class="card"><table class="table progression"><thead><tr>
      <th>Boss</th><th>Status</th><th>First kill</th><th class="num">Pulls</th><th class="num">Wipes to kill</th><th class="num">Fastest</th><th class="num">Nights</th>
    </tr></thead><tbody>
    ${raid.bosses.map((b) => `<tr>
      <td>${esc(b.label)}${b.variant ? ` <span class="muted">${esc(b.variant)}</span>` : ''}</td>
      <td>${b.kills.length ? `<span class="badge kill">Killed${b.kills.length > 1 ? ` ×${b.kills.length}` : ''}</span>`
        : `<span class="badge wipe">${b.bestWipe ? `Best ${fmtPct(b.bestWipe.pct)}` : 'No kill'}</span>`}</td>
      <td>${b.firstKill ? fightLink(b.firstKill, esc(fmtDay(b.firstKill.at))) : '<span class="muted">–</span>'}</td>
      <td class="num">${b.pulls}</td>
      <td class="num">${b.firstKill ? b.wipesBeforeKill : `<span class="muted">${b.wipesBeforeKill}+</span>`}</td>
      <td class="num">${b.fastest ? fightLink(b.fastest, fmtTime(b.fastest.duration)) : '<span class="muted">–</span>'}</td>
      <td class="num">${b.nights}</td>
    </tr>`).join('')}
    </tbody></table></section>
  </details>`).join('');
}

// One chart per boss the guild had to work for this tier: every pull up to the first kill, across nights.
function progressCurvesHtml(r, gs) {
  const bosses = gs.raids.flatMap((raid) => raid.bosses).filter((b) => b.wipesBeforeKill >= 2);
  if (!bosses.length) return '';
  return `<section class="card"><h2>Progression curves</h2>
    <p class="hint">How much of each fight was left at the end of every pull up to the first kill, oldest first. Faint lines split raid nights.</p>
    <div class="curves">${bosses.map((b) => {
    const firstKill = b.attempts.findIndex((a) => a.kill);
    const attempts = firstKill >= 0 ? b.attempts.slice(0, firstKill + 1) : b.attempts;
    return `<div class="curve">
      <h3>${esc(b.label)}${b.variant ? ` <span class="muted">${esc(b.variant)}</span>` : ''}</h3>
      <p class="muted small">${attempts.length} pull${attempts.length === 1 ? '' : 's'} over ${new Set(attempts.map((a) => a.code)).size} night${new Set(attempts.map((a) => a.code)).size === 1 ? '' : 's'}${firstKill >= 0 ? ` · killed ${esc(fmtDay(b.firstKill.at))}` : ''}</p>
      ${progressChart(attempts.map((a) => ({
    pct: a.pct, kill: a.kill, night: a.code, href: href({ code: a.code, host: r.host, fight: a.fightId }),
    title: `${fmtDay(a.at)}: ${a.kill ? 'kill' : `wipe with ${fmtPct(a.pct)} left`} after ${fmtTime(a.duration)}`,
  })), `${b.label}: fight left at the end of each pull`)}
    </div>`;
  }).join('')}</div>
  </section>`;
}

// The report-count menu only trims this list; everything else on the guild page uses the guild's history.
// Logs whose boss pulls haven't been loaded yet (older history, budget permitting) show dashes.
function nightsHtml(r, list, statsByCode, limit) {
  const rows = list.slice(0, limit);
  const dash = '<span class="muted">–</span>';
  return `<section class="card"><div class="card-head"><h2>Raid nights</h2>
      <label class="select-label">Show the last
        <select id="guild-limit">${GUILD_LIMITS.map((n) => `<option value="${n}"${n === limit ? ' selected' : ''}>${n}</option>`).join('')}</select>
        of ${list.length}
      </label></div>
    <table class="table"><thead><tr><th>Date</th><th>Report</th><th>Raid</th><th class="num">Kills</th><th class="num">Wipes</th><th class="num">Boss time</th><th>First kills</th></tr></thead><tbody>
    ${rows.map((rep) => {
    const n = statsByCode.get(rep.code);
    return `<tr>
      <td class="muted">${esc(fmtDay(rep.startTime, { weekday: 'short' }))}</td>
      <td><a href="${href({ code: rep.code, host: r.host })}">${esc(rep.title || rep.code)}</a></td>
      <td class="muted">${esc(rep.zone?.name || '')}</td>
      <td class="num">${n ? n.kills : dash}</td>
      <td class="num">${n ? n.wipes : dash}</td>
      <td class="num">${n ? fmtDuration(n.bossTime) : dash}</td>
      <td>${n?.newKills.length ? `<span class="yes">${esc(n.newKills.join(', '))}</span>` : ''}</td>
    </tr>`;
  }).join('')}
    </tbody></table></section>`;
}

// Painted-over red X for killed bosses. Defined once and reused by every tile; the turbulence filter roughens
// the edges so it reads as a brush stroke rather than vector lines.
document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <filter id="paint-rough" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="11" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <linearGradient id="paint-red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d11a22"/><stop offset=".5" stop-color="#a3101a"/><stop offset="1" stop-color="#6a0910"/>
    </linearGradient>
    <symbol id="blood-x" viewBox="0 0 100 100">
      <g filter="url(#paint-rough)" fill="url(#paint-red)">
        <!-- Two thick brush strokes, heavier where the brush was pressed and tapering where it lifted. -->
        <path d="M5 13C13 8 22 14 31 22C43 32 55 43 67 55C77 65 87 75 96 85C99 89 96 96 90 94C80 89 70 79 60 71C48 61 36 51 24 41C16 34 8 29 3 23C0 19 1 15 5 13Z"/>
        <path d="M95 5C99 8 99 14 94 18C84 28 74 39 63 50C52 61 41 72 29 84C22 91 14 98 8 96C3 94 3 89 7 85C18 74 30 62 42 50C54 38 66 26 78 14C84 8 90 2 95 5Z" opacity=".95"/>
        <!-- Drips running down from where the strokes are heaviest. -->
        <path d="M46 56C49 64 48 72 50 80C51 86 49 90 47 90S43 86 44 80C45 72 44 64 46 56Z"/>
        <path d="M24 42C26 48 25 53 26 58C26 61 24 62 23 60C22 55 22 48 24 42Z"/>
        <path d="M70 60C72 65 71 70 72 74C72 77 70 77 69 75C68 71 68 65 70 60Z"/>
        <circle cx="47" cy="94" r="2.6"/>
        <!-- Splatter flicked off the brush. -->
        <circle cx="86" cy="22" r="2.2"/><circle cx="12" cy="86" r="1.8"/><circle cx="80" cy="96" r="1.4"/>
        <circle cx="6" cy="40" r="1.3"/><circle cx="97" cy="58" r="1.5"/><circle cx="60" cy="8" r="1.2"/>
      </g>
    </symbol>
  </defs>
</svg>`);

const shortDate = (ms) => fmtDay(ms);

function bossPortrait(b) {
  return `<div class="boss-portrait">
    <img src="${bossImage(b.id)}" alt="" loading="lazy" data-optional>
    ${b.killed ? '<svg class="blood-x" viewBox="0 0 100 100" aria-hidden="true"><use href="#blood-x"/></svg>' : ''}
  </div>`;
}

// Raid progress grouped by expansion, newest first. Each raid is collapsible (the latest tier starts open) and
// shows its bosses as a track in raid order: the line turns gold between consecutive kills, killed bosses are
// greyed under the red X with their first kill date, the rest show their best attempt.
function raidTimelineHtml(groups, openZones) {
  if (!groups.length) return '';
  const raidBlock = (raid) => `<details class="raid-progress"${openZones.has(raid.zoneId) ? ' open' : ''}>
    <summary>
      ${raid.zoneId != null ? `<img class="zone-img" src="${zoneImage(raid.zoneId)}" alt="" loading="lazy" data-optional>` : ''}
      <div class="raid-progress-title">
        <h3>${esc(raid.name)}</h3>
        <div class="raid-progress-bar"><span style="width:${raid.total ? ((raid.killed / raid.total) * 100).toFixed(0) : 0}%"></span></div>
      </div>
      ${raid.cleared ? '<span class="badge cleared">Cleared</span>' : `<span class="raid-count">${raid.killed}/${raid.total}</span>`}
    </summary>
    <ol class="boss-track" style="--n:${raid.bosses.length}">
      ${raid.bosses.map((b, i) => `<li class="boss-tile${b.killed ? ' killed' : ''}${b.killed && raid.bosses[i - 1]?.killed ? ' linked' : ''}"
          ${b.variant ? `title="${esc(b.variant)}"` : ''}>
        ${bossPortrait(b)}
        <span class="boss-name">${esc(b.name)}</span>
        <span class="boss-note">${b.killed
    ? `${esc(shortDate(b.firstKill.at))}${b.kills > 1 ? ` · ×${b.kills}` : ''}`
    : b.bestWipe ? `Best ${fmtPct(b.bestWipe.pct)}` : b.pulls ? `${b.pulls} pulls` : 'Not attempted'}</span>
      </li>`).join('')}
    </ol>
  </details>`;
  return `<section class="card raid-gallery"><h2>Raid progress</h2>
    ${groups.map((g) => `<div class="expansion">
      ${groups.length > 1 || g.id !== -1 ? `<h3 class="expansion-name">${esc(g.name)}</h3>` : ''}
      ${g.raids.map(raidBlock).join('')}
    </div>`).join('')}
  </section>`;
}

function guildTilesHtml(t) {
  const tile = (label, value) => `<div class="stat"><span class="stat-val">${value}</span><span class="stat-label">${esc(label)}</span></div>`;
  return `<section class="stats">
    ${tile('Raid nights logged', `${t.nights}${t.capped ? '+' : ''}`)}
    ${t.since ? tile('Logging since', esc(fmtDay(t.since, { year: 'numeric' }))) : ''}
    ${tile('Raids cleared', `${t.cleared} / ${t.raids}`)}
    ${tile('Bosses killed', String(t.bossesKilled))}
  </section>`;
}

const TEAM_ROLES = [['tank', 'Tanks'], ['healer', 'Healers'], ['dps', 'DPS'], ['unknown', 'Role unknown']];

function raidTeamHtml(team, roster) {
  const size = TEAM_ROLES.reduce((n, [role]) => n + team[role].length, 0);
  if (!size) return '';
  const member = (p) => `<li class="team-member" style="--cls:${classColor(p.className)}" title="${esc([p.spec, p.className].filter(Boolean).join(' '))}">
    <img class="spec-icon" src="${specIcon(p.className, p.spec)}" alt="" loading="lazy" data-optional>
    <span class="player">${esc(p.name)}</span>
    <span class="team-att">${roster.total ? `${Math.round(p.pct * 100)}%` : ''}</span>
  </li>`;
  return `<section class="card raid-team"><h2>Raid team <span class="muted">${size}</span></h2>
    <p class="hint">Everyone in at least one of the last 3 raids, with the spec they played most in the latest reports. The % is attendance.</p>
    <div class="team-roles">${TEAM_ROLES.filter(([role]) => team[role].length).map(([role, label]) => `<div class="team-role role-${role}">
      <h3>${label} <span class="muted">${team[role].length}</span></h3>
      <ul class="team-list">${team[role].map(member).join('')}</ul>
    </div>`).join('')}</div>
  </section>`;
}

const ROSTER_STATUS = {
  raiding: ['kill', 'Raiding'],
  lapsed: ['lapsed', 'Lapsed'],
  idle: ['idle', 'Not raiding'],
};

function rosterRow(p, total, hasMembers) {
  const [cls, label] = ROSTER_STATUS[p.status];
  const raided = p.present + p.benched;
  return `<tr>
    <td><span class="player" style="--cls:${classColor(p.className)}">${esc(p.name)}</span>
      ${hasMembers && !p.member ? '<span class="muted">· not in guild</span>' : ''}</td>
    <td class="muted">${esc(p.className || '')}</td>
    <td class="muted">${p.rank == null ? '' : p.rank === 0 ? 'Guild Master' : `Rank ${Number(p.rank)}`}</td>
    <td>${total ? `<span class="meter"><span class="meter-fill ${p.pct >= 0.9 ? 'good' : p.pct >= 0.6 ? 'ok' : 'low'}" style="width:${(p.pct * 100).toFixed(0)}%"></span></span>
      <span class="meter-val">${raided}/${p.span}</span>` : ''}</td>
    <td class="muted">${p.lastRaid ? esc(fmtDay(p.lastRaid)) : ''}</td>
    <td><span class="badge ${cls}">${label}</span></td>
  </tr>`;
}

function rosterHtml(roster) {
  if (!roster.rows.length) {
    return '<section class="card"><p class="muted">No roster available: Warcraft Logs shared neither a member list nor attendance for this guild.</p></section>';
  }
  const c = roster.counts;
  const active = roster.rows.filter((p) => p.status !== 'idle');
  const idle = roster.rows.filter((p) => p.status === 'idle');
  const head = '<thead><tr><th>Player</th><th>Class</th><th>Rank</th><th>Raids</th><th>Last raid</th><th>Status</th></tr></thead>';
  const summary = [
    roster.hasMembers ? `<b>${c.members}</b> member${c.members === 1 ? '' : 's'} on Warcraft Logs` : '',
    `<b>${c.raiding}</b> raiding in the last 3 raids`,
    c.lapsed ? `<b>${c.lapsed}</b> lapsed` : '',
    c.outsiders ? `<b>${c.outsiders}</b> raider${c.outsiders === 1 ? '' : 's'} from outside the guild` : '',
  ].filter(Boolean).join(' · ');
  return `<section class="card"><h2>Roster</h2>
    <p>${summary}</p>
    ${roster.composition.length ? `<div class="composition">${roster.composition.map(([name, n]) => `<span class="comp-chip" style="--cls:${classColor(name)}">
      <span class="player">${esc(name || 'Unknown')}</span> ${n}</span>`).join('')}</div>` : ''}
    ${roster.hasMembers ? '' : '<p class="hint">Warcraft Logs didn\'t share this guild\'s member list, so the roster only shows people seen in its raids.</p>'}
    ${active.length ? `<table class="table roster">${head}<tbody>${active.map((p) => rosterRow(p, roster.total, roster.hasMembers)).join('')}</tbody></table>` : ''}
    ${idle.length ? `<details class="idle-members"><summary>${idle.length} member${idle.length === 1 ? '' : 's'} not in these raids</summary>
      <table class="table roster">${head}<tbody>${idle.map((p) => rosterRow(p, roster.total, roster.hasMembers)).join('')}</tbody></table></details>` : ''}
    <p class="hint">From Warcraft Logs' attendance tracking across the guild's ${roster.total} logged raids, counted from each player's first raid. Benched counts as attended.
      "Lapsed" means they raided before but not in the last 3.</p>
  </section>`;
}

async function renderGuild(r) {
  setLoading('Loading guild…');
  const guild = await fetchGuild(r.host, r.guild);
  // A name/server link becomes an id link, so refreshes, bookmarks and cache keys use the id.
  if (r.guild.id == null) history.replaceState(null, '', guildHref({ host: r.host, guild: { id: guild.id } }));
  const saved = store.get('fl.guildLimit');
  const limit = GUILD_LIMITS.includes(saved) ? saved : 25;

  setLoading(`Loading ${guild.name}'s reports…`);
  const [{ reports: list, capped }, attendance, members] = await Promise.all([
    fetchGuildReportList(r.host, guild.id),
    fetchGuildAttendance(r.host, guild.id),
    fetchGuildMembers(r.host, guild.id),
  ]);
  remember({ kind: 'guild', host: r.host, guild: { id: guild.id }, title: guild.name });

  // The latest tier is the raids in the newest few logs; its summary uses at most the newest LATEST_LOGS logs of
  // those raids, which always load. Older history loads only while the user's hourly API budget allows, and fills
  // in on later visits because each log's pulls are cached once fetched.
  setLoading(`Loading ${guild.name}'s boss pulls…`);
  const tierZones = new Set(list.slice(0, 5).map((rep) => rep.zone?.id).filter((id) => id != null));
  const latestList = list.slice(0, LATEST_LOGS).filter((rep) => tierZones.has(rep.zone?.id));
  const latestFights = await fetchReportFights(r.host, latestList);
  const olderFights = await fetchReportFights(r.host, list.filter((rep) => !latestFights.has(rep.code)), { budgetShare: HISTORY_BUDGET });
  const fights = new Map([...latestFights, ...olderFights]);
  const withFights = list.filter((rep) => fights.has(rep.code)).map((rep) => ({ ...rep, fights: fights.get(rep.code) }));
  const latest = withFights.filter((rep) => latestFights.has(rep.code));

  const zoneIds = list.map((rep) => rep.zone?.id).filter((id) => id != null);
  const [zoneInfo, expansions, sightings] = await Promise.all([
    fetchZoneInfo(r.host, zoneIds),
    fetchZoneExpansions(r.host, zoneIds),
    fetchTeamSpecs(r.host, latestList),
  ]);
  const opts = { difficultyNames: zoneInfo.difficultyNames, zoneEncounters: zoneInfo.encounters, topOnly: true };
  const current = summarizeGuild(latest, opts);
  const history = summarizeGuild(withFights, opts);
  const roster = buildRoster(attendance, members);
  const team = buildRaidTeam(roster, sightings);
  const unloaded = list.length - withFights.length;

  view.innerHTML = `
    ${guildHeader(r, guild)}
    ${list.length ? tabbed('fl.tab.guild', [
    { id: 'overview', label: 'Overview', html: `${guildTilesHtml(guildTotals(list, history.progress, capped))}
      <section class="card takeaways"><h2>Latest tier</h2><ul>${current.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
      ${raidTimelineHtml(groupByExpansion(history.progress, expansions), tierZones)}
      ${unloaded ? `<p class="hint">Boss pulls are loaded for ${withFights.length} of ${list.length} logs. Older raids fill in on later visits as your
        Warcraft Logs API budget allows (it depends on your Warcraft Logs subscription).</p>` : ''}
      ${raidTeamHtml(team, roster)}
      ${progressionHtml(r, current)}
      ${progressCurvesHtml(r, current)}` },
    { id: 'nights', label: 'Raid nights', count: list.length, html: nightsHtml(r, list, new Map(history.nights.map((n) => [n.code, n])), limit) },
    { id: 'roster', label: 'Roster', count: roster.counts.raiding, html: rosterHtml(roster) },
  ]) : '<section class="card notice"><p>No public reports found for this guild.</p></section>'}
    ${rawBlock('guild', guild)}${rawBlock('reports', list)}${rawBlock('attendance', attendance)}${rawBlock('members', members?.members.slice(0, 20))}`;

  bindTabs();
  $('#guild-limit')?.addEventListener('change', (e) => { store.set('fl.guildLimit', Number(e.target.value)); render(); });
  $('#refresh').addEventListener('click', async () => { await clearReportCache(guildCachePrefix(guild.id)); render(); });
}

// ---------- boot ----------

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  try {
    if (!r.code && !r.guild) { renderHome(); return; }
    if (!getToken()) throw new AuthError('Connect your Warcraft Logs account to load reports.');
    if (r.guild) await renderGuild(r);
    else if (r.fight != null && (r.compare != null || r.code2)) await renderCompare(r);
    else if (r.fight != null && r.player != null) await renderPlayer(r);
    else if (r.player != null) await renderNightPlayer(r);
    else if (r.fight != null) await renderFight(r);
    else await renderReport(r);
    if (seq === renderSeq) window.scrollTo(0, 0);
    window.$WowheadPower?.refreshLinks?.();
    if (seq === renderSeq) fillItemNames(view).catch(() => {});
  } catch (err) {
    if (seq === renderSeq) showError(err);
    console.error(err);
  }
}

window.addEventListener('hashchange', render);

(async () => {
  try {
    if (await handleRedirect()) fetchRateLimit(CONFIG.defaultHost).catch(() => {});
  } catch (err) {
    renderAuth();
    showError(err);
    return;
  }
  renderAuth();
  render();
})();
