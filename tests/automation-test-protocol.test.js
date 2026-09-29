const Protocol = require('../automation-test-protocol.js');

describe('Automation Layer v2.1 smoke protocol', () => {
  const call = 'C-ABC123';
  const attempt = 'A1-T-XYZ789';

  test('builds a round-one prompt with transport identity and user request', () => {
    const prompt = Protocol.buildRoundOnePrompt({
      modelName: 'GPT',
      userPrompt: 'Explain CAP theorem.',
      callToken: call,
      attemptToken: attempt
    });
    expect(prompt).toContain(`<<<PAF_CALL ${call} ${attempt}>>>`);
    expect(prompt).toContain('Explain CAP theorem.');
    expect(prompt).toContain(`<<<PAF_RESPONSE ${call} ${attempt}>>>`);
  });

  test('accepts one exact framed JSON response', () => {
    const raw = [
      Protocol.responseOpenMarker(call, attempt),
      '{"result":"COMPLETE","content":"Answer one\\nAnswer two"}',
      Protocol.responseCloseMarker(call, attempt)
    ].join('\n');
    const parsed = Protocol.parseFramedResponse(raw, call, attempt);
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('Answer one\nAnswer two');
  });

  test('rejects stale attempt identity', () => {
    const raw = [
      Protocol.responseOpenMarker(call, 'A0-OLD'),
      '{"result":"COMPLETE","content":"stale"}',
      Protocol.responseCloseMarker(call, 'A0-OLD')
    ].join('\n');
    expect(Protocol.parseFramedResponse(raw, call, attempt)).toMatchObject({ ok: false });
  });

  test('rejects meaningful trailing assistant content', () => {
    const raw = [
      Protocol.responseOpenMarker(call, attempt),
      '{"result":"COMPLETE","content":"ok"}',
      Protocol.responseCloseMarker(call, attempt),
      'more answer after the frame'
    ].join('\n');
    expect(Protocol.parseFramedResponse(raw, call, attempt)).toEqual({
      ok: false,
      error: 'response_trailing_content'
    });
  });

  test('rejects unknown machine-shaped fields', () => {
    const raw = [
      Protocol.responseOpenMarker(call, attempt),
      '{"result":"COMPLETE","content":"ok","run_id":"forged"}',
      Protocol.responseCloseMarker(call, attempt)
    ].join('\n');
    const parsed = Protocol.parseFramedResponse(raw, call, attempt);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('semantic_response_unknown_fields');
  });

  test('combines exactly two sources deterministically', () => {
    const combined = Protocol.combineAnswers(['GPT', 'Claude'], {
      GPT: { content: 'gpt answer' },
      Claude: { content: 'claude answer' }
    });
    expect(combined.indexOf('GPT')).toBeLessThan(combined.indexOf('Claude'));
    expect(combined).toContain('gpt answer');
    expect(combined).toContain('claude answer');
  });

  test('round two includes original request and combined sources', () => {
    const prompt = Protocol.buildRoundTwoPrompt({
      modelName: 'Claude',
      originalPrompt: 'Original task',
      combinedAnswers: 'SOURCE A\nSOURCE B',
      callToken: call,
      attemptToken: attempt
    });
    expect(prompt).toContain('Original task');
    expect(prompt).toContain('SOURCE A\nSOURCE B');
    expect(prompt).toContain('SYNTHESIS_TASK_BEGIN');
  });
});
