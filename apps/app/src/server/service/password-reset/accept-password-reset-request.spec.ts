import {
  type AcceptPasswordResetRequestDeps,
  acceptPasswordResetRequest,
} from './accept-password-reset-request';

const createDeps = (
  overrides: Partial<AcceptPasswordResetRequestDeps> = {},
): AcceptPasswordResetRequestDeps => ({
  isResettableAccount: vi.fn().mockResolvedValue(true),
  sendPasswordResetMail: vi.fn().mockResolvedValue(undefined),
  onMailSent: vi.fn(),
  onMailFailed: vi.fn(),
  ...overrides,
});

describe('acceptPasswordResetRequest', () => {
  it('settles before the mail delivery finishes for a resettable account', async () => {
    let finishDelivery: () => void = () => {};
    const deps = createDeps({
      sendPasswordResetMail: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishDelivery = resolve;
          }),
      ),
    });

    await acceptPasswordResetRequest('user@example.com', deps);

    expect(deps.sendPasswordResetMail).toHaveBeenCalledWith('user@example.com');
    expect(deps.onMailSent).not.toHaveBeenCalled();

    finishDelivery();
    await vi.waitFor(() => expect(deps.onMailSent).toHaveBeenCalledTimes(1));
    expect(deps.onMailFailed).not.toHaveBeenCalled();
  });

  it('does not send any mail for an unknown or inactive account', async () => {
    const deps = createDeps({
      isResettableAccount: vi.fn().mockResolvedValue(false),
    });

    await acceptPasswordResetRequest('nobody@example.com', deps);

    expect(deps.sendPasswordResetMail).not.toHaveBeenCalled();
  });

  it('settles normally and reports the error when the mail delivery fails', async () => {
    const error = new Error('smtp down');
    const deps = createDeps({
      sendPasswordResetMail: vi.fn().mockRejectedValue(error),
    });

    await expect(
      acceptPasswordResetRequest('user@example.com', deps),
    ).resolves.toBeUndefined();

    await vi.waitFor(() =>
      expect(deps.onMailFailed).toHaveBeenCalledWith(error),
    );
    expect(deps.onMailSent).not.toHaveBeenCalled();
  });

  it('propagates a failure of the account lookup to the caller', async () => {
    const deps = createDeps({
      isResettableAccount: vi.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      acceptPasswordResetRequest('user@example.com', deps),
    ).rejects.toThrow('db down');
    expect(deps.sendPasswordResetMail).not.toHaveBeenCalled();
  });
});
