/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');

const load = () => {
  const c = { console, Date, Map, Set, self: null };
  c.self = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve('../background/dispatch-state-machine'), 'utf8'), c);
  return c;
};

describe('dispatch state machine reset', () => {
  test.each(['QUEUED', 'ACTIVATING', 'TYPING', 'SUBMITTING', 'WAITING', 'STREAMING'])(
    'a dispatch abandoned in %s is dropped, so a new run is not read as already sent', (state) => {
      const c = load();
      const machine = c.DispatchStateManager.get('Claude');
      const path = ['QUEUED', 'ACTIVATING', 'TYPING', 'SUBMITTING', 'WAITING', 'STREAMING'];
      machine.queue({ prompt: 'p' });
      for (const next of path.slice(1, path.indexOf(state) + 1)) machine._transition(next);
      expect(machine.state).toBe(state);
      machine.reset();
      expect(machine.state).toBe('IDLE');
      const flags = c.getDispatchFlags('Claude');
      expect(flags.isSent).toBe(false);
      expect(flags.isInProgress).toBe(false);
    });

  test('an ordinary transition that is not allowed is still refused', () => {
    const c = load();
    const machine = c.DispatchStateManager.get('Claude');
    expect(machine._transition('DONE')).toBe(false);
    expect(machine.state).toBe('IDLE');
  });
});
