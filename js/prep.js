// Night-wide raid prep and gear overview, built from every pull's CombatantInfo and potion casts. Pure.
import { consumables } from './analysis.js';

// Inventory slot indexes as they appear in CombatantInfo gear (0-based).
export const SLOT_NAMES = [
  'Head', 'Neck', 'Shoulder', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrist', 'Hands',
  'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2', 'Back', 'Main hand', 'Off hand', 'Ranged', 'Tabard',
];

// Slots everyone can enchant in MoP. Rings are enchanter-only and heads have no enchants, so neither is judged.
const ENCHANT_SLOTS = [2, 4, 6, 7, 8, 9, 14, 15, 16];
// Shirt, ranged (gone in MoP) and tabard don't count toward item level.
const SKIP_ILVL = new Set([3, 17, 18]);
const ILVL_SLOTS = 16;

// Takes normalized gear (already without shirt, ranged and tabard).
function itemLevel(gear) {
  const bySlot = new Map(gear.map((g) => [g.slot, g]));
  let total = 0;
  for (const g of gear) total += g.itemLevel || 0;
  // Two-handers count twice, the way the character sheet does it.
  if (!bySlot.has(16) && bySlot.has(15)) total += bySlot.get(15).itemLevel || 0;
  return total ? total / ILVL_SLOTS : null;
}

// CombatantInfo gear is one entry per slot in slot order; empty slots have id 0.
function normalizeGear(gear) {
  return (gear || []).map((g, i) => ({ ...g, slot: g.slot ?? i })).filter((g) => g.id && !SKIP_ILVL.has(g.slot));
}

function missingEnchants(gear) {
  return gear.filter((g) => ENCHANT_SLOTS.includes(g.slot) && !g.permanentEnchant).map((g) => SLOT_NAMES[g.slot]);
}

const pct = (n, d) => (d ? n / d : null);

/**
 * @param combatants  CombatantInfo events across the night (each has .fight)
 * @param potions     potion cast events across the night (each has .fight)
 */
export function prepOverview(report, lk, combatants, potions) {
  const byPlayer = new Map();
  const row = (pid) => {
    if (!byPlayer.has(pid)) byPlayer.set(pid, { pid, pulls: 0, info: 0, flask: 0, food: 0, prePot: 0, combatPots: 0, latest: null });
    return byPlayer.get(pid);
  };

  for (const fight of report.fights || []) {
    const fc = combatants.filter((c) => c.fight === fight.id);
    const fp = potions.filter((p) => p.fight === fight.id);
    for (const r of consumables(fight, fc, fp, lk).rows) {
      const p = row(r.pid);
      p.pulls++;
      if (r.prePot) p.prePot++;
      p.combatPots += r.combatPots;
      if (!r.hasInfo) continue;
      p.info++;
      if (r.flask) p.flask++;
      if (r.food) p.food++;
    }
    for (const c of fc) {
      const p = row(c.sourceID);
      if (c.gear?.length && (!p.latest || fight.startTime >= p.latest.at)) p.latest = { at: fight.startTime, gear: c.gear };
    }
  }

  const players = [...byPlayer.values()].filter((p) => lk.isPlayer(p.pid) && p.pulls).map((p) => {
    const gear = normalizeGear(p.latest?.gear);
    return {
      pid: p.pid,
      pulls: p.pulls,
      info: p.info,
      flaskPct: pct(p.flask, p.info),
      foodPct: pct(p.food, p.info),
      prePotPct: pct(p.prePot, p.pulls),
      flaskMissed: p.info - p.flask,
      foodMissed: p.info - p.food,
      combatPots: p.combatPots,
      ilvl: gear.length ? itemLevel(gear) : null,
      gear,
      missingEnchants: gear.length ? missingEnchants(gear) : [],
    };
  }).sort((a, b) => (b.ilvl || 0) - (a.ilvl || 0));

  const withInfo = players.filter((p) => p.info);
  const ilvls = players.map((p) => p.ilvl).filter(Boolean);
  const issues = [];
  const name = (p) => lk.sourceName(p.pid);
  const flaskless = withInfo.filter((p) => p.flaskMissed).sort((a, b) => b.flaskMissed - a.flaskMissed);
  if (flaskless.length) issues.push(`Pulled without a flask: ${flaskless.map((p) => `${name(p)} (${p.flaskMissed}/${p.info})`).join(', ')}.`);
  const foodless = withInfo.filter((p) => p.foodMissed).sort((a, b) => b.foodMissed - a.foodMissed);
  if (foodless.length) issues.push(`Pulled without food: ${foodless.map((p) => `${name(p)} (${p.foodMissed}/${p.info})`).join(', ')}.`);
  const unenchanted = players.filter((p) => p.missingEnchants.length);
  if (unenchanted.length) issues.push(`Missing enchants: ${unenchanted.map((p) => `${name(p)} (${p.missingEnchants.join(', ').toLowerCase()})`).join('; ')}.`);

  return {
    players,
    hasInfo: withInfo.length > 0,
    hasGear: players.some((p) => p.gear.length),
    avgIlvl: ilvls.length ? ilvls.reduce((a, b) => a + b, 0) / ilvls.length : null,
    flaskPct: pct(withInfo.reduce((n, p) => n + p.info - p.flaskMissed, 0), withInfo.reduce((n, p) => n + p.info, 0)),
    foodPct: pct(withInfo.reduce((n, p) => n + p.info - p.foodMissed, 0), withInfo.reduce((n, p) => n + p.info, 0)),
    issues,
  };
}
