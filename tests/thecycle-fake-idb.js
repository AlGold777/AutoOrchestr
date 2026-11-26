'use strict';
// Minimal in-memory IndexedDB for node:test: stores with keyPath (string or array), add/put/get/delete/getAll(range)/clear,
// transactions that complete when their requests are done and roll back on abort. Not a general implementation.
const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
function cmp(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmp(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
const enc = (k) => JSON.stringify(k);
// A stored directory handle is kept by reference (real IndexedDB structured-clones it); other rows are plain JSON.
const copy = (v) => (v === undefined ? undefined : (v && typeof v === 'object' && v.handle) ? { ...v } : JSON.parse(JSON.stringify(v)));
function createFakeIndexedDB() {
  const dbs = new Map();
  const factory = {
    open(name, version) {
      const req = {};
      setTimeout(() => {
        let rec = dbs.get(name);
        const fresh = !rec;
        if (fresh) { rec = { version, stores: new Map(), defs: new Map() }; dbs.set(name, rec); }
        const db = {
          get objectStoreNames() { return { contains: (n) => rec.stores.has(n) }; },
          createObjectStore(n, { keyPath }) { rec.stores.set(n, new Map()); rec.defs.set(n, keyPath); return {}; },
          close() {}, onversionchange: null,
          transaction(names, mode) {
            const list = Array.isArray(names) ? names : [names];
            const backup = mode === 'readwrite' ? new Map(list.map((n) => [n, new Map(rec.stores.get(n))])) : null;
            const tx = { error: null, oncomplete: null, onabort: null, onerror: null };
            let pending = 0, ended = false, timer = null;
            const finish = () => {
              clearTimeout(timer);
              timer = setTimeout(() => { if (!ended && pending === 0) { ended = true; tx.oncomplete?.(); } }, 0);
            };
            tx.abort = () => {
              if (ended) return;
              ended = true;
              if (backup) for (const [n, m] of backup) rec.stores.set(n, m);
              setTimeout(() => tx.onabort?.(), 0);
            };
            const request = (work) => {
              const r = {}; pending++;
              queueMicrotask(() => {
                try { r.result = work(); } catch (e) { r.error = e; }
                pending--;
                if (r.error) r.onerror?.(); else r.onsuccess?.();
                finish();
              });
              return r;
            };
            tx.objectStore = (n) => {
              const map = () => rec.stores.get(n), path = rec.defs.get(n);
              const keyOf = (v) => (Array.isArray(path) ? path.map((p) => v[p]) : v[path]);
              return {
                get: (k) => request(() => copy(map().get(enc(k))?.v)),
                put: (v) => request(() => { const k = keyOf(v); map().set(enc(k), { k, v: copy(v) }); return k; }),
                add: (v) => request(() => {
                  const k = keyOf(v);
                  if (map().has(enc(k))) { const e = new Error('ConstraintError'); e.name = 'ConstraintError'; throw e; }
                  map().set(enc(k), { k, v: copy(v) }); return k;
                }),
                delete: (k) => request(() => { map().delete(enc(k)); }),
                clear: () => request(() => { map().clear(); }),
                getAll: (range) => request(() => [...map().values()]
                  .filter((e) => !range || (cmp(e.k, range.lower) >= 0 && cmp(e.k, range.upper) <= 0))
                  .sort((a, b) => cmp(a.k, b.k)).map((e) => copy(e.v)))
              };
            };
            finish();
            return tx;
          }
        };
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    }
  };
  return factory;
}
function installKeyRange() { globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) }; }
module.exports = { createFakeIndexedDB, installKeyRange };
