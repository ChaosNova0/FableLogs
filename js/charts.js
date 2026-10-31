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

const LW = 760;
const LH = 170;
const LPAD = { top: 10, right: 14, bottom: 22, left: 46 };

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// The value of a [t, v] line at time t (the nearest earlier point), or null past its end.
function valueAt(points, t) {
  if (!points.length || t > points[points.length - 1][0]) return null;
  let v = points[0][1];
  for (const [u, w] of points) { if (u > t) break; v = w; }
  return v;
}

/**
 * Two pulls on one time axis (ms into the pull): one line each, A dashed and B solid, with a legend and a hover
 * readout every 5 seconds. One measure per chart, so there's only ever one y-axis.
 * @param series  [{ label, points: [[t, v]] }] — exactly the two pulls, earlier first
 * @param opts    { label (accessible name), yMax (else the data's max), yFmt (tick and readout text), xMax }
 */
export function lineChart(series, opts) {
  const lines = series.filter((s) => s.points.length > 1);
  if (!lines.length) return '';
  const xMax = Math.max(opts.xMax || 0, ...lines.map((s) => s.points[s.points.length - 1][0]), 1);
  const yMax = opts.yMax ?? Math.max(...lines.flatMap((s) => s.points.map(([, v]) => v)), 1) * 1.08;
  const fmt = opts.yFmt || String;
  const plotW = LW - LPAD.left - LPAD.right;
  const plotH = LH - LPAD.top - LPAD.bottom;
  const x = (t) => LPAD.left + (t / xMax) * plotW;
  const y = (v) => LPAD.top + (1 - Math.min(1, Math.max(0, v / yMax))) * plotH;

  const yTicks = [0, 0.5, 1].map((f) => f * yMax);
  const grid = yTicks.map((v) => `<line class="pc-grid" x1="${LPAD.left}" x2="${LPAD.left + plotW}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="pc-axis" x="${LPAD.left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text>`).join('');
  const stepX = xMax > 600_000 ? 120_000 : 60_000;
  const xTicks = [];
  for (let t = 0; t <= xMax; t += stepX) xTicks.push(`<text class="pc-axis" x="${x(t).toFixed(1)}" y="${LH - 6}" text-anchor="middle">${mmss(t)}</text>`);

  const paths = series.map((s, i) => (s.points.length > 1
    ? `<path class="lc-line lc-${i ? 'b' : 'a'}" d="${s.points.map(([t, v], j) => `${j ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`
    : '')).join('');

  // Hover readout: a hit band every 5 seconds whose tooltip gives both pulls' values at that moment.
  const bands = [];
  const bandMs = 5000;
  for (let t = 0; t < xMax; t += bandMs) {
    const vals = series.map((s) => { const v = valueAt(s.points, t + bandMs / 2); return `${s.label}: ${v == null ? 'over' : fmt(v)}`; });
    bands.push(`<rect class="lc-hit" x="${x(t).toFixed(1)}" y="${LPAD.top}" width="${(x(t + bandMs) - x(t)).toFixed(1)}" height="${plotH}"><title>${esc(`${mmss(t)}–${mmss(t + bandMs)}\n${vals.join('\n')}`)}</title></rect>`);
  }

  return `<figure class="line-chart">
    <svg viewBox="0 0 ${LW} ${LH}" role="img" aria-label="${esc(opts.label)}">${grid}${xTicks.join('')}${paths}${bands.join('')}</svg>
    <figcaption class="pc-legend">${series.map((s, i) => `<span class="lc-key lc-key-${i ? 'b' : 'a'}"></span>${esc(s.label)}`).join(' ')}</figcaption>
  </figure>`;
}
