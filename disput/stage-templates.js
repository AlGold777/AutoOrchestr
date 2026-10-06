// Registry of stage templates of the pipeline: a template name (the `stageTemplate` of a built-in
// pipeline definition) maps to a framework with the same small interface:
//   byNumber(n)                      the stage of a canvas round (null past the last stage)
//   participantsFor(stage, models)   which of the selected models work at that stage
//   STAGES / PHASES                  the catalogue
// The page asks the registry instead of naming a framework, so a new template is a new framework
// file plus one line here.
(function initStageTemplates(root) {
  'use strict';

  const FRAMEWORKS = Object.freeze({
    architecture: { global: 'ArchitectureFramework', module: './architecture-framework' },
    research: { global: 'ResearchFramework', module: './research-framework' }
  });
  const key = (name) => String(name == null ? '' : name).trim().toLowerCase();

  function get(name) {
    const entry = FRAMEWORKS[key(name)];
    if (!entry) return null;
    if (root[entry.global]) return root[entry.global];
    try { return typeof require === 'function' ? require(entry.module) : null; } catch (_) { return null; }
  }

  const has = (name) => Object.prototype.hasOwnProperty.call(FRAMEWORKS, key(name));
  const names = () => Object.keys(FRAMEWORKS);

  const api = Object.freeze({ get, has, names });
  root.StageTemplates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
