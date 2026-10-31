// Mists of Pandaria Classic specifics. Matching is by name so it survives spell ID differences between ranks.

export const POTION_NAMES = [
  'Potion of the Jade Serpent',
  'Potion of Mogu Power',
  "Virmen's Bite",
  'Potion of the Mountains',
  'Potion of Focus',
  'Master Mana Potion',
  'Master Healing Potion',
];

// Throughput potions only: these are the ones a raider is expected to use on a boss pull.
export const DPS_POTIONS = new Set(['Potion of the Jade Serpent', 'Potion of Mogu Power', "Virmen's Bite", 'Potion of the Mountains']);

export function isFlask(name = '', icon = '') {
  return /^(flask|elixir) of /i.test(name) || /flask|elixir/i.test(icon);
}

export function isFood(name = '', icon = '') {
  return /^well fed$/i.test(name) || /^food$/i.test(name) || /misc_food/i.test(icon);
}

export function isPotion(name = '') {
  return POTION_NAMES.includes(name);
}

export const CLASS_COLORS = {
  DeathKnight: '#C41E3A', Druid: '#FF7C0A', Hunter: '#AAD372', Mage: '#3FC7EB', Monk: '#00FF98',
  Paladin: '#F48CBA', Priest: '#FFFFFF', Rogue: '#FFF468', Shaman: '#0070DD', Warlock: '#8788EE',
  Warrior: '#C69B6D',
};

export function classColor(subType) {
  return CLASS_COLORS[String(subType || '').replace(/\s+/g, '')] || 'var(--text)';
}
