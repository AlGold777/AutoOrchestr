const fs = require('fs');
const path = require('path');

// T07 (mock contract): the page sends participants (sendParticipants) and the background keys the tab of a participant
// by its participant id. These checks read the wiring; the real tabs of the providers are not checked here.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const results = read('results.js');
const orchestrator = read('background/job-orchestrator.js');
const router = read('background/message-router.js');

describe('Basic page sends participants (ТЗ 7, T07)', () => {
  test('the engine gets sendParticipants and no legacy send for the Basic run', () => {
    const runAt = results.indexOf('const result = await engine.run({', results.indexOf('const runCustomFromPage = async'));
    const runBlock = results.slice(runAt, results.indexOf('const stopText = engine.STOP_TEXT', runAt));
    expect(runBlock).toContain('sendParticipants: async (requests, meta) => {');
    expect(runBlock).not.toMatch(/\n\s+send: async \(/);
  });

  test('a wave holds one request per model: the k-th request of a model goes to wave k, waves go one after another', () => {
    expect(results).toContain('const k = countByModel[request.modelName] || 0;');
    expect(results).toContain('(waves[k] ||= []).push(request);');
    expect(results).toContain('const reply = await sendWave(group, meta, key);');
  });

  test('the replies go back by participant id, and the transport gets the participant of each model', () => {
    expect(results).toContain('byParticipant[request.participantId] = reply;');
    expect(results).toContain('participants,');
    expect(results).toContain('participantId: request.participantId, newChat: isNewChat(request)');
  });

  test('the batch never asks the run-level new-pages rule: the transport decides per participant', () => {
    expect(results).toMatch(/forceNewTabs: false,\s*\n\s*useApiFallback,\s*\n\s*signal,\s*\n\s*context: \{\s*\n\s*\.\.\.runContext,\s*\n\s*participants,/);
  });

  test('chat "new" opens a chat at the first attempt of a visit; corrections go on in it; continue opens one only without a binding', () => {
    expect(results).toContain("const isNewChat = (request) => request.attempt === 1 && (request.chat === 'new'");
    expect(results).toContain('|| (!resumeRecord && runContext.forceNewTabs && !chatBindings[request.participantId]));');
  });

  test('the chat bindings go into the state of the checkpoint (the snapshot takes them, A05)', () => {
    expect(results).toContain('const chatBindings = resumeRecord ? { ...(resumeRecord.snapshot?.chatBindings || {}) } : {};');
    expect(results).toContain('state: { ...state, chatBindings: { ...chatBindings } },');
    expect(results).toContain('transportRequestId: reply.transportRequestId,');
  });

  test('the wave id keeps the attempt of a wave apart; wave 0 keeps the legacy ids', () => {
    expect(results).toContain("stageAttemptId: `custom:${runContext.pipelineRunId}:s${step + 1}:a${attempt}${waveNo ? `:w${waveNo}` : ''}`,");
    expect(results).toContain("groupIndex: waveNo ? `${attempt - 1}w${waveNo}` : attempt - 1");
  });

  test('the provider stays the model name: the start message still carries the model names', () => {
    expect(results).toContain('selectedLLMs: models,');
    expect(router).toContain("startProcess(message.prompt, message.selectedLLMs, sender.tab.id, {");
  });
});

describe('Background keys the chat of a participant by run and participant id (T07, R01)', () => {
  const branchAt = orchestrator.indexOf('async function runModelThroughTabs(');
  const branch = orchestrator.slice(branchAt, orchestrator.indexOf('//-- 3.1. Round 0', branchAt));
  const participantFn = orchestrator.slice(orchestrator.indexOf('async function runParticipantThroughTabs('), branchAt);

  test('a run keeps the participants of its pipeline context; a model without an entry is the legacy path', () => {
    expect(orchestrator).toContain('let activeParticipantRequests = {};');
    expect(orchestrator).toContain("activeParticipantRequests = pipelineContext?.participants && typeof pipelineContext.participants === 'object'");
  });

  test('the participant branch comes before the new-tabs branch of the model path', () => {
    const participantAt = branch.indexOf('const participant = activeParticipantRequests[llmName];');
    const forceAt = branch.indexOf('if (forceNewTabs) {');
    expect(participantAt).toBeGreaterThan(0);
    expect(participantAt).toBeLessThan(forceAt);
  });

  test('the participant request goes through the tab manager entry point; a refused request ends the model explicitly', () => {
    expect(participantFn).toContain('openParticipantChat(llmName, {');
    expect(participantFn).toContain('failParticipantRequest(llmName, result.error)');
  });

  test('a participant never detaches the tab of the model or of another participant', () => {
    expect(participantFn).not.toContain('detachExistingTab(');
    expect(orchestrator).not.toContain('bindParticipantTab(');
    expect(orchestrator).not.toContain('participantTabOf(');
  });

  test('a lost chat of a participant is not reopened as a new chat in the orchestrator (R01)', () => {
    expect(participantFn).not.toContain('createNewLlmTab(');
    expect(participantFn).not.toContain('tabsOfOtherParticipants(');
  });
});

describe('Attachments are confirmed per chat of a participant (R05)', () => {
  const sendAt = results.indexOf('const sendWave = async (wave, meta, waveNo) => {');
  const sendBlock = results.slice(sendAt, results.indexOf('const budgetLimits = window.DebateContextBudget', sendAt));
  const sendParticipantsBlock = results.slice(results.indexOf('sendParticipants: async (requests, meta) => {'), results.indexOf('onEvent: (kind, fields) => {', sendAt));

  test('a chat takes the files once: the page keeps the visit that opened the chat and the visit whose chat got the files', () => {
    expect(results).toContain('const filesNeeded = (request) => {');
    expect(results).toContain('return !saved || saved.attachedChatVisit !== saved.chatVisit;');
    expect(sendBlock).toContain('attachments: filesSent ? attachments : [],');
    expect(sendBlock).not.toContain('attached.has(');
    expect(results.slice(results.indexOf('const runCustomFromPage = async'), sendAt)).not.toContain('const attached = new Set();');
  });

  test('a new chat (new visit) always takes the files; a continue of a chat with confirmed files takes none', () => {
    const block = results.slice(results.indexOf('const filesNeeded = (request) => {'), results.indexOf('return !saved || saved.attachedChatVisit'));
    expect(block).toContain('if (!attachments.length) return false;');
    expect(block).toContain('if (isNewChat(request)) return true;');
  });

  test('the files are confirmed only when the answer of the chat came back (a failed delivery does not mark them)', () => {
    expect(sendBlock).toContain('const filesSent = wave.some(filesNeeded);');
    expect(sendBlock).toContain("const confirmed = filesSent && String(reply.status || '').toUpperCase() === 'SUCCESS';");
    expect(sendBlock).toContain('attachedChatVisit: confirmed ? chatVisit : (isNewChat(request) ? null : (saved?.attachedChatVisit ?? null))');
  });

  test('a wave with a continue and a new chat is split: the files go to the new chat only, the old one gets none', () => {
    expect(sendParticipantsBlock).toContain('const withFiles = wave.filter(filesNeeded);');
    expect(sendParticipantsBlock).toContain('const without = wave.filter((request) => !filesNeeded(request));');
    expect(sendParticipantsBlock).toContain("[`${waveNo}f`, withFiles], [`${waveNo}p`, without]");
  });

  test('two participants of one model stay in different waves, each decides its own files', () => {
    expect(sendParticipantsBlock).toContain('const k = countByModel[request.modelName] || 0;');
    expect(sendParticipantsBlock).toContain('for (const [waveNo, wave] of waves.entries())');
  });

  test('a resumed run takes its files from the saved record, never from the composer of the page', () => {
    expect(results).toContain('const attachments = resumeRecord');
    expect(results).toContain('? (Array.isArray(resumeRecord.attachments) ? resumeRecord.attachments : [])');
    expect(results).toContain(': await buildAttachmentPayload();');
  });
});

describe('Resumed Basic run keeps the chats of its participants (R01)', () => {
  test('a resume starts from the saved chats of the snapshot, a new run from none', () => {
    expect(results).toContain('const chatBindings = resumeRecord ? { ...(resumeRecord.snapshot?.chatBindings || {}) } : {};');
  });

  test('a continue sends the saved chat with the request; a new chat sends none', () => {
    expect(results).toContain('const binding = !isNewChat(request) && saved?.modelName === request.modelName && saved.tabId != null');
    expect(results).toContain('participantId: request.participantId, newChat: isNewChat(request), ...(binding ? { binding } : {})');
  });

  test('after each wave the page reads the chats the background bound and keeps them in the state before the next send', () => {
    expect(results).toContain("sendToBackground({ type: 'PARTICIPANT_CHAT_BINDINGS', pipelineRunId })");
    expect(results).toContain('await refreshParticipantChats(runContext.pipelineRunId, wave);');
    const sendAt = results.indexOf('const sendWave = async (wave, meta, waveNo) => {');
    expect(results.indexOf('await refreshParticipantChats(runContext.pipelineRunId, wave);', sendAt)).toBeGreaterThan(sendAt);
  });

  test('the background answers the bindings of one run and passes the saved binding to the participant', () => {
    const handlers = fs.readFileSync(path.join(__dirname, '..', 'background', 'pipeline-message-handlers.js'), 'utf8');
    expect(handlers).toContain("if (message?.type === 'PARTICIPANT_CHAT_BINDINGS') {");
    expect(handlers).toContain('self.participantChatBindingsOf?.(message.pipelineRunId || null)');
    expect(orchestrator).toContain('binding: participant.binding || null');
  });
});

describe('Unknown request: the answer is checked, never sent again (N04)', () => {
  test('the page gives the engine a read-only check that asks the background for the chat of the participant', () => {
    expect(results).toContain("type: 'CHECK_PARTICIPANT_ANSWER', pipelineRunId: runContext.pipelineRunId, participantId, modelName,");
    expect(results).toContain('const checkUnknown = async ({ participantId, modelName, transportRequestId = null, excludeText = \'\' }) => {');
    expect(results).toContain('                    checkUnknown,\n');
  });

  test('the check sends the saved tab of the participant only for its own model, and a failed check is not a success', () => {
    expect(results).toContain('tabId: saved?.modelName === modelName ? (saved.tabId ?? null) : null');
    expect(results).toContain("if (!response?.success) return { ok: false, status: 'chat_unavailable', reason: 'check_failed', text: '', tabId: null };");
  });

  test('the background check never sends or binds: it reads one chat through the scripting read only', () => {
    const tabs = fs.readFileSync(path.join(__dirname, '..', 'background', 'tab-manager.js'), 'utf8');
    const at = tabs.indexOf('async function checkParticipantAnswer(');
    const block = tabs.slice(at, tabs.indexOf('// Binds the tab to the participant, then sends.', at));
    expect(at).toBeGreaterThan(0);
    expect(block).not.toContain('dispatchPromptToTab(');
    expect(block).not.toContain('bindParticipantChat(');
    expect(block).not.toContain('createNewLlmTab(');
    expect(block).not.toContain('tryAttachExistingTab(');
    expect(block).not.toContain('tabsOfOtherParticipants(');
    expect(block).toContain('excludeTextSignatures');
  });

  test('the message is answered by the background handler and is routed before the legacy switch', () => {
    const handlers = fs.readFileSync(path.join(__dirname, '..', 'background', 'pipeline-message-handlers.js'), 'utf8');
    expect(handlers).toContain("if (message?.type === 'CHECK_PARTICIPANT_ANSWER') {");
    expect(handlers).toContain('self.checkParticipantAnswer?.({');
  });
});
