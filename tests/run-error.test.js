const RunError = require('../shared/run-error');

describe('RunError', () => {
  test('normalizes unknown codes', () => {
    expect(RunError.makeRunError('bad_code', 'x')).toEqual(expect.objectContaining({
      ok: false,
      type: 'unknown',
      errorCode: 'unknown',
      message: 'x'
    }));
  });

  test('keeps type and errorCode aligned', () => {
    const err = RunError.makeRunError(RunError.CODES.RATE_LIMIT, 'rate limited');
    expect(err.type).toBe(err.errorCode);
  });

  test('marks only configured codes as recoverable', () => {
    expect(RunError.makeRunError(RunError.CODES.RATE_LIMIT).recoverable).toBe(true);
    expect(RunError.makeRunError(RunError.CODES.CAPTCHA).recoverable).toBe(false);
  });
});

describe('Basic participant codes (R01, R06)', () => {
  test('the participant codes are known codes, not unknown, and none of them is recoverable', () => {
    expect(RunError.CODES.PARTICIPANT_CHAT_LOST).toBe('participant_chat_lost');
    expect(RunError.CODES.PARTICIPANT_BINDING_FAILED).toBe('participant_binding_failed');
    expect(RunError.CODES.PARTICIPANT_API_UNSUPPORTED).toBe('participant_api_unsupported');
    ['participant_chat_lost', 'participant_binding_failed', 'participant_api_unsupported'].forEach((code) => {
      const err = RunError.makeRunError(code, 'x');
      expect(err.errorCode).toBe(code);
      expect(err.recoverable).toBe(false);
    });
  });
});
