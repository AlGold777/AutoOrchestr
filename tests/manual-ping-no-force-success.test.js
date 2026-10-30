// P0.5: a manual ping / late-collect must not FORCE terminal success on weak
// evidence. acceptLateCollectResult now gates the force flag on terminal-eligibility
// (length >= min, not a prompt echo) so a non-answer lands PARTIAL, not forced SUCCESS.
const fs = require('fs');
const path = require('path');

const ORCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

describe('manual ping no force-success (P0.5)', () => {
  test('force flag is gated on candidate terminal-eligibility', () => {
    expect(ORCH_SRC).toContain('const forceTerminalRequested = Boolean(');
    expect(ORCH_SRC).toContain('const candidateTerminalEligible = Boolean(');
    expect(ORCH_SRC).toContain('forceTerminalRequested && candidateTerminalEligible');
    expect(ORCH_SRC).toContain('Forced terminal success withheld (weak evidence)');
  });

  test('eligibility contract: prompt-echo / too-short are not force-eligible', () => {
    const MIN = 80;
    const eligible = (text, prompt) => {
      const isEcho = !!text && !!prompt && text.trim() === prompt.trim();
      return !!text && text.length >= MIN && !isEcho;
    };
    const force = (requested, snapshotPartial, text, prompt) =>
      Boolean(!snapshotPartial && requested && eligible(text, prompt));

    const prompt = 'Explain the CAP theorem in detail.';
    expect(force(true, false, 'x'.repeat(300), prompt)).toBe(true);      // real long answer -> force ok
    expect(force(true, false, prompt, prompt)).toBe(false);              // prompt echo -> withheld
    expect(force(true, false, 'too short', prompt)).toBe(false);         // < min -> withheld
    expect(force(true, true, 'x'.repeat(300), prompt)).toBe(false);      // snapshot partial -> never force
    expect(force(false, false, 'x'.repeat(300), prompt)).toBe(false);    // not requested -> no force
  });
});

describe('C5: a forced SUCCESS needs delivery proof', () => {
  test('force requires the delivery token or a verified answer; otherwise the text is PARTIAL', () => {
    expect(ORCH_SRC).toContain('const deliveryProven = Boolean(');
    expect(ORCH_SRC).toContain("incomingResponseMeta.answerVerification?.verified === true");
    expect(ORCH_SRC).toContain('answerHasDeliveryToken(llmName, incomingText)');
    expect(ORCH_SRC).toContain('forceTerminalRequested && candidateTerminalEligible && deliveryProven');
    expect(ORCH_SRC).toContain('partial: Boolean(incomingResponseMeta.partial || isSnapshotPartial || forceWithoutProof)');
  });
});
