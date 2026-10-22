describe('rate-limit alarms', () => {
  beforeEach(() => {
    jest.resetModules();
    global.self = global;
    global.updateModelState = jest.fn();
    global.broadcastGlobalState = jest.fn();
    global.chrome = {
      storage: {
        session: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => {})
        },
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => {})
        }
      },
      alarms: {
        create: jest.fn(),
        clear: jest.fn(),
        onAlarm: { addListener: jest.fn() }
      }
    };
  });

  test('setRateLimit persists state and creates an alarm', () => {
    require('../background/rate-limit');
    self.setRateLimit('GPT', 60000);
    expect(chrome.alarms.create).toHaveBeenCalledWith('rate_limit_retry::GPT', expect.objectContaining({
      when: expect.any(Number)
    }));
    expect(chrome.storage.session.set).toHaveBeenCalled();
    expect(self.isRateLimited('GPT')).toBe(true);
  });

  test('alarm clears state', () => {
    require('../background/rate-limit');
    self.setRateLimit('GPT', 60000);
    const handler = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    handler({ name: 'rate_limit_retry::GPT' });
    expect(self.isRateLimited('GPT')).toBe(false);
  });

  test('clearAllRateLimits cancels retry callbacks and alarms, then persists empty state', async () => {
    require('../background/rate-limit');
    self.setRateLimit('GPT', 60000);
    const retry = jest.fn();
    self.scheduleRateLimitRetry('GPT', retry);
    const alarmHandler = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    const modelStateCalls = updateModelState.mock.calls.length;
    const broadcastCalls = broadcastGlobalState.mock.calls.length;

    await self.clearAllRateLimits();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('rate_limit_retry::GPT');
    expect(self.isRateLimited('GPT')).toBe(false);
    expect(chrome.storage.session.set).toHaveBeenLastCalledWith({ 'rateLimitUntilByModel.v1': {} });

    alarmHandler({ name: 'rate_limit_retry::GPT' });
    expect(retry).not.toHaveBeenCalled();
    expect(updateModelState).toHaveBeenCalledTimes(modelStateCalls);
    expect(broadcastGlobalState).toHaveBeenCalledTimes(broadcastCalls);
  });
});
