// Spec-specific analysis modules, keyed by "Class-Spec" as Warcraft Logs writes it (e.g. "Mage-Frost").
// A module is a function (ctx) => ({ tips?: [{ level, text }], sections?: [{ title, html }] }).
// ctx: { fight, pid, actor, spec, casts, lk, alive, entry } — see performance.js for what each holds.
export const SPEC_MODULES = {};
