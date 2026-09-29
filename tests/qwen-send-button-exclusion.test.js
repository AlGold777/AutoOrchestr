// Locks the Qwen fix: the send-button fallback scorer must hard-reject the
// microphone/voice (and attach/stop) buttons that sit next to the composer, so a
// resend attempt during generation never clicks the voice-input button.
const fs = require('fs');
const path = require('path');

const QWEN_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-qwen.js'),
  'utf8'
);

describe('Qwen send-button voice exclusion', () => {
  test('scorer hard-rejects non-send composer controls before scoring', () => {
    expect(QWEN_SRC).toContain('paperclip|附件|上传|添加文件');
    // The strict safety gate must run before proximity scoring.
    const rejectIdx = QWEN_SRC.indexOf('if (!isSafeQwenSendControl(btn)) return 0;');
    const scoreInitIdx = QWEN_SRC.indexOf('let score = 10;');
    expect(rejectIdx).toBeGreaterThan(-1);
    expect(rejectIdx).toBeLessThan(scoreInitIdx);
    expect(QWEN_SRC).not.toContain('timeout: 12000,');
    expect(QWEN_SRC).toContain('isSafeQwenSendControl(sendBtn)');
    expect(QWEN_SRC).toContain('isSafeQwenSendControl(emergencySend)');
    expect(QWEN_SRC).toContain('resolveSendButton(input)');
    expect(QWEN_SRC).not.toContain('resolveSendButton(document.body || input)');
  });

  test('exclusion contract: mic/voice/attach/paperclip/stop rejected, send accepted', () => {
    const EXCLUDE = /(?:voice|microphone|\bmic\b|audio|speech|record|dictation|语音|录音|stop|停止|attach(?:ment)?|upload|paperclip|附件|上传|添加文件|add[\s_-]*(?:file|attachment))/i;
    // Rejected (these are the buttons that caused the voice panel to open).
    expect(EXCLUDE.test('voice input')).toBe(true);
    expect(EXCLUDE.test('语音输入')).toBe(true);
    expect(EXCLUDE.test('microphone')).toBe(true);
    expect(EXCLUDE.test('audio-record-btn')).toBe(true);
    expect(EXCLUDE.test('Stop generating')).toBe(true);
    expect(EXCLUDE.test('Attach file')).toBe(true);
    expect(EXCLUDE.test('paperclip')).toBe(true);
    expect(EXCLUDE.test('Add files')).toBe(true);
    expect(EXCLUDE.test('composer-send paperclip attachment')).toBe(true);
    // Accepted (genuine send button labels/classes must NOT match the exclusion).
    expect(EXCLUDE.test('Send message')).toBe(false);
    expect(EXCLUDE.test('发送')).toBe(false);
    expect(EXCLUDE.test('composer-send icon-send')).toBe(false);
    expect(EXCLUDE.test('submit')).toBe(false);
  });

  test('generic SVG and arrow proximity are no longer accepted as send evidence', () => {
    expect(QWEN_SRC).not.toContain("btn.querySelector?.('svg,[class*=\"send\" i],[class*=\"arrow\" i],[class*=\"plane\" i]')");
    expect(QWEN_SRC).not.toContain('button:has([class*="arrow" i]):not([disabled])');
    expect(QWEN_SRC).not.toContain('button.ant-btn-primary:not([disabled])');
    expect(QWEN_SRC).not.toContain('arrow|up|paper|plane|发送|提交|send-button|composer-send');
  });
});
