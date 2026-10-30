const A = require('../disput/debate-response-acceptance');
const Engine = require('../disput/custom-engine');

const long = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ') + '.';

describe('acceptance refuses an answer whose transport status is not proven complete', () => {
  test.each(['EXTRACT_FAILED', 'FAILED', 'UNCERTAIN', 'INTERRUPTED', 'TIMEOUT', 'NO_SEND'])(
    'status %s without completion:complete is refused as unproven_status', (status) => {
      const verdict = A.evaluate({ text: long, meta: { status, completion: '' } });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe('unproven_status');
      expect(verdict.details.status).toBe(status);
    });

  test('the 172-character progress preamble with EXTRACT_FAILED is refused, not accepted', () => {
    const preamble = 'Проверю ключевые платформенные ограничения и способы записи с восстановлением после сбоя, затем сведу решения в единую архитектуру MVP с альтернативами и критериями выбора.';
    expect(A.evaluate({ text: preamble, meta: { status: 'EXTRACT_FAILED' } }).reason).toBe('unproven_status');
  });

  test('a transport-proven completion overrides the status', () => {
    expect(A.evaluate({ text: long, meta: { status: 'EXTRACT_FAILED', completion: 'complete' } }).ok).toBe(true);
  });

  test('SUCCESS and PARTIAL with completion:complete are accepted as before', () => {
    expect(A.evaluate({ text: long, meta: { status: 'SUCCESS' } }).ok).toBe(true);
    expect(A.evaluate({ text: long, meta: { status: 'PARTIAL', completion: 'complete' } }).ok).toBe(true);
  });

  test('PARTIAL without proof keeps its own reason', () => {
    expect(A.evaluate({ text: long, meta: { status: 'PARTIAL', completion: 'partial' } }).reason).toBe('partial_unproven');
  });

  test('other reasons do not change: a status-less short answer and an empty text', () => {
    expect(A.evaluate({ text: 'Да.', meta: {} }).ok).toBe(true);
    expect(A.evaluate({ text: '', meta: { status: 'SUCCESS' } }).reason).toBe('empty');
  });

  test('the engine has a reason text for unproven_status', () => {
    expect(Engine.REASON_TEXT.unproven_status).toBe('не подтверждено окончание:');
  });
});
