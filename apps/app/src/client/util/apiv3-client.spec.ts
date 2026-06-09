import { describe, expect, it, vi } from 'vitest';

// Mock the axios adapter used by apiv3-client
const postMock = vi.fn();
vi.mock('~/utils/axios', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
    isAxiosError: (e: { isAxiosError?: boolean }) => e?.isAxiosError === true,
  },
}));

import { apiv3Post } from './apiv3-client';

// Mirror how callers consume the rejection: `catch (err) { toastError(err); }`.
// toastError shows nothing when handed an empty array, so the contract we verify
// here is that apiv3Post never rejects with an empty array (regression for #11281).
async function getThrownErrors(): Promise<unknown[]> {
  try {
    await apiv3Post('/forgot-password', { email: 'x@example.com' });
    return [];
  } catch (err) {
    return err as unknown[];
  }
}

describe('apiv3Post error handling', () => {
  it('surfaces a structured apiv3 error', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 400,
        data: { errors: [{ message: 'Mail send failed', status: 400 }] },
      },
    });

    const errs = await getThrownErrors();

    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ message: 'Mail send failed' });
  });

  it('does not swallow a network error (no response) — #11281', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Network Error',
      response: undefined,
    });

    const errs = await getThrownErrors();

    // Must be non-empty so the caller's toastError(err) actually shows something
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatchObject({ message: 'Network Error' });
  });

  it('does not swallow a non-apiv3 error response (e.g. 504/HTML) — #11281', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 504',
      response: { status: 504, data: '<html>Gateway Timeout</html>' },
    });

    const errs = await getThrownErrors();

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatchObject({
      message: 'Request failed with status code 504',
    });
  });
});
