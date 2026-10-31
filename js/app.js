import { CONFIG } from './config.js';
import { store } from './store.js';
import { getClientId, setClientId, getToken, login, logout, handleRedirect, redirectUri } from './auth.js';
import {
  AuthError, parseReportLink, onRateLimit, fetchRateLimit, fetchReport, fetchDeaths,
  fetchFightDetail, fetchDeathWindows, fetchPlayerCasts, fetchRankings, fetchReportTotals, fetchReportPrep, fetchFightZones,
  clearReportCache,
} from './api.js';
import { prepOverview, SLOT_NAMES } from './prep.js';
import { fightKudos, reportKudos } from './kudos.js';
import { analyzePlayer, findEntry, findRanking, specOf } from './performance.js';
import {
  buildLookups, playerDeaths, summarizeReport, groupByRaid, analyzeFight, consumables, utility, throughput, raidPlayers,
  fmtTime, fmtNum, fmtPct,
} from './analysis.js';
import { classColor } from './mop.js';
import { roleOf } from './cooldowns.js';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- helpers ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k) => (p.get(k) ? Number(p.get(k)) : null);
  return { code: p.get('r'), host: p.get('h') || CONFIG.defaultHost, fight: num('f'), player: num('p') };
}

function href({ code, host, fight, player }) {
  const p = new URLSearchParams({ r: code, h: host });
  if (fight != null) p.set('f', fight);
  if (fight != null && player != null) p.set('p', player);
  return `#${p}`;
}

function playerLink(lk, id, r, fightId) {
  return `<a class="player-link" href="${href({ ...r, fight: fightId, player: id })}">${playerTag(lk, id)}</a>`;
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
  const icon = ab?.icon ? `<img class="icon" alt="" loading="lazy" src="https://assets.rpglogs.com/img/warcraft/abilities/${encodeURIComponent(ab.icon)}" onerror="this.remove()">` : '';
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
  if (connected) $('#logout').onclick = () => { logout(); renderAuth(); render(); };
  else $('#login').onclick = startLogin;
}

function openSettings(message) {
  const dlg = $('#settings');
  $('#client-id').value = getClientId();
  $('#client-id').disabled = !!CONFIG.clientId;
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

$('#link-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseReportLink($('#link-input').value);
  if (!parsed) {
    $('#link-input').setCustomValidity('That doesn\'t look like a Warcraft Logs report link.');
    $('#link-input').reportValidity();
    return;
  }
  $('#link-input').value = '';
  location.hash = href(parsed);
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
      ${getToken() ? '' : '<p><button id="hero-login">Connect Warcraft Logs</button> <span class="hint">You log in with your own Warcraft Logs account. Nothing is stored except in this browser.</span></p>'}
    </section>
    ${recent.length ? `<section class="card"><h2>Recent reports</h2><ul class="recent">
      ${recent.map((r) => `<li><a href="${href(r)}">${esc(r.title || r.code)}</a> <span class="muted">${esc(r.host)} · ${new Date(r.at).toLocaleDateString()}</span></li>`).join('')}
    </ul></section>` : ''}`;
  $('#hero-login')?.addEventListener('click', startLogin);
}

function remember(r, report) {
  const recent = store.get('fl.recent', []).filter((x) => x.code !== r.code);
  recent.unshift({ code: r.code, host: r.host, title: report.title, at: Date.now() });
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
  const trail = [{ label: esc(report.title), href: crumbs.length ? href({ ...r, fight: null }) : null }, ...crumbs];
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
  remember(r, report);
  const s = summarizeReport(report, deaths, lk);
  const fightIDs = (report.fights || []).map((f) => f.id);
  const [totals, prepData, zones] = fightIDs.length
    ? await Promise.all([fetchReportTotals(r.host, r.code, fightIDs), fetchReportPrep(r.host, r.code, fightIDs), fetchFightZones(r.host, r.code)])
    : [null, null, new Map()];
  const kudos = reportKudos({ report, lk, deaths, totals });
  const prep = prepData ? prepOverview(report, lk, prepData.combatants, prepData.potions) : null;

  if (!s.encounters.length) {
    view.innerHTML = `${reportHeader(r, report)}<section class="card notice"><p>This report has no boss encounters.</p></section>`;
    bindRefresh(r);
    return;
  }

  const pullChip = (p, i) => {
    const f = p.fight;
    const label = f.kill ? 'Kill' : fmtPct(f.bossPercentage);
    return `<a class="chip ${f.kill ? 'kill' : 'wipe'}" href="${href({ ...r, fight: f.id })}" title="Pull ${i + 1}: ${fmtTime(p.duration)}, ${p.deaths.length} deaths">
      <b>#${i + 1}</b> ${label} <span>${fmtTime(p.duration)}</span>${p.deaths.length ? ` <span class="deaths">☠${p.deaths.length}</span>` : ''}</a>`;
  };

  const encounterCard = (e) => `<article class="card encounter">
    <header><h3>${esc(e.name)}</h3>
      <span class="badge ${e.kills.length ? 'kill' : 'wipe'}">${e.kills.length ? `Killed${e.fastestKill ? ` · ${fmtTime(e.fastestKill)}` : ''}` : `Best ${fmtPct(e.bestWipe)}`}</span>
    </header>
    <p class="muted">${e.pulls.length} pull${e.pulls.length === 1 ? '' : 's'} · ${e.wipes.length} wipe${e.wipes.length === 1 ? '' : 's'}</p>
    <div class="chips">${e.pulls.map(pullChip).join('')}</div>
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
    { id: 'overview', label: 'Overview', html: overview },
    { id: 'deaths', label: 'Deaths', count: deaths.length, html: deathsTab },
    { id: 'prep', label: 'Prep & gear', html: prepCard(prep, lk) },
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

function gearIcon(g) {
  const extra = new URLSearchParams();
  if (g.itemLevel) extra.set('ilvl', g.itemLevel);
  if (g.permanentEnchant) extra.set('ench', g.permanentEnchant);
  const gems = (g.gems || []).map((x) => x.id).filter(Boolean);
  if (gems.length) extra.set('gems', gems.join(':'));
  const icon = g.icon ? `<img alt="" loading="lazy" src="https://assets.rpglogs.com/img/warcraft/abilities/${encodeURIComponent(g.icon)}" onerror="this.remove()">` : '';
  return `<a class="gear-item q-${QUALITY[g.quality] || 'common'}" href="https://www.wowhead.com/${CONFIG.wowheadFlavor}/item=${Number(g.id)}"
    data-wowhead="${esc(extra.toString())}" target="_blank" rel="noopener" title="${esc(SLOT_NAMES[g.slot] || '')}">
    ${icon}${g.itemLevel ? `<span class="gear-ilvl">${Number(g.itemLevel)}</span>` : ''}</a>`;
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

async function renderFight(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember(r, report);
  const fight = (report.fights || []).find((f) => f.id === r.fight);
  if (!fight) throw new Error(`Fight ${r.fight} isn't a boss pull in this report.`);

  const fightDeaths = deaths.filter((d) => d.fight === fight.id);
  setLoading(`Analysing ${fight.name}…`);
  const [windows, detail, rankings] = await Promise.all([
    fightDeaths.length ? fetchDeathWindows(r.host, r.code, fight, fightDeaths) : [],
    fetchFightDetail(r.host, r.code, fight),
    fetchRankings(r.host, r.code, fight),
  ]);

  const fa = analyzeFight(fight, fightDeaths, windows, lk);
  const cons = consumables(fight, detail.combatants, detail.potions, lk);
  const kudos = fightKudos({ fight, lk, detail, deaths: fightDeaths, prep: cons, rankings });

  const pulls = report.fights.filter((f) => f.encounterID === fight.encounterID);
  const idx = pulls.findIndex((f) => f.id === fight.id);
  const nav = `<nav class="pull-nav">
    ${idx > 0 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx - 1].id })}">← Pull ${idx}</a>` : ''}
    <span>Pull ${idx + 1} of ${pulls.length}</span>
    ${idx < pulls.length - 1 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx + 1].id })}">Pull ${idx + 2} →</a>` : ''}
  </nav>`;

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
      <p class="fight-meta"><span class="badge ${fight.kill ? 'kill' : 'wipe'}">${fight.kill ? 'Kill' : `Wipe · ${fmtPct(fight.bossPercentage)}`}</span>
        <span class="muted">${fmtTime(fight.endTime - fight.startTime)} · ${fa.raidSize} players · ${fightDeaths.length} death${fightDeaths.length === 1 ? '' : 's'}</span></p>
      ${nav}
    </section>
    ${tabbed('fl.tab.fight', [
    { id: 'overview', label: 'Overview', html: `<section class="card takeaways"><h2>What happened</h2><ul>${fa.summary.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>${kudosCard(kudos, lk, r, fight.id)}` },
    { id: 'deaths', label: 'Deaths', count: fightDeaths.length, html: deathsTab },
    { id: 'players', label: 'Players', html: `${playersCard(fight, detail, fightDeaths, rankings, lk, r)}
      <section class="grid2">
        ${throughputCard('Damage done', throughput(detail.damage, fight, lk), lk, detail.errors.damage, r, fight)}
        ${throughputCard('Healing done', throughput(detail.healing, fight, lk), lk, detail.errors.healing, r, fight)}
      </section>` },
    { id: 'prep', label: 'Prep & utility', html: `<section class="grid2">
        ${consumablesCard(cons, lk, detail.errors.combatants || detail.errors.potions)}
        <div class="stack">
          ${utilityCard('Interrupts', utility(detail.interrupts, 'interrupt', lk), lk, detail.errors.interrupts, 'No interrupts recorded.')}
          ${utilityCard('Dispels', utility(detail.dispels, 'dispel', lk), lk, detail.errors.dispels, 'No dispels recorded.')}
        </div>
      </section>` },
  ])}
    ${rawBlock('fight', fight)}${rawBlock('deaths', fightDeaths)}${rawBlock('death windows', windows)}${rawBlock('fight detail', detail)}`;
  bindTabs();
  bindRefresh(r);
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

async function renderPlayer(r) {
  setLoading('Loading report…');
  const { report, lk, deaths } = await loadReport(r);
  remember(r, report);
  const fight = (report.fights || []).find((f) => f.id === r.fight);
  if (!fight) throw new Error(`Fight ${r.fight} isn't a boss pull in this report.`);
  const actor = lk.actor(r.player);
  if (!actor || actor.type !== 'Player') throw new Error('That player isn\'t in this report.');

  setLoading(`Analysing ${actor.name}…`);
  const fightDeaths = deaths.filter((d) => d.fight === fight.id);
  const [detail, casts, rankings] = await Promise.all([
    fetchFightDetail(r.host, r.code, fight),
    fetchPlayerCasts(r.host, r.code, fight, r.player),
    fetchRankings(r.host, r.code, fight),
  ]);
  const prep = consumables(fight, detail.combatants, detail.potions, lk).rows.find((x) => x.pid === r.player) || null;
  const pa = analyzePlayer({
    fight, pid: r.player, lk, damage: detail.damage, healing: detail.healing,
    casts, deaths: fightDeaths, prep, rankings,
  });

  const pulls = report.fights.filter((f) => f.encounterID === fight.encounterID && (f.friendlyPlayers || []).includes(r.player));
  const idx = pulls.findIndex((f) => f.id === fight.id);
  const nav = `<nav class="pull-nav">
    ${idx > 0 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx - 1].id })}">← Previous pull</a>` : ''}
    ${idx >= 0 && idx < pulls.length - 1 ? `<a class="button secondary" href="${href({ ...r, fight: pulls[idx + 1].id })}">Next pull →</a>` : ''}
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
        <p class="fight-meta"><span class="badge ${fight.kill ? 'kill' : 'wipe'}">${fight.kill ? 'Kill' : `Wipe · ${fmtPct(fight.bossPercentage)}`}</span>
          <span class="muted">${esc(ROLE_LABEL[pa.role])}</span></p>
      </div>
      ${nav}
    </section>
    <section class="stats">${stats}</section>
    <section class="card"><h2>Tips</h2>
      ${pa.tips.length ? `<ul class="tips">${pa.tips.map((t) => `<li class="tip ${t.level}"><span class="tip-icon">${TIP_ICONS[t.level]}</span><span>${esc(t.text)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to flag.</p>'}
      ${pa.death ? `<p><a href="${href({ ...r, player: null })}" data-open-tab="deaths">See the death recap on the pull page →</a></p>` : ''}
      ${pa.hasSpecModule ? '' : `<p class="hint">These are general checks. Rotation, buff uptime and proc checks for ${esc(pa.spec || 'this spec')} ${esc(actor.subType || '')} aren't written yet.</p>`}
    </section>
    ${pa.sections.map((s) => `<section class="card"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('')}
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
    ${rawBlock('casts', casts)}${rawBlock('rankings', rankings)}${rawBlock('damage entry', findEntry(detail.damage, r.player))}${rawBlock('healing entry', findEntry(detail.healing, r.player))}`;
  bindRefresh(r);
}

// ---------- boot ----------

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  try {
    if (!r.code) { renderHome(); return; }
    if (!getToken()) throw new AuthError('Connect your Warcraft Logs account to load reports.');
    if (r.fight != null && r.player != null) await renderPlayer(r);
    else if (r.fight != null) await renderFight(r);
    else await renderReport(r);
    if (seq === renderSeq) window.scrollTo(0, 0);
    window.$WowheadPower?.refreshLinks?.();
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
