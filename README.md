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
  make-up) across the last 10, 25 or 50 reports.
- **Per player:** active time, major cooldowns used vs. possible, overhealing, parse percentile, cast counts,
  and a ranked list of tips. Click any player on a pull page.

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
| `js/performance.js` | Per-player breakdown: active time, cooldown usage, overheal, tips |
| `js/specs/` | Spec-specific modules (rotation, uptimes), keyed `Class-Spec` |
| `js/app.js` | Routing and rendering |

Turn on **Show raw API data** in Settings to see exactly what Warcraft Logs returned. This helps when tuning a rule.
