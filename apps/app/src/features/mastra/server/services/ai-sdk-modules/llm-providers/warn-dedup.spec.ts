// The dedup registry's observable contract is what it forwards to the logger:
// warnOnce/infoOnce emit at most once per dedup key until clearAvailabilityLogDedup()
// resets. The logger IS the observable side effect, so mock that boundary and assert
// on the emitted calls (not on any internal Set).
const { loggerWarn, loggerInfo } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    info: loggerInfo,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { clearAvailabilityLogDedup, infoOnce, warnOnce } from './warn-dedup';

beforeEach(() => {
  vi.clearAllMocks();
  // The registry is module-level state; reset it between tests.
  clearAvailabilityLogDedup();
});

describe('warnOnce', () => {
  it('forwards the message to logger.warn on the first call for a key', () => {
    warnOnce(
      'provider:openai|missing-api-key',
      'openai is missing its API key',
    );

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith('openai is missing its API key');
  });

  it('deduplicates repeat calls for the same key (logs once, not once per call)', () => {
    warnOnce('k', 'first');
    warnOnce('k', 'second'); // same key -> suppressed even with a different message
    warnOnce('k', 'third');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith('first');
  });

  it('logs each distinct key independently', () => {
    warnOnce('a', 'msg-a');
    warnOnce('b', 'msg-b');

    expect(loggerWarn).toHaveBeenCalledTimes(2);
  });
});

describe('infoOnce', () => {
  it('forwards the message to logger.info on the first call for a key', () => {
    infoOnce('ai:providers|env-shadowed', 'env value is shadowed');

    expect(loggerInfo).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalledWith('env value is shadowed');
  });

  it('deduplicates repeat calls for the same key', () => {
    infoOnce('k', 'first');
    infoOnce('k', 'second');

    expect(loggerInfo).toHaveBeenCalledTimes(1);
  });
});

describe('warnOnce / infoOnce independence', () => {
  it('tracks warn and info dedup separately (an identical key string does not cross-suppress)', () => {
    warnOnce('shared', 'warn message');
    infoOnce('shared', 'info message');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalledTimes(1);
  });
});

describe('clearAvailabilityLogDedup', () => {
  it('resets the registry so a previously-seen warn key logs again', () => {
    warnOnce('k', 'msg');
    warnOnce('k', 'msg');
    expect(loggerWarn).toHaveBeenCalledTimes(1); // still deduped before reset

    clearAvailabilityLogDedup();

    warnOnce('k', 'msg');
    expect(loggerWarn).toHaveBeenCalledTimes(2); // re-notified after reset
  });

  it('resets info dedup as well', () => {
    infoOnce('k', 'msg');
    clearAvailabilityLogDedup();
    infoOnce('k', 'msg');

    expect(loggerInfo).toHaveBeenCalledTimes(2);
  });
});
