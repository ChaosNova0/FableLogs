// A pull over time, from Warcraft Logs graph data: raid DPS and boss health, as [msIntoPull, value] points. Pure.
// The graph JSON's exact shape isn't confirmed against a real log, so both shapes Warcraft Logs is known to use are
// read: data as plain values with pointStart/pointInterval, or as [time, value] pairs.

// [{ name, type, points: [[t, v]] }] from a graph() result.
export function graphSeries(graph) {
  const g = graph?.data ?? graph;
  return (g?.series || []).map((s) => {
    const data = s.data || [];
    const points = Array.isArray(data[0])
      ? data.map(([t, v]) => [Number(t), Number(v) || 0])
      : data.map((v, i) => [(s.pointStart ?? 0) + i * (s.pointInterval ?? 1000), Number(v) || 0]);
    return { name: s.name, type: s.type, points };
  });
}

// Graph times are report-relative (pointStart 0 is the start of the log); this makes them ms into the pull and drops
// points outside it.
const intoPull = (fight, points) => points.map(([t, v]) => [t - fight.startTime, v])
  .filter(([t]) => t >= 0 && t <= fight.endTime - fight.startTime);

// Smooths a [t, v] line with a moving average over windowMs, so a 1-second spike doesn't swamp the chart.
export function smooth(points, windowMs = 10_000) {
  return points.map(([t]) => {
    const near = points.filter(([u]) => Math.abs(u - t) <= windowMs / 2);
    return [t, near.reduce((s, [, v]) => s + v, 0) / (near.length || 1)];
  });
}

// Raid DPS over the pull: every player's (and pet's) series summed at each time point, then smoothed.
export function raidDps(graph, fight) {
  const total = new Map();
  for (const s of graphSeries(graph)) {
    if (/^total$/i.test(s.name || '')) return smooth(intoPull(fight, s.points));
    for (const [t, v] of s.points) total.set(t, (total.get(t) || 0) + v);
  }
  return smooth(intoPull(fight, [...total.entries()].sort((a, b) => a[0] - b[0])));
}

// Boss health over the pull, 0-100. Picks the boss's series (type Boss, else the enemy with the most health) and
// scales it to its highest value, so absolute hit points and percentages both work. A kill ends at 0.
export function bossHealth(graph, fight) {
  const all = graphSeries(graph).map((s) => ({ ...s, points: intoPull(fight, s.points) })).filter((s) => s.points.length);
  if (!all.length) return [];
  const peak = (s) => Math.max(...s.points.map(([, v]) => v));
  const bosses = all.filter((s) => /boss/i.test(s.type || ''));
  const pick = (bosses.length ? bosses : all).reduce((best, s) => (peak(s) > peak(best) ? s : best));
  const max = peak(pick) || 1;
  const pts = pick.points.map(([t, v]) => [t, Math.max(0, Math.min(100, (v / max) * 100))]);
  if (fight.kill && pts.length && pts[pts.length - 1][1] > 0) pts.push([fight.endTime - fight.startTime, 0]);
  return pts;
}
