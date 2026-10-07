// Deterministic routing hints for dynamic Disput actions. Capabilities are
// accepted only when explicitly declared or when a small documented provider
// rule is available; this module does not estimate model quality.
(function initDebateCapabilityRegistry(root) {
  'use strict';
  const VERSION = 1;
  const text = (value) => String(value == null ? '' : value).trim();
  const FAMILY_PATTERNS = Object.freeze([
    ['openai', /\b(?:gpt|chatgpt|o\d)\b/i], ['anthropic', /\b(?:claude)\b/i],
    ['google', /\b(?:gemini|bard)\b/i], ['xai', /\b(?:grok)\b/i],
    ['alibaba', /\b(?:qwen)\b/i], ['deepseek', /\b(?:deepseek)\b/i],
    ['mistral', /\b(?:mistral|mixtral)\b/i], ['perplexity', /\b(?:perplexity|sonar)\b/i],
    ['zhipu', /\b(?:glm|z\.ai|zai)\b/i],
    ['moonshot', /\b(?:kimi|moonshot)\b/i]
  ]);

  function infer(model) {
    const name = text(typeof model === 'string' ? model : model?.name || model?.model);
    const explicit = typeof model === 'object' ? model : {};
    const family = text(explicit.family || FAMILY_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] || name.toLowerCase() || 'unknown');
    return Object.freeze({
      name, provider: text(explicit.provider || family), family,
      capabilities: Object.freeze({
        text: true, json: explicit.json !== false,
        research: explicit.research === true || /perplexity|sonar/i.test(name),
        tools: Array.isArray(explicit.tools) ? explicit.tools.slice() : [],
        vision: explicit.vision === true,
        longContext: explicit.longContext !== false
      }),
      declared: typeof model === 'object'
    });
  }

  function independence(candidate, owner, synthesizer, requirement) {
    if (!owner) return { level: 'unknown_owner', score: 1, degraded: false };
    if (candidate.name === owner.name) return { level: 'self', score: 0, degraded: requirement !== 'none' };
    if (candidate.family === owner.family) return { level: 'same_family', score: 1, degraded: requirement === 'different_family_required' };
    if (candidate.provider === owner.provider) return { level: 'same_provider', score: 2, degraded: requirement === 'different_family_required' };
    if (candidate.name === synthesizer?.name) return { level: 'synthesizer', score: 2, degraded: requirement === 'different_family_required' };
    return { level: 'independent_family', score: 4, degraded: false };
  }

  function rank(input = {}) {
    const models = (Array.isArray(input.models) ? input.models : []).map(infer);
    const owner = input.owner ? infer(input.owner) : null;
    const synthesizer = input.synthesizer ? infer(input.synthesizer) : null;
    const action = input.action || {};
    const requiredTool = text(action.requiredTool);
    return models.map((candidate) => {
      const independent = independence(candidate, owner, synthesizer, text(action.independence || 'none'));
      const toolReady = !requiredTool || candidate.capabilities.tools.includes(requiredTool) || (requiredTool === 'web_research' && candidate.capabilities.research);
      const capability = toolReady ? 1 : 0;
      const score = independent.score * 10 + capability;
      return { model: candidate.name, descriptor: candidate, independence: independent, toolReady, score };
    }).sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
  }

  function choose(input = {}) {
    const ranked = rank(input);
    if (!ranked.length) return null;
    const strict = ranked.find((entry) => !entry.independence.degraded && entry.toolReady);
    const selected = strict || ranked[0];
    return Object.freeze({
      ...selected,
      degraded: !strict,
      degradedReasons: Object.freeze([
        ...(!selected.toolReady ? ['required_tool_unavailable'] : []),
        ...(selected.independence.degraded ? [`independence_${selected.independence.level}`] : [])
      ])
    });
  }

  function supportsTool(model, tool) {
    const descriptor = infer(model);
    const required = text(tool);
    return !required || descriptor.capabilities.tools.includes(required)
      || (required === 'web_research' && descriptor.capabilities.research);
  }

  function validateRequirements({ models = [], tools = [] } = {}) {
    const requiredTools = Array.from(new Set((Array.isArray(tools) ? tools : []).map(text).filter(Boolean)));
    const missingTools = requiredTools.filter((tool) => !models.some((model) => supportsTool(model, tool)));
    return Object.freeze({ ok: missingTools.length === 0, missingTools: Object.freeze(missingTools) });
  }

  const api = Object.freeze({ VERSION, infer, independence, rank, choose, supportsTool, validateRequirements });
  root.DebateCapabilityRegistry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
