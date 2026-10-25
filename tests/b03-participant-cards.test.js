/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const H = require('./helpers/results-page-harness');

const send = (message) => chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));

describe('B03: Participant cards in the feed (5.C)', () => {
  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript();
  });

  beforeEach(() => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (typeof callback === 'function') callback({ status: 'ok' });
    });
    const clearBtn = document.getElementById('debate-session-clear-btn');
    if (clearBtn) clearBtn.click();
    const container = document.getElementById('debate-model-cards');
    if (container) container.innerHTML = '';
  });

  function dispatchAnswer(modelName, text, {
    participantId,
    stepRef = 's1',
    visit = 1,
    pipelineRunId = 'run-b03',
    pipelineRoundId = 's1',
    requestId = null,
    answerRevision = false,
    status = 'SUCCESS'
  } = {}) {
    const message = {
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: modelName,
      answer: text,
      transportRequestId: requestId || `req-${participantId}-v${visit}`,
      pipelineRunId,
      pipelineRoundId,
      participantId,
      visit,
      metadata: {
        status,
        participantId,
        stepRef,
        visit,
        pipelineRunId,
        pipelineRoundId,
        answerRevision
      }
    };
    send(message);
  }

  test('two participants of the same model in one round form TWO separate cards with distinct participantId and answers', async () => {
    // Participant C1 of Claude
    dispatchAnswer('Claude', 'First answer from C1', {
      participantId: 'C1',
      requestId: 'req-C1',
      pipelineRoundId: 's1',
      stepRef: 's1',
      visit: 1
    });

    // Participant C2 of Claude in the SAME round s1
    dispatchAnswer('Claude', 'Second answer from C2', {
      participantId: 'C2',
      requestId: 'req-C2',
      pipelineRoundId: 's1',
      stepRef: 's1',
      visit: 1
    });

    const claudeCards = Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="Claude"]'));
    // B03 Requirement: Two participants of the same model must have two separate cards in the DOM
    expect(claudeCards).toHaveLength(2);

    const cardC1 = claudeCards.find((c) => c.dataset.participantId === 'C1');
    const cardC2 = claudeCards.find((c) => c.dataset.participantId === 'C2');

    expect(cardC1).toBeDefined();
    expect(cardC2).toBeDefined();

    expect(cardC1.querySelector('.debate-model-card-output').textContent).toContain('First answer from C1');
    expect(cardC2.querySelector('.debate-model-card-output').textContent).toContain('Second answer from C2');
  });

  test('updating C1 answer (answerRevision) updates ONLY C1 card, leaving C2 untouched', async () => {
    dispatchAnswer('Claude', 'Initial answer C1', { participantId: 'C1', requestId: 'req-C1' });
    dispatchAnswer('Claude', 'Initial answer C2', { participantId: 'C2', requestId: 'req-C2' });

    // C1 sends revision (attempt 2)
    dispatchAnswer('Claude', 'Revised answer C1', {
      participantId: 'C1',
      requestId: 'req-C1-rev',
      answerRevision: true
    });

    const claudeCards = Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="Claude"]'));
    expect(claudeCards).toHaveLength(2);

    const cardC1 = claudeCards.find((c) => c.dataset.participantId === 'C1');
    const cardC2 = claudeCards.find((c) => c.dataset.participantId === 'C2');

    expect(cardC1).toBeDefined();
    expect(cardC2).toBeDefined();

    expect(cardC1.querySelector('.debate-model-card-output').textContent).toContain('Revised answer C1');
    expect(cardC2.querySelector('.debate-model-card-output').textContent).toContain('Initial answer C2');
  });

  test('distinct visits of the same participant in the same step form separate cards in the feed', async () => {
    // Visit 1 of C1 in s1
    dispatchAnswer('Claude', 'Answer from C1 visit 1', {
      participantId: 'C1',
      requestId: 'req-C1-v1',
      pipelineRoundId: 's1',
      stepRef: 's1',
      visit: 1
    });

    // Visit 2 of C1 in s1 (e.g. loop / second visit)
    dispatchAnswer('Claude', 'Answer from C1 visit 2', {
      participantId: 'C1',
      requestId: 'req-C1-v2',
      pipelineRoundId: 's1',
      stepRef: 's1',
      visit: 2
    });

    const claudeCards = Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="Claude"]'));
    expect(claudeCards).toHaveLength(2);

    const cardV1 = claudeCards.find((c) => c.dataset.visit === '1' || c.querySelector('.debate-model-card-output')?.textContent.includes('visit 1'));
    const cardV2 = claudeCards.find((c) => c.dataset.visit === '2' || c.querySelector('.debate-model-card-output')?.textContent.includes('visit 2'));

    expect(cardV1).toBeDefined();
    expect(cardV2).toBeDefined();
    expect(cardV1.querySelector('.debate-model-card-output').textContent).toContain('Answer from C1 visit 1');
    expect(cardV2.querySelector('.debate-model-card-output').textContent).toContain('Answer from C1 visit 2');
  });

  test('B03 (wiring): results.js incorporates participantId into feed card routing and card round matching', () => {
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    // 1. matchesDebateCardRound must check participantId
    const matchesBlock = resultsSource.slice(
      resultsSource.indexOf('function matchesDebateCardRound(card, meta = {}) {'),
      resultsSource.indexOf('function resolveSingleDebateAnswerCard(')
    );
    expect(matchesBlock).toContain('participantId');

    // 2. setDebateCardRound must record participantId on card dataset
    const setRoundBlock = resultsSource.slice(
      resultsSource.indexOf('function setDebateCardRound(card, meta = {}) {'),
      resultsSource.indexOf('function matchesDebateCardRound(')
    );
    expect(setRoundBlock).toContain('participantId');

    // 3. sendWave must pass participantId to updateDebateModelCardOutput
    const sendWaveBlock = resultsSource.slice(
      resultsSource.indexOf('const sendWave = async (wave, meta, waveNo) => {'),
      resultsSource.indexOf('// The chats of the wave as the background bound them')
    );
    expect(sendWaveBlock).toMatch(/updateDebateModelCardOutput\([\s\S]*?participantId/);
  });
});
