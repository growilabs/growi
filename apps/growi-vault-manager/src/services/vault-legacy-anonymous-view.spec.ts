import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeleteNamespace, mockDeleteAnonymous, mockLoggerError } =
  vi.hoisted(() => ({
    mockDeleteNamespace: vi.fn(),
    mockDeleteAnonymous: vi.fn(),
    mockLoggerError: vi.fn(),
  }));

vi.mock('./vault-repo-storage.js', () => ({
  deleteNamespace: mockDeleteNamespace,
}));

vi.mock('../models/vault-user-view.js', () => ({
  VaultUserViewModel: {
    deleteAnonymous: mockDeleteAnonymous,
  },
}));

vi.mock('@growi/logger', () => ({
  loggerFactory: () => ({
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { removeLegacyAnonymousView } from './vault-legacy-anonymous-view.js';

describe('removeLegacyAnonymousView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteNamespace.mockResolvedValue(undefined);
    mockDeleteAnonymous.mockResolvedValue(undefined);
  });

  it('removes the anonymous-view namespace and its record without logging an error', async () => {
    await expect(removeLegacyAnonymousView()).resolves.toBeUndefined();

    expect(mockDeleteNamespace).toHaveBeenCalledWith('anonymous-view');
    expect(mockDeleteAnonymous).toHaveBeenCalledOnce();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('resolves and logs at error level when removing the namespace fails', async () => {
    const failure = new Error('git update-ref failed');
    mockDeleteNamespace.mockRejectedValue(failure);

    await expect(removeLegacyAnonymousView()).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });

  it('resolves and logs at error level when removing the record fails', async () => {
    const failure = new Error('mongo unavailable');
    mockDeleteAnonymous.mockRejectedValue(failure);

    await expect(removeLegacyAnonymousView()).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });
});
