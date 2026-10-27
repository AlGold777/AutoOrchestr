// Address input attachments by participant and chat, independently of provider names.
(function initBasicFileDelivery(root) {
  'use strict';

  function create({ steps, globalFiles = [], payloads = {}, bindings, isNewChat }) {
    const sourceFiles = root.BasicInputFiles || (typeof require === 'function' ? require('./basic-input-files') : null);
    function pending(request) {
      const saved = bindings[request.participantId];
      const fresh = isNewChat(request);
      const global = globalFiles.length > 0 && (fresh || !saved || saved.attachedChatVisit !== saved.chatVisit);
      const known = new Set(fresh ? [] : (saved?.inputFileIds || []));
      const step = steps.find((item) => item.ref === request.stepRef);
      const ids = sourceFiles.filesFor(step, request.participantId).map((file) => file.id).filter((id) => !known.has(id));
      const files = global ? [...globalFiles] : [];
      ids.forEach((id) => {
        if (!Object.hasOwn(payloads, id)) throw new Error(`Нет сохранённого содержимого входного файла «${id}»`);
        const file = payloads[id];
        if (!files.some((existing) => existing.name === file.name && existing.type === file.type && existing.base64 === file.base64)) files.push(file);
      });
      sourceFiles.validateBatch(files);
      return { global, ids, files };
    }
    function groups(wave, waveNo) {
      const groupsByFiles = new Map();
      wave.forEach((request) => {
        const next = pending(request);
        const key = JSON.stringify([next.global, [...next.ids].sort()]);
        if (!groupsByFiles.has(key)) groupsByFiles.set(key, []);
        groupsByFiles.get(key).push(request);
      });
      return [...groupsByFiles.values()].map((group, index) => [`${waveNo}f${index}`, group]);
    }
    // Called only after confirmed delivery. Failure leaves the IDs pending for a retry.
    function confirmed(request, status, sent) {
      const fresh = isNewChat(request);
      const known = fresh ? [] : (bindings[request.participantId]?.inputFileIds || []);
      return String(status || '').toUpperCase() === 'SUCCESS'
        ? [...new Set([...known, ...sent.ids])]
        : known;
    }
    return Object.freeze({ pending, groups, confirmed });
  }

  const api = Object.freeze({ create });
  root.BasicFileDelivery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
