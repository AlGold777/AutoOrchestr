// The documents of the User window of Basic: their versions, kept apart from the records of the runs. A document is written by a model
// or by the User, every version is a text with its author and its source; a version is approved by the User. The store has its own key
// in chrome.storage.local and no eviction: nothing is removed to make room for a new version, a refused write is reported as it is.
// Records of runs refer to a document by its key and version (CustomRunRecord.setDocumentRef).
(function initBasicDocuments(root) {
  'use strict';

  const KEY = 'llmComparatorDocuments';

  const docKey = (runId, id) => `${runId}:${id}`;
  const copyOf = (value) => JSON.parse(JSON.stringify(value));
  const bytesOf = (value) => {
    const json = JSON.stringify(value);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length * 2;
  };

  // storage: { get(key) → Promise<value>, set(key, value) → Promise, remove(key) → Promise }.
  // Every operation waits for the previous one: a write never interleaves with another read-modify-write. A failed operation
  // rejects its own call and does not stop the next one.
  function createStore({ storage, key = KEY, now = Date.now } = {}) {
    if (!storage) throw new Error('basic_documents_storage_required');
    let queue = Promise.resolve();
    const enqueue = (task) => {
      const run = queue.then(task);
      queue = run.catch(() => {});
      return run;
    };
    const readAll = async () => {
      const value = await storage.get(key);
      return value && typeof value === 'object' && value.documents && typeof value.documents === 'object'
        ? value
        : { version: 1, documents: {} };
    };
    const writeAll = (data) => storage.set(key, data);
    const findVersion = (doc, version) => (doc ? doc.versions.find((item) => item.n === version) : undefined);

    function putVersion({ runId, pipeline = '', id, name = '', version, author, text, source = {}, at } = {}) {
      return enqueue(async () => {
        const data = await readAll();
        const k = docKey(runId, id);
        const doc = data.documents[k] || { key: k, runId: String(runId), pipeline, id, name, versions: [] };
        const existing = findVersion(doc, version);
        if (existing) {
          if (existing.text !== text) throw new Error('document_version_conflict');
          return { key: k, id, version, approved: existing.approved === true };
        }
        doc.versions.push({ n: version, author, at: at ?? now(), text, source, approved: false });
        doc.versions.sort((a, b) => a.n - b.n);
        data.documents[k] = doc;
        await writeAll(data);
        return { key: k, id, version, approved: false };
      });
    }

    function approve({ runId, id, version } = {}) {
      return enqueue(async () => {
        const data = await readAll();
        const k = docKey(runId, id);
        const item = findVersion(data.documents[k], version);
        if (!item) throw new Error('document_version_missing');
        item.approved = true;
        item.approvedAt = item.approvedAt ?? now();
        await writeAll(data);
        return { key: k, id, version, approved: true };
      });
    }

    function getVersion(runId, id, version) {
      return enqueue(async () => {
        const item = findVersion((await readAll()).documents[docKey(runId, id)], version);
        return item ? item.text : null;
      });
    }

    function get(runId, id) {
      return enqueue(async () => {
        const doc = (await readAll()).documents[docKey(runId, id)];
        return doc ? copyOf(doc) : null;
      });
    }

    function list() {
      return enqueue(async () => {
        const docs = Object.values((await readAll()).documents);
        return docs.map((doc) => {
          const last = doc.versions[doc.versions.length - 1];
          const approvedVersions = doc.versions.filter((item) => item.approved).map((item) => item.n);
          return {
            key: doc.key, runId: doc.runId, pipeline: doc.pipeline, id: doc.id, name: doc.name,
            versions: doc.versions.length, latest: last ? last.n : null,
            approved: approvedVersions.length ? Math.max(...approvedVersions) : null,
            at: last ? last.at : null
          };
        }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      });
    }

    function remove(runId, id) {
      return enqueue(async () => {
        const data = await readAll();
        const k = docKey(runId, id);
        const removed = Object.prototype.hasOwnProperty.call(data.documents, k);
        if (removed) {
          delete data.documents[k];
          await writeAll(data);
        }
        return { key: k, removed };
      });
    }

    function usage() {
      return enqueue(async () => {
        const data = await readAll();
        return { documents: Object.keys(data.documents).length, bytes: bytesOf(data) };
      });
    }

    return { putVersion, approve, getVersion, get, list, remove, usage };
  }

  // chrome.storage.local as the storage interface of createStore. A callback reports a failure through
  // chrome.runtime.lastError: the promise is rejected with it (a synchronous throw of the area rejects too), so a failed
  // write never looks saved.
  function chromeStorage(area) {
    const call = (method, args) => new Promise((resolve, reject) => {
      area[method](...args, (result) => {
        const error = root.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve(result);
      });
    });
    return {
      get: (key) => call('get', [key]).then((result) => result?.[key]),
      set: (key, value) => call('set', [{ [key]: value }]).then(() => undefined),
      remove: (key) => call('remove', [key]).then(() => undefined)
    };
  }

  const api = Object.freeze({ KEY, createStore, chromeStorage });
  root.BasicDocuments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
