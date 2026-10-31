// Small inline SVG charts. Returns HTML strings; colours come from the page's CSS tokens so both themes work.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const STEP = 16;
const H = 120;
const PAD = { top: 10, right: 12, bottom: 18, left: 34 };

/**
 * Boss health left at the end of each pull, oldest pull first: lower is closer to a kill, kills sit on 0%.
 * @param points  [{ pct: 0-100 remaining, kill, title (tooltip text), href?, night? }]
 *                night: pulls with different values are split by a faint divider (guild-wide charts).
 * @param label   accessible name for the chart
 */
export function progressChart(points, label) {
  const pts = points.filter((p) => p.pct != null);
  if (pts.length < 2) return '';
  const plotW = Math.max(260, (pts.length - 1) * STEP);
  const W = PAD.left + plotW + PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const y = (pct) => PAD.top + (1 - Math.min(100, Math.max(0, pct)) / 100) * plotH;

  const grid = [100, 50, 0].map((v) => `<line class="pc-grid" x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="pc-axis" x="${PAD.left - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}%</text>`).join('');

  const dividers = pts.map((p, i) => (i && p.night != null && p.night !== pts[i - 1].night
    ? `<line class="pc-night" x1="${(x(i) + x(i - 1)) / 2}" x2="${(x(i) + x(i - 1)) / 2}" y1="${PAD.top}" y2="${PAD.top + plotH}"/>` : '')).join('');

  // Best attempt so far, as a step line under the pulls, so a bad pull after a good one doesn't hide the progress.
  let best = 100;
  const bestPath = pts.map((p, i) => { best = Math.min(best, p.pct); return `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(best).toFixed(1)}`; }).join(' ');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');

  const marks = pts.map((p, i) => {
    const cx = x(i).toFixed(1);
    const cy = y(p.pct).toFixed(1);
    const mark = p.kill
      ? `<path class="pc-kill" d="M${cx - 5},${cy} l5,-5 l5,5 l-5,5 Z"/>`
      : `<circle class="pc-wipe" cx="${cx}" cy="${cy}" r="4"/>`;
    const body = `<title>${esc(p.title)}</title><circle class="pc-hit" cx="${cx}" cy="${cy}" r="9"/>${mark}`;
    return p.href ? `<a href="${esc(p.href)}">${body}</a>` : `<g>${body}</g>`;
  }).join('');

  return `<figure class="progress-chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="max-width:${W}px">
      ${grid}${dividers}
      <path class="pc-best" d="${bestPath}"/>
      <path class="pc-line" d="${line}"/>
      ${marks}
    </svg>
    <figcaption class="pc-legend"><span class="pc-key-line"></span>Each pull <span class="pc-key-best"></span>Best so far <span class="pc-key-kill"></span>Kill</figcaption>
  </figure>`;
}
