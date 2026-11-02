/* IndexedDB: видео, попытки, эталоны, мета. Видео и метаданные пишутся одной транзакцией. */
window.Store = (function () {
  var db = null;
  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB недоступна'));
      var r;
      try { r = indexedDB.open('padel-coach', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () {
        var d = r.result;
        ['videos', 'attempts', 'references'].forEach(function (n) { d.createObjectStore(n, { keyPath: 'id' }); });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = function () { db = r.result; res(); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB не открылась')); };
      r.onblocked = function () { rej(new Error('IndexedDB заблокирована')); };
    });
  }
  function tx(stores, mode, fn) {
    return new Promise(function (res, rej) {
      if (!db) return rej(new Error('IndexedDB недоступна'));
      var t, out;
      try { t = db.transaction(stores, mode); out = fn(t); } catch (e) { return rej(e); }
      t.oncomplete = function () { res(out && 'result' in out ? out.result : out); };
      t.onerror = t.onabort = function () { rej(t.error || new Error('Запись прервана (возможно, нет места)')); };
    });
  }
  function all(store) { return tx([store], 'readonly', function (t) { return t.objectStore(store).getAll(); }); }
  function get(store, id) { return tx([store], 'readonly', function (t) { return t.objectStore(store).get(id); }); }
  function putAttempt(a) { return tx(['attempts'], 'readwrite', function (t) { t.objectStore('attempts').put(a); }); }

  function saveAttempt(attempt, video) {
    return tx(['videos', 'attempts'], 'readwrite', function (t) {
      t.objectStore('videos').put(video);
      var s = t.objectStore('attempts');
      s.put(Object.assign({}, attempt, { status: 'saving' }));
      s.put(Object.assign({}, attempt, { status: 'saved' }));
    });
  }
  function saveReference(ref, video, oldRef) {
    return tx(['videos', 'references', 'meta'], 'readwrite', function (t) {
      t.objectStore('videos').put(video);
      var s = t.objectStore('references');
      s.put(Object.assign({}, ref, { status: 'saving' }));
      s.put(Object.assign({}, ref, { status: 'active' }));
      if (oldRef && oldRef.source !== 'demo') s.put(Object.assign({}, oldRef, { status: 'archived' }));
      t.objectStore('meta').put({ key: 'activeReferenceId', value: ref.id });
    });
  }
  /* Убирает записи, прерванные посреди сохранения, и видео без владельца. */
  function cleanup() {
    return tx(['videos', 'attempts', 'references'], 'readwrite', function (t) {
      var att = t.objectStore('attempts'), refs = t.objectStore('references'), vids = t.objectStore('videos');
      var ra = att.getAll(), rr = refs.getAll(), rv = vids.getAllKeys();
      var done = 0;
      function fin() {
        if (++done < 3) return;
        var keep = {};
        ra.result.forEach(function (a) { if (a.status === 'saving') att.delete(a.id); else keep[a.videoId] = 1; });
        rr.result.forEach(function (r) { if (r.status === 'saving') refs.delete(r.id); else keep[r.videoId] = 1; });
        rv.result.forEach(function (k) { if (!keep[k]) vids.delete(k); });
      }
      ra.onsuccess = rr.onsuccess = rv.onsuccess = fin;
    });
  }
  return { open: open, all: all, get: get, putAttempt: putAttempt, saveAttempt: saveAttempt, saveReference: saveReference, cleanup: cleanup };
})();
