// localStorage that never throws (private windows, blocked storage).
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// IndexedDB response cache with an in-memory fallback.
const memory = new Map();
let dbPromise = null;

// IndexedDB can stall without ever firing success or error (blocked upgrades, some headless or locked-down
// browsers). The cache must never hold up the page, so every call gives up after a short wait.
const IDB_TIMEOUT_MS = 2000;

function withTimeout(executor, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    try { executor(done); } catch { done(fallback); }
  });
}

function openDb() {
  if (!dbPromise) {
    dbPromise = withTimeout((done) => {
      const req = indexedDB.open('fablelogs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cache');
      req.onsuccess = () => done(req.result);
      req.onerror = req.onblocked = () => done(null);
    }, null);
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return withTimeout((done) => {
    const t = db.transaction('cache', mode);
    const req = fn(t.objectStore('cache'));
    t.oncomplete = () => done(req && req.result);
    t.onerror = t.onabort = () => done(undefined);
  }, undefined);
}

export const cache = {
  async get(key) {
    if (memory.has(key)) return memory.get(key);
    const db = await openDb();
    if (!db) return undefined;
    const value = await tx(db, 'readonly', (s) => s.get(key));
    if (value !== undefined) memory.set(key, value);
    return value;
  },
  async set(key, value) {
    memory.set(key, value);
    const db = await openDb();
    if (db) await tx(db, 'readwrite', (s) => s.put(value, key));
  },
  async clear(prefix = '') {
    for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
    const db = await openDb();
    if (!db) return;
    if (!prefix) { await tx(db, 'readwrite', (s) => s.clear()); return; }
    const keys = (await tx(db, 'readonly', (s) => s.getAllKeys())) || [];
    await tx(db, 'readwrite', (s) => { keys.filter((k) => String(k).startsWith(prefix)).forEach((k) => s.delete(k)); });
  },
};
