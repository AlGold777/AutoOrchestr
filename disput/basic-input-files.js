// Shared storage and request payload helpers for user-attached Basic input files.
(function initBasicInputFiles(root) {
  'use strict';

  const DB_NAME = 'aoBasicInputFiles';
  const STORE_NAME = 'files';
  const DB_VERSION = 2;
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const MAX_BATCH_BYTES = 30 * 1024 * 1024;

  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const idOf = (participant) => participant?.id ?? participant?.name;
  const utf8 = (text) => new TextEncoder().encode(text);

  function checkSize(size, label = 'Файл') {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`${label}: размер должен быть неотрицательным целым числом`);
    if (size > MAX_FILE_BYTES) throw new Error(`${label}: размер больше лимита 30 МиБ`);
  }

  function validateBatch(files) {
    if (!Array.isArray(files)) throw new Error('Ожидается список файлов');
    let total = 0;
    files.forEach((file) => {
      if (!file || typeof file.size !== 'number') throw new Error('Ожидается файл с размером');
      checkSize(file.size, file.name || 'Файл');
      total += file.size;
    });
    if (total > MAX_BATCH_BYTES) throw new Error('Общий размер файлов больше лимита 30 МиБ');
    return total;
  }

  // Validate/copy schema descriptors. Byte payloads never belong in a schema; only optional text content is inline.
  function descriptors(files) {
    if (!Array.isArray(files)) throw new Error('Ожидается список описаний файлов');
    const ids = new Set();
    return files.map((file, index) => {
      if (!isObject(file)) throw new Error(`files[${index}]: ожидается описание файла`);
      if (typeof file.id !== 'string' || !file.id.trim()) throw new Error(`files[${index}].id: ожидается непустой текст`);
      if (ids.has(file.id)) throw new Error(`files[${index}].id: ID «${file.id}» повторяется`);
      ids.add(file.id);
      if (typeof file.name !== 'string' || !file.name.trim()) throw new Error(`files[${index}].name: ожидается непустой текст`);
      const out = { id: file.id, name: file.name };
      if ('type' in file) {
        if (typeof file.type !== 'string') throw new Error(`files[${index}].type: ожидается текст`);
        out.type = file.type;
      }
      if ('size' in file) {
        checkSize(file.size, file.name);
        out.size = file.size;
      }
      if ('content' in file) {
        if (typeof file.content !== 'string') throw new Error(`files[${index}].content: ожидается текст`);
        out.content = file.content;
        const bytes = utf8(file.content).byteLength;
        checkSize(bytes, file.name);
        if ('size' in file && file.size !== bytes) throw new Error(`${file.name}: размер content не совпадает с описанием`);
      }
      return out;
    });
  }

  function fileAsBase64(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      return file.arrayBuffer().then((buffer) => encodeBytes(new Uint8Array(buffer)));
    }
    if (typeof FileReader !== 'undefined' && file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(file);
      });
    }
    return Promise.reject(new Error('Среда не умеет читать содержимое файла'));
  }

  function encodeBytes(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ошибка хранилища файлов'));
    });
  }

  function createStore({ indexedDB = root.indexedDB } = {}) {
    if (!indexedDB) throw new Error('IndexedDB недоступна: невозможно сохранить вложенный файл');
    const opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
          return;
        }
        // Version 1 keyed records by inline `id`; version 2 uses out-of-line keys so run snapshots
        // can use the separate compound key ['run', runId] in this same store.
        if (event.oldVersion >= 2) return;
        const oldStore = request.transaction.objectStore(STORE_NAME);
        const read = oldStore.getAll();
        read.onsuccess = () => {
          const previous = read.result || [];
          db.deleteObjectStore(STORE_NAME);
          const nextStore = db.createObjectStore(STORE_NAME);
          previous.forEach((record) => nextStore.put(record, record.id));
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище файлов'));
    });
    const transaction = async (mode, action) => {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        let result;
        try { result = action(tx.objectStore(STORE_NAME)); }
        catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result && typeof result.then === 'function' ? result : result);
        tx.onerror = () => reject(tx.error || new Error('Ошибка хранилища файлов'));
        tx.onabort = () => reject(tx.error || new Error('Операция хранилища файлов отменена'));
      });
    };
    return Object.freeze({
      async put(file, { id: requestedId } = {}) {
        validateBatch([file]);
        if (typeof file.name !== 'string' || !file.name.trim()) throw new Error('Файл должен иметь имя');
        if (requestedId !== undefined && (typeof requestedId !== 'string' || !requestedId.trim())) throw new Error('ID файла должен быть непустым текстом');
        const id = requestedId || (typeof root.crypto?.randomUUID === 'function'
          ? root.crypto.randomUUID()
          : `file-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const descriptor = { id, name: file.name, type: file.type || '', size: file.size };
        const db = await opened;
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ id, file }, id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить файл'));
          tx.onabort = () => reject(tx.error || new Error('Сохранение файла отменено'));
        });
        return descriptor;
      },
      async get(descriptor) {
        if (!descriptor || typeof descriptor.id !== 'string') return null;
        const record = await transaction('readonly', (store) => requestResult(store.get(descriptor.id)));
        return record?.file || null;
      },
      async putRun(runId, payloadMap) {
        if (typeof runId !== 'string' || !runId.trim()) throw new Error('ID запуска должен быть непустым текстом');
        if (!isObject(payloadMap)) throw new Error('Снимок файлов запуска должен быть объектом');
        const snapshot = JSON.parse(JSON.stringify(payloadMap));
        await transaction('readwrite', (store) => store.put({ runId, payloadMap: snapshot }, ['run', runId]));
      },
      async getRun(runId) {
        if (typeof runId !== 'string' || !runId.trim()) throw new Error('ID запуска должен быть непустым текстом');
        const record = await transaction('readonly', (store) => requestResult(store.get(['run', runId])));
        return record?.payloadMap || null;
      },
      async remove(id) {
        await transaction('readwrite', (store) => store.delete(id));
      }
    });
  }

  function filesFor(step, participantId) {
    const gathered = [...(Array.isArray(step?.files) ? step.files : [])];
    if (participantId != null && step?.kind !== 'owner') {
      const model = (Array.isArray(step?.models) ? step.models : []).find((item) => isObject(item) && idOf(item) === participantId);
      if (model && Array.isArray(model.files)) gathered.push(...model.files);
    }
    return dedupe(gathered);
  }

  function dedupe(list) {
    const found = new Map();
    for (const item of list) {
      const desc = descriptors([item])[0];
      const previous = found.get(desc.id);
      if (previous && Object.keys(desc).some((key) => key in previous && previous[key] !== desc[key])) {
        throw new Error(`Файл «${desc.id}» имеет конфликтующие описания`);
      }
      found.set(desc.id, previous ? { ...previous, ...desc } : desc);
    }
    return [...found.values()];
  }

  function collect(steps) {
    return dedupe((Array.isArray(steps) ? steps : []).flatMap((step) => {
      if (!isObject(step)) return [];
      const files = [...(Array.isArray(step.files) ? step.files : [])];
      if (step.kind !== 'owner') (Array.isArray(step.models) ? step.models : []).forEach((model) => {
        if (isObject(model) && model.enabled !== false && Array.isArray(model.files)) files.push(...model.files);
      });
      return files;
    }));
  }

  async function payload(descriptor, { store, available = [] } = {}) {
    const [file] = descriptors([descriptor]);
    if ('content' in file) {
      const bytes = utf8(file.content);
      if ('size' in file && bytes.byteLength !== file.size) throw new Error(`${file.name}: размер content не совпадает с описанием`);
      checkSize(bytes.byteLength, file.name);
      return { name: file.name, type: file.type || 'text/plain', size: bytes.byteLength, base64: encodeBytes(bytes) };
    }
    const stored = store && typeof store.get === 'function' ? await store.get(file) : null;
    if (stored) {
      const type = stored.type || '';
      if (stored.name !== file.name || ('type' in file && type !== file.type) || ('size' in file && stored.size !== file.size)) {
        throw new Error(`Сохранённый файл «${file.name}» (ID ${file.id}) не совпадает с описанием`);
      }
      checkSize(stored.size, file.name);
      return { name: file.name, type, size: stored.size, base64: await fileAsBase64(stored) };
    }
    const candidates = (Array.isArray(available) ? available : []).filter((item) => isObject(item) && item.name === file.name
      && typeof item.base64 === 'string'
      && (!('type' in file) || (item.type || '') === file.type)
      && (!('size' in file) || item.size === file.size));
    if (candidates.length === 1) return { ...candidates[0] };
    throw new Error(`Не найдено содержимое вложенного файла «${file.name}» (ID ${file.id})`);
  }

  async function resolve(steps, { store, available = [] } = {}) {
    const result = Object.create(null);
    for (const file of collect(steps)) result[file.id] = await payload(file, { store, available });
    return result;
  }

  const api = Object.freeze({ DB_NAME, STORE_NAME, DB_VERSION, MAX_FILE_BYTES, MAX_BATCH_BYTES, descriptors, validateBatch, createStore, filesFor, collect, payload, resolve });
  root.BasicInputFiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
