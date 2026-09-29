// Automation Lab — registry projections and immutable InputSnapshot construction.
(function initAlSnapshot(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');

  const refOf = (entry) => ({ code: entry.code, object_id: entry.object_id, version: entry.version });
  const refKey = (ref) => `${ref.object_id}@v${ref.version}`;
  const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // registry records are {project_id, object_id, version, entry}; returns latest non-stale entries.
  function latestEntries(records) {
    const latest = new Map();
    records.forEach((record) => {
      const current = latest.get(record.object_id);
      if (!current || record.version > current.version) latest.set(record.object_id, record.entry);
    });
    return [...latest.values()].filter((entry) => !entry.stale).sort((a, b) => compareIds(a.object_id, b.object_id));
  }

  function selectorMatches(selector, entry) {
    if (!(selector.codes || []).includes(entry.code)) return false;
    if (Array.isArray(selector.statuses) && selector.statuses.length && !selector.statuses.includes(entry.status)) return false;
    if (selector.where) {
      return Object.entries(selector.where).every(([path, expected]) => {
        const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), entry);
        return value === expected;
      });
    }
    return true;
  }

  // Resolves stage.contract.input_selectors (version_policy LATEST_NONSTALE) against the registry.
  function resolveInputs(stage, entries) {
    const selected = new Map();
    const missing = [];
    (stage.contract.input_selectors || []).forEach((selector) => {
      const matches = entries.filter((entry) => selectorMatches(selector, entry));
      if (selector.required && matches.length < (selector.min_count || 1)) {
        missing.push(`${selector.codes.join('|')}${selector.statuses ? ` in ${selector.statuses.join('|')}` : ''}`);
      }
      matches.forEach((entry) => selected.set(entry.object_id, entry));
    });
    return { entries: [...selected.values()].sort((a, b) => compareIds(a.object_id, b.object_id)), missing };
  }

  function accountableSet(stage, snapshotEntries) {
    const obligation = stage.response_contract?.dispositions_required ? stage.response_contract.coverage_obligation : null;
    if (!obligation) return [];
    return snapshotEntries.filter((entry) => selectorMatches(obligation.selector, entry)).map(refOf);
  }

  // The snapshot body is exactly what the model sees as ACTIVE objects; its JCS hash is the
  // input_snapshot_hash the model must echo byte-for-byte.
  function buildSnapshot({ projectId, stage, entries }) {
    const items = entries.map((entry) => ({
      ref: refOf(entry),
      status: entry.status,
      blocking: entry.blocking,
      authority_class: entry.authority_class,
      created_stage: entry.created_stage,
      payload: entry.payload
    }));
    const body = { stage: stage.n, items };
    const hash = Canonical.hashJson(body);
    return {
      snapshot_id: `SNAP-S${stage.n}-${hash.slice(0, 16)}`,
      project_id: projectId,
      stage: stage.n,
      input_snapshot_hash: hash,
      items,
      refs: items.map((item) => item.ref),
      accountable: accountableSet(stage, entries)
    };
  }

  const api = Object.freeze({ refOf, refKey, latestEntries, selectorMatches, resolveInputs, accountableSet, buildSnapshot });
  root.AlSnapshot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
