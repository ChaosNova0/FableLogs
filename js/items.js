// Item names from Wowhead's tooltip data. The combat log only has item ids, so names are looked up here, cached,
// and written into the page as plain text once it has rendered.
import { CONFIG } from './config.js';
import { cache } from './store.js';

const PARALLEL = 6;

async function fetchItem(id) {
  const key = `item:${CONFIG.wowheadFlavor}:${id}`;
  const hit = await cache.get(key);
  if (hit !== undefined) return hit;
  const res = await fetch(`https://nether.wowhead.com/${CONFIG.wowheadFlavor}/tooltip/item/${Number(id)}`);
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const item = body?.name ? { name: String(body.name), quality: Number(body.quality) } : null;
  if (item) await cache.set(key, item);
  return item;
}

// Fills every [data-item-id] element under root with its item's name. Leaves the fallback text on failure.
export async function fillItemNames(root) {
  const els = [...root.querySelectorAll('[data-item-id]')];
  const ids = [...new Set(els.map((el) => Number(el.dataset.itemId)).filter((id) => id > 0))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += PARALLEL) {
    const batch = ids.slice(i, i + PARALLEL);
    const items = await Promise.all(batch.map((id) => fetchItem(id).catch(() => null)));
    batch.forEach((id, j) => { if (items[j]) names.set(id, items[j]); });
  }
  for (const el of els) {
    const item = names.get(Number(el.dataset.itemId));
    if (item && el.isConnected) {
      el.textContent = item.name;
      el.classList.add('named');
    }
  }
}
