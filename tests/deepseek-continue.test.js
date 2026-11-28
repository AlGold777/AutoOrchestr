/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require.resolve('../content-scripts/content-deepseek'), 'utf8');

function loadPipeline({ completes }) {
  const button = { offsetParent: {}, innerText: 'Continue' };
  let answer = 'Initial answer';
  let cut = true;
  const click = jest.fn(async () => {
    answer = 'Initial answer with continuation';
    if (completes) cut = false;
  });
  const context = {
    console: { log() {}, warn() {} },
    document: {
      querySelectorAll: () => cut ? [button] : [],
      querySelector: () => null
    },
    window: {
      UnifiedAnswerPipeline: class {
        async execute() { return { success: true, answer, answerHtml: '<p>Initial answer</p>' }; }
      }
    },
    pipelineExpectedLength: () => 0,
    pipelineOverrides: {},
    deepseekHumanClick: click,
    sleep: async () => {},
    grabLatestAssistantText: () => ({ text: answer })
  };
  const start = source.indexOf('  const findDeepSeekContinueButton');
  const end = source.indexOf('  function isElementInteractable', start);
  const run = vm.runInNewContext(source.slice(start, end) + '\ntryDeepseekPipeline;', context);
  return { run, click };
}

test('a visible Continue after five attempts delivers the longest text as partial', async () => {
  const { run, click } = loadPipeline({ completes: false });
  const stop = jest.fn();

  await run('', { stop });

  expect(click).toHaveBeenCalledTimes(5);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({
    status: 'partial',
    answer: 'Initial answer with continuation',
    answerHtml: '',
    responseMeta: {
      source: 'pipeline',
      completionReason: 'answer_truncated',
      partial: true,
      degraded: true
    }
  }));
});

test('a completed continuation is delivered once with the updated text', async () => {
  const { run, click } = loadPipeline({ completes: true });
  const stop = jest.fn();

  await expect(run('', { stop })).resolves.toMatchObject({
    success: true,
    answer: 'Initial answer with continuation',
    answerHtml: ''
  });
  expect(click).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
});
