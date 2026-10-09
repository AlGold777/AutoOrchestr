// Small UI helper catalog. Executable prompts live in DebatePromptPack.
(function initDebatePromptCatalog(root) {
  'use strict';
  const SYNTHESIS_REQUIRED_SECTIONS = Object.freeze(['Вердикт', 'Что устояло', 'Позиции меньшинства', 'Нерешённые вопросы', 'Уверенность и основания']);
  const normalizeMaxWords = (value) => {
    const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };
  const validateRequiredSections = (value, sections = []) => sections.filter((section) => !new RegExp(`(?:^|\\n)#{1,6}\\s*${String(section).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'i').test(String(value || '')));
  const validateSynthesisSections = (value) => validateRequiredSections(value, SYNTHESIS_REQUIRED_SECTIONS);
  // Role labels renamed: a stored old label resolves to the new one (lookup is case-insensitive).
  const LEGACY_ROLE_LABELS = Object.freeze({ 'meta-синтез': 'Synthes', 'критический аудит': 'Critique' });
  const resolveParticipantRoleText = (role, index = 0) => {
    const text = String(role || `Participant ${index + 1}`).trim();
    return LEGACY_ROLE_LABELS[text.toLowerCase()] || text;
  };
  const resolveProtocolMission = (profile = {}) => String(profile.mission || profile.description || 'Produce a verifiable contribution to the shared StateMap.');
  const resolveDiscussionTopic = ({ topic, moderatorMessage } = {}) => String(topic || moderatorMessage || '').trim();
  const api = Object.freeze({ SYNTHESIS_REQUIRED_SECTIONS, normalizeMaxWords, validateRequiredSections, validateSynthesisSections, resolveParticipantRoleText, resolveProtocolMission, resolveDiscussionTopic });
  root.DebatePromptCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
