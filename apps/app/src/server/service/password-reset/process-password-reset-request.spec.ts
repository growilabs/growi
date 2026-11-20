import {
  type PasswordResetRequestOutcome,
  type ProcessPasswordResetRequestDeps,
  processPasswordResetRequest,
} from './process-password-reset-request';

const RESPOND_AT = 18_000;

const createDeps = (
  overrides: Partial<ProcessPasswordResetRequestDeps> = {},
): ProcessPasswordResetRequestDeps => ({
  isResettableAccount: vi.fn().mockResolvedValue(true),
  sendPasswordResetMail: vi.fn().mockResolvedValue(undefined),
  onMailSent: vi.fn(),
  onError: vi.fn(),
  onDeadlineExceeded: vi.fn(),
  ...overrides,
});

/** Start processing and expose whether / how it has settled. */
const start = (deps: ProcessPasswordResetRequestDeps) => {
  const state: { outcome?: PasswordResetRequestOutcome } = {};
  processPasswordResetRequest('user@example.com', deps, RESPOND_AT).then(
    (outcome) => {
      state.outcome = outcome;
    },
  );
  return state;
};

const delayed = <T>(ms: number, run: () => T): Promise<Awaited<T>> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      Promise.resolve(run()).then(resolve, reject);
    }, ms);
  });

describe('processPasswordResetRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles as accepted exactly at the response time when the mail is sent', async () => {
    const deps = createDeps();
    const state = start(deps);

    // reported as soon as the delivery finishes, not at the response time
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onMailSent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RESPOND_AT - 1);
    expect(state.outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(state.outcome).toBe('accepted');
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it('settles as accepted at the same time without sending mail for an unknown or inactive account', async () => {
    const deps = createDeps({
      isResettableAccount: vi.fn().mockResolvedValue(false),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(RESPOND_AT - 1);
    expect(state.outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(state.outcome).toBe('accepted');
    expect(deps.sendPasswordResetMail).not.toHaveBeenCalled();
    expect(deps.onMailSent).not.toHaveBeenCalled();
    expect(deps.onDeadlineExceeded).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it('reports a mail error immediately but settles as failed only at the response time', async () => {
    const error = new Error('smtp down');
    const deps = createDeps({
      sendPasswordResetMail: vi.fn(() =>
        delayed(1000, () => Promise.reject(error)),
      ),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.onError).toHaveBeenCalledWith(error);
    expect(state.outcome).toBeUndefined();

    await vi.advanceTimersByTimeAsync(RESPOND_AT - 1000);
    expect(state.outcome).toBe('failed');
    expect(deps.onMailSent).not.toHaveBeenCalled();
  });

  it('settles as failed at the response time when the account lookup fails', async () => {
    const error = new Error('db down');
    const deps = createDeps({
      isResettableAccount: vi.fn().mockRejectedValue(error),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onError).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(RESPOND_AT);
    expect(state.outcome).toBe('failed');
    expect(deps.sendPasswordResetMail).not.toHaveBeenCalled();
  });

  it('settles as failed at the response time when the delivery has not finished', async () => {
    const deps = createDeps({
      sendPasswordResetMail: vi.fn(() => new Promise<void>(() => {})),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(RESPOND_AT - 1);
    expect(deps.onDeadlineExceeded).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.onDeadlineExceeded).toHaveBeenCalledTimes(1);
    expect(state.outcome).toBe('failed');
  });

  it('records a delivery failure that occurs after the response time', async () => {
    const error = new Error('smtp timeout');
    const deps = createDeps({
      sendPasswordResetMail: vi.fn(() =>
        delayed(RESPOND_AT + 5000, () => Promise.reject(error)),
      ),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(RESPOND_AT);
    expect(state.outcome).toBe('failed');
    expect(deps.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(deps.onError).toHaveBeenCalledWith(error);
  });

  it('records nothing for a delivery that succeeds after the response time', async () => {
    const deps = createDeps({
      sendPasswordResetMail: vi.fn(() =>
        delayed(RESPOND_AT + 5000, () => undefined),
      ),
    });
    const state = start(deps);

    await vi.advanceTimersByTimeAsync(RESPOND_AT);
    expect(state.outcome).toBe('failed');

    await vi.advanceTimersByTimeAsync(5000);
    // the request was already answered as failed; a late success must not
    // emit the "mail sent" activity after the response
    expect(deps.onMailSent).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
  });
});
