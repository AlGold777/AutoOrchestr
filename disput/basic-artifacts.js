// Basic artifact registry (technical spec 5.3): the artifacts that accepted answers declare, in the run's record.
// A record is one entry per version: { id, name, lineage, source, content: { answerRef, pointer }, valid, inputs }.
// The lineage is the address of the first declaration (step, participant, artifact id); the source is the address of
// the version (step, participant, visit). The content is not copied: answerRef names the stored answer (putText),
// pointer names the part of it (an empty pointer is the whole answer). Pure functions: the engine calls them.
(function initBasicArtifacts(root) {
  'use strict';

  const lineKey = (lineage) => JSON.stringify([lineage.step, lineage.participant, lineage.id]);
  const versionKey = (lineage, source) => JSON.stringify([lineage.step, lineage.participant, lineage.id, source.step, source.participant, source.visit]);

  const createRegistry = () => ({ entries: [] });

  // Registers one version. The same line and source give the entry registered before (idempotent): a repeated
  // acceptance never makes a second version. Returns { entry, created }.
  function register(registry, { id, name, lineage, source, answerRef, pointer, valid = true, inputs = [] }) {
    const key = versionKey(lineage, source);
    const existing = registry.entries.find((entry) => versionKey(entry.lineage, entry.source) === key);
    if (existing) return { entry: existing, created: false };
    const entry = {
      id, name, lineage: { ...lineage }, source: { ...source }, content: { answerRef, pointer }, valid: valid !== false, inputs: inputs.slice()
    };
    registry.entries.push(entry);
    return { entry, created: true };
  }

  // The latest current version of a line: by the order of registration, not by visit. Null when there is none.
  function latest(registry, lineage) {
    const key = lineKey(lineage);
    let found = null;
    registry.entries.forEach((entry) => { if (entry.valid && lineKey(entry.lineage) === key) found = entry; });
    return found;
  }

  // The version a source names: the line, then the creator step, participant and visit. Null when there is none.
  function version(registry, lineage, address) {
    const key = lineKey(lineage);
    return registry.entries.find((entry) => lineKey(entry.lineage) === key
      && entry.source.step === address.step && entry.source.participant === address.participant && entry.source.visit === address.visit) || null;
  }

  // Marks the versions that the predicate names as not current (valid false). The history stays: the entries are kept.
  // Returns how many versions changed.
  function markInvalid(registry, isStale) {
    let changed = 0;
    registry.entries.forEach((entry) => {
      if (entry.valid && isStale(entry)) {
        entry.valid = false;
        changed += 1;
      }
    });
    return changed;
  }

  const api = Object.freeze({ createRegistry, register, latest, version, lineKey, markInvalid });
  root.BasicArtifacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
