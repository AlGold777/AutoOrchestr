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
  function register(registry, { id, name, lineage, source, answerRef, pointer, valid = true, inputs = [], description = '' }) {
    const key = versionKey(lineage, source);
    const existing = registry.entries.find((entry) => versionKey(entry.lineage, entry.source) === key);
    if (existing) return { entry: existing, created: false };
    const entry = {
      id, name, lineage: { ...lineage }, source: { ...source }, content: { answerRef, pointer }, valid: valid !== false, inputs: inputs.slice()
    };
    // The description (output.artifacts[].description) is kept only when the author gave one.
    if (description) entry.description = String(description);
    registry.entries.push(entry);
    return { entry, created: true };
  }

  // The latest current version of a line: its last registered version (by the order of registration, not by visit), when that
  // one is valid. A line whose last version is stale waits for a new version (ТЗ 3.4): null, and an older valid version is
  // never put in its place. `base` gives the author of a revision its declared input: the last valid version of the line.
  function latest(registry, lineage, { base = false } = {}) {
    const key = lineKey(lineage);
    const versions = registry.entries.filter((entry) => lineKey(entry.lineage) === key);
    const head = versions[versions.length - 1];
    if (!head) return null;
    if (head.valid) return head;
    if (!base) return null;
    return versions.slice().reverse().find((entry) => entry.valid) || null;
  }

  // The version a source names: the line, then the creator step, participant and visit. Null when there is none.
  function version(registry, lineage, address) {
    const key = lineKey(lineage);
    return registry.entries.find((entry) => lineKey(entry.lineage) === key
      && entry.source.step === address.step && entry.source.participant === address.participant && entry.source.visit === address.visit) || null;
  }

  // The documents for reading (output.document: read) of a run at its end: the last valid version of each line, in the order
  // of registration. A line is a document when the output of its author (the participant's own, else the step's) says so.
  // `steps` are the steps of the run (BasicSchema.assemble); the copy on disk ends with this version, not with the approved one.
  function finalDocuments(steps, entries) {
    const isDocument = (lineage) => {
      const step = (Array.isArray(steps) ? steps : []).find((item) => item && item.ref === lineage.step);
      if (!step) return false;
      const author = (Array.isArray(step.models) ? step.models : []).find((model) => model && (model.id ?? model.name) === lineage.participant);
      const output = author && author.output !== undefined ? author.output : step.output;
      return Boolean(output) && output.document === 'read' && output.format !== 'json';
    };
    const last = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (entry && entry.valid !== false && isDocument(entry.lineage)) last.set(lineKey(entry.lineage), entry);
    });
    return [...last.values()];
  }

  const api = Object.freeze({ createRegistry, register, latest, version, lineKey, finalDocuments });
  root.BasicArtifacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
