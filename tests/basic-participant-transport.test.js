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
    expect(results).toContain('const reply = await sendWave(wave, meta, waveNo);');
  });

  test('the replies go back by participant id, and the transport gets the participant of each model', () => {
    expect(results).toContain('byParticipant[request.participantId] = byModel[request.modelName];');
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
    expect(results).toContain('const chatBindings = {};');
    expect(results).toContain('state: { ...state, chatBindings: { ...chatBindings } },');
    expect(results).toContain('transportRequestId: byModel[request.modelName].transportRequestId');
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

describe('Attachments follow the participant, not the model name (T07)', () => {
  test('the attachments of a wave go to a participant that has not had them yet, keyed by participant id', () => {
    expect(results).toContain('attachments: wave.some((request) => !attached.has(request.participantId)) ? attachments : [],');
    expect(results).toContain('wave.forEach((request) => attached.add(request.participantId));');
  });

  test('the set of attached participants is not keyed by the model name in the Basic send', () => {
    const sendAt = results.indexOf('const sendWave = async (wave, meta, waveNo) => {');
    const sendBlock = results.slice(sendAt, results.indexOf('const budgetLimits = window.DebateContextBudget', sendAt));
    expect(sendAt).toBeGreaterThan(0);
    expect(sendBlock).not.toContain('attached.has(model)');
    expect(sendBlock).not.toContain('attached.add(model)');
  });
});
