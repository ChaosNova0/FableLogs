# FableLogs

A static HTML5 site: paste a Warcraft Logs report link and get a plain-language summary of the raid.

- **Report summary:** kills and wipes per boss, best wipe %, who died most, who died first on wipes, most common killing blows.
- **Per pull:** what happened, how the wipe started, and a recap of each death built from the 10 seconds before it
  (one-shot, single big hit, burst, worn down, fall damage, no healing, repeated hits from the same ability, melee from a boss).
- **Prep:** missing flask, food and potions; interrupts and dispels; damage and healing done.
- **Raid prep & gear:** flask, food and pre-pot rates for each player across the night, potions used, missing enchants,
  average item level, and a gear grid with Wowhead tooltips.
- **Kudos:** per pull (top damage and healing, most interrupts and dispels, always casting, top parses, fully prepared,
  deathless kill or last standing) and for the night (never died, last standing most often, night-wide totals).
- **Guilds:** paste a guild link (`/guild/id/123` or `/guild/us/server/Name`) for a raid progress gallery (boss
  portraits, crossed out in red once killed), the raid team by role and spec, progression per raid (first kills,
  wipes to kill, fastest kills), raid-night trends, and a roster (members, attendance, raiding/lapsed status, class
  make-up). The latest tier always loads (at most 25 logs); older history loads only while under 60% of your hourly
  API budget and fills in over later visits, since each log's pulls are cached once fetched.
- **Per player:** active time, major cooldowns used vs. possible, overhealing, parse percentile, cast counts,
  buff and DoT uptimes for each spec, and a ranked list of tips. Click any player on a pull page.
- **Mechanics:** avoidable damage per boss (who was hit by what, with how to avoid it) and enemy casts that should have
  been interrupted, for MoP raid bosses. Hand-picked ability lists in `js/mechanics.js`, matched by name.
- **Raid buffs & debuffs:** which of the eight MoP raid buffs everyone had at the pull, who could have brought a missing
  one, and uptime of Weakened Armor, Physical Vulnerability, magic vulnerability and Weakened Blows on the boss.
- **Progression charts:** fight left at the end of each pull, per boss tonight and across nights on the guild page.
- **Compare two pulls:** any two pulls of a boss, in the same log or across logs (paste the other log on a pull page),
  side by side: outcome, deaths, avoidable hits, interrupts, raid cooldown timings, per-player output per second
  alive with the biggest drops first, roster and buff changes, plus boss health and raid DPS over time on a shared
  time axis.

Run the rule tests by serving the folder and opening `/tests/analysis.html`.
To see the UI without a Warcraft Logs client, open `/tests/preview.html`. It serves a made-up raid night through a stubbed API
(add `?debug` to list each query). `/tests/phone.html#<preview path>` shows it at phone width.

Built for Mists of Pandaria Classic (`classic.warcraftlogs.com`). Links from other Warcraft Logs sites also load, but the consumable lists are MoP-only.

## Setup

1. Create an API client at <https://www.warcraftlogs.com/api/clients>:
   - Redirect URL: `http://localhost:8000/` (add your hosted URL too once it's deployed)
   - Mark it as a **public client** (PKCE). The site never uses a client secret.
2. Run the local server from this folder:
   ```powershell
   .\serve.ps1
   ```
3. Open <http://localhost:8000/>, click ⚙, paste the client ID, then **Connect Warcraft Logs**.
4. Paste a report link.

## Hosting

The site is published to GitHub Pages at <https://chaosnova0.github.io/FableLogs/> by
[.github/workflows/pages.yml](.github/workflows/pages.yml) on every push to `main`. Only `index.html`, `css/` and `js/` are
published; `tests/` is left out because the preview page writes a fake login token into the browser.

- Set `clientId` in [js/config.js](js/config.js) so visitors don't have to enter one. The client ID isn't a secret: the site
  uses the PKCE flow, which has no client secret. Never commit a client secret.
- Register `https://chaosnova0.github.io/FableLogs/` (trailing slash included) as a redirect URL on the Warcraft Logs client.

## How it works

- Login uses OAuth with PKCE. The access token stays in the browser's localStorage.
- Queries go straight from the browser to `https://<site>.warcraftlogs.com/api/v2/user`, and every response is cached in IndexedDB.
  Use **Refresh** on a report to re-fetch a live log, or **Clear cache** in Settings.
- Each user spends their own Warcraft Logs API budget. The footer shows how much is left this hour.

| File | Purpose |
| --- | --- |
| `js/auth.js` | PKCE login and token storage |
| `js/api.js` | Link parsing, GraphQL queries, paging, caching |
| `js/analysis.js` | Rules that turn events into findings (no DOM, no network) |
| `js/mop.js` | MoP potion names, flask and food detection, class colours |
| `js/cooldowns.js` | Major cooldowns per class and spec, and role detection |
| `js/guild.js` | Guild synopsis: progression, raid-night trends, roster and attendance |
| `js/items.js` | Item names from Wowhead tooltip data, cached and filled in after render |
| `js/performance.js` | Per-player breakdown: active time, cooldown usage, overheal, tips |
| `js/specs/` | Buff and DoT uptime targets per spec, keyed `Class-Spec` |
| `js/mechanics.js` | Avoidable abilities and interrupts per boss |
| `js/buffs.js` | Raid buff and debuff coverage |
| `js/charts.js` | Inline SVG progression charts |
| `js/compare.js` | Two pulls of a boss side by side |
| `js/timeline.js` | Raid DPS and boss health over a pull, from graph data |
| `js/app.js` | Routing and rendering |

Turn on **Show raw API data** in Settings to see exactly what Warcraft Logs returned. This helps when tuning a rule.
