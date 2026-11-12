// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { mutate } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';

import type {
  ChangeProposalView,
  OperationStatus,
  OperationView,
  RevertResult,
} from '../../../interfaces';
import { refreshAfterRevert } from './proposal-actions';
import { useRevertProgress } from './use-revert-progress';
import { getChangeProposalDetailKey } from './use-swrx-change-proposal';

vi.mock('~/client/util/apiv3-client');
vi.mock('./proposal-actions', () => ({ refreshAfterRevert: vi.fn() }));

const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');
const mockedRefreshAfterRevert = vi.mocked(refreshAfterRevert);

type ApiResponse = Awaited<ReturnType<typeof apiv3Client.apiv3Get>>;

const buildResponse = (data: unknown): ApiResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: mock<ApiResponse['config']>(),
});

const NOT_FOUND = [{ message: 'not found', code: 'notfound' }];

const buildProposal = (
  id: string,
  operations: readonly OperationView[],
): ChangeProposalView => ({
  id,
  requester: { id: 'u1', username: 'alice', name: 'Alice' },
  entry: 'revert',
  createdAt: '2026-11-12T00:00:00.000Z',
  status: 'pending',
  isRequester: true,
  operations,
});

const originalOperation = (
  key: string,
  status: OperationStatus,
  reason?: OperationView['reason'],
): OperationView => ({
  key,
  type: 'edit',
  status,
  ...(reason != null ? { reason } : {}),
});

type ServerState = {
  revertStatuses: Record<string, OperationStatus>;
  // Statuses of a second revert proposal (a later revert from the same page).
  nextRevertStatuses: Record<string, OperationStatus>;
  revertFetch: 'found' | 'not-found' | 'network-error';
  firstRevertResponseDelayMs: number;
  original: 'found' | 'not-found';
  originalOperations: readonly OperationView[];
};

let sequence = 0;

const setup = (initial: Partial<ServerState> = {}) => {
  sequence += 1;
  const originalId = `original-${sequence}`;
  const revertId = `revert-${sequence}`;
  const nextRevertId = `revert-${sequence}-next`;
  const server: ServerState = {
    revertStatuses: {},
    nextRevertStatuses: {},
    revertFetch: 'found',
    firstRevertResponseDelayMs: 0,
    original: 'found',
    originalOperations: [],
    ...initial,
  };
  let isFirstRevertFetch = true;
  const pendingResult: RevertResult = {
    revertProposalId: revertId,
    operations: [],
  };

  const respondWithRevertProposal = (
    id: string,
    statuses: Record<string, OperationStatus>,
  ): ApiResponse => {
    if (server.revertFetch === 'network-error') {
      throw new Error('Network Error');
    }
    if (server.revertFetch === 'not-found') {
      throw NOT_FOUND;
    }
    const operations = Object.entries(statuses).map(
      ([key, status]): OperationView => ({
        key: `revert-${key}`,
        type: 'edit',
        status,
        revertTarget: { proposalId: originalId, operationKey: key },
      }),
    );
    return buildResponse({ proposal: buildProposal(id, operations) });
  };

  mockedApiv3Get.mockImplementation(async (path) => {
    if (path === getChangeProposalDetailKey(revertId)) {
      if (isFirstRevertFetch && server.firstRevertResponseDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, server.firstRevertResponseDelayMs),
        );
      }
      isFirstRevertFetch = false;
      return respondWithRevertProposal(revertId, server.revertStatuses);
    }
    if (path === getChangeProposalDetailKey(nextRevertId)) {
      return respondWithRevertProposal(nextRevertId, server.nextRevertStatuses);
    }
    if (path === getChangeProposalDetailKey(originalId)) {
      if (server.original === 'not-found') {
        throw NOT_FOUND;
      }
      return buildResponse({
        proposal: buildProposal(originalId, server.originalOperations),
      });
    }
    throw new Error(`unexpected path ${path}`);
  });

  const countGets = (id: string): number =>
    mockedApiv3Get.mock.calls.filter(
      ([path]) => path === getChangeProposalDetailKey(id),
    ).length;

  return {
    originalId,
    revertId,
    nextRevertId,
    // Stable per test: the hook treats each result reference as one revert.
    pendingResult,
    server,
    countPolls: (id: string = revertId) => countGets(id),
    countOriginalGets: () => countGets(originalId),
  };
};

const advance = async (ms: number): Promise<void> => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
};

describe('useRevertProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApiv3Get.mockReset();
    mockedRefreshAfterRevert.mockReset();
    // Mirrors the real refreshAfterRevert's effect on the original detail.
    mockedRefreshAfterRevert.mockImplementation(async (proposalId) => {
      await mutate(getChangeProposalDetailKey(proposalId));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never polls and refreshes once when the result already has every sent key', async () => {
    const { originalId, revertId, countPolls } = setup();
    const result: RevertResult = {
      revertProposalId: revertId,
      operations: [
        { key: 'a', outcome: 'reverted' },
        { key: 'b', outcome: 'skipped', reason: 'page-being-edited' },
      ],
    };

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a', 'b'],
        result,
        originalOperations: [],
      }),
    );
    await advance(0);

    expect(hook.current.entries).toEqual([
      { key: 'a', state: 'reverted' },
      { key: 'b', state: 'skipped', reason: 'page-being-edited' },
    ]);
    expect(hook.current.isSettled).toBe(true);
    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledWith(originalId);

    await advance(30_000);

    expect(countPolls()).toBe(0);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
  });

  it('never polls and refreshes once when core created no revert proposal', async () => {
    const { originalId, countPolls } = setup();
    const noRevertProposalResult: RevertResult = { operations: [] };

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: noRevertProposalResult,
        originalOperations: [],
      }),
    );
    await advance(30_000);

    expect(hook.current.entries).toEqual([{ key: 'a', state: 'not-targeted' }]);
    expect(hook.current.isSettled).toBe(true);
    expect(countPolls()).toBe(0);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
  });

  it('polls every 3 s while a sent key is pending and stops once it settles', async () => {
    const { originalId, revertId, server, countPolls } = setup({
      revertStatuses: { b: 'pending' },
    });
    const result: RevertResult = {
      revertProposalId: revertId,
      operations: [{ key: 'a', outcome: 'reverted' }],
    };

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a', 'b'],
        result,
        originalOperations: [],
      }),
    );
    await advance(0);

    expect(countPolls()).toBe(1);
    expect(hook.current.entries).toEqual([
      { key: 'a', state: 'reverted' },
      { key: 'b', state: 'in-progress' },
    ]);
    expect(hook.current.isSettled).toBe(false);

    await advance(2_999);
    expect(countPolls()).toBe(1);
    await advance(1);
    expect(countPolls()).toBe(2);
    expect(mockedRefreshAfterRevert).not.toHaveBeenCalled();

    server.revertStatuses = { b: 'applied' };
    await advance(3_000);

    expect(countPolls()).toBe(3);
    expect(hook.current.entries).toEqual([
      { key: 'a', state: 'reverted' },
      { key: 'b', state: 'reverted' },
    ]);
    expect(hook.current.isSettled).toBe(true);
    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledWith(originalId);

    await advance(30_000);

    expect(countPolls()).toBe(3);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
    expect(hook.current.entries).toEqual([
      { key: 'a', state: 'reverted' },
      { key: 'b', state: 'reverted' },
    ]);
  });

  it('stops polling 60 s after the first response and reports the timeout', async () => {
    const { originalId, pendingResult, countPolls } = setup({
      revertStatuses: { a: 'pending' },
    });

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [],
      }),
    );
    await advance(0);
    await advance(59_999);

    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).not.toHaveBeenCalled();
    expect(countPolls()).toBeGreaterThanOrEqual(20);

    await advance(1);

    expect(hook.current.isTimedOut).toBe(true);
    expect(hook.current.isSettled).toBe(false);
    expect(hook.current.entries).toEqual([{ key: 'a', state: 'in-progress' }]);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

    const pollsAtTimeout = countPolls();
    await advance(60_000);

    expect(countPolls()).toBe(pollsAtTimeout);
    expect(pollsAtTimeout).toBeLessThanOrEqual(21);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
  });

  it('stops polling when unmounted', async () => {
    const { originalId, pendingResult, countPolls } = setup({
      revertStatuses: { a: 'pending' },
    });

    const { unmount } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [],
      }),
    );
    await advance(0);
    expect(countPolls()).toBe(1);

    unmount();
    await advance(30_000);

    expect(countPolls()).toBe(1);
  });

  it.each<ServerState['revertFetch']>([
    'network-error',
    'not-found',
  ])('keeps a key in progress and keeps polling when a poll fails with %s', async (failure) => {
    const { originalId, pendingResult, server, countPolls } = setup({
      revertStatuses: { a: 'pending' },
    });

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [],
      }),
    );
    await advance(0);
    server.revertFetch = failure;
    await advance(6_000);

    expect(countPolls()).toBe(3);
    expect(hook.current.entries).toEqual([{ key: 'a', state: 'in-progress' }]);
    expect(hook.current.isSettled).toBe(false);
    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).not.toHaveBeenCalled();

    server.revertFetch = 'found';
    server.revertStatuses = { a: 'applied' };
    await advance(3_000);

    expect(hook.current.entries).toEqual([{ key: 'a', state: 'reverted' }]);
    expect(hook.current.isSettled).toBe(true);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
  });

  it('keeps a key in progress and keeps polling when the very first poll fails', async () => {
    const { originalId, pendingResult, countPolls } = setup({
      revertFetch: 'network-error',
    });

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [],
      }),
    );
    await advance(0);

    expect(countPolls()).toBe(1);
    expect(hook.current.entries).toEqual([{ key: 'a', state: 'in-progress' }]);
    expect(hook.current.isSettled).toBe(false);

    await advance(3_000);

    expect(countPolls()).toBe(2);
    expect(hook.current.entries).toEqual([{ key: 'a', state: 'in-progress' }]);
    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).not.toHaveBeenCalled();
  });

  it('takes the refusal reason from the original proposal refetched after the refresh', async () => {
    const { originalId, pendingResult, server, countOriginalGets } = setup({
      revertStatuses: { a: 'pending' },
    });

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [originalOperation('a', 'applied')],
      }),
    );
    await advance(0);

    server.revertStatuses = { a: 'failed' };
    server.originalOperations = [
      originalOperation('a', 'revert-refused', 'edited-after-apply'),
    ];
    await advance(3_000);
    await advance(0);

    expect(countOriginalGets()).toBeGreaterThanOrEqual(1);
    expect(hook.current.entries).toEqual([
      { key: 'a', state: 'revert-refused', reason: 'edited-after-apply' },
    ]);
    expect(hook.current.isSettled).toBe(true);
  });

  it('keeps the per-key entries when the original refetch right after settling returns not-found', async () => {
    const { originalId, pendingResult, server, countOriginalGets } = setup({
      revertStatuses: { a: 'pending', b: 'pending' },
    });
    const lastKnownOriginalOperations = [
      originalOperation('a', 'revert-refused', 'has-children'),
      originalOperation('b', 'applied'),
    ];

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a', 'b'],
        result: pendingResult,
        originalOperations: lastKnownOriginalOperations,
      }),
    );
    await advance(0);

    server.revertStatuses = { a: 'failed', b: 'applied' };
    server.original = 'not-found';
    await advance(3_000);
    const settledEntries = hook.current.entries;

    expect(settledEntries).toEqual([
      { key: 'a', state: 'revert-refused', reason: 'has-children' },
      { key: 'b', state: 'reverted' },
    ]);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

    await advance(0);
    await advance(30_000);

    expect(countOriginalGets()).toBeGreaterThanOrEqual(1);
    expect(hook.current.entries).toEqual(settledEntries);
    expect(hook.current.isSettled).toBe(true);
  });

  it('counts the 60 s window from the first response, not from mounting', async () => {
    const { originalId, pendingResult } = setup({
      revertStatuses: { a: 'pending' },
      firstRevertResponseDelayMs: 10_000,
    });

    const { result: hook } = renderHook(() =>
      useRevertProgress({
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: pendingResult,
        originalOperations: [],
      }),
    );
    await advance(0);
    await advance(10_000);
    await advance(0);

    await advance(59_999);
    expect(hook.current.isTimedOut).toBe(false);
    expect(mockedRefreshAfterRevert).not.toHaveBeenCalled();

    await advance(1);
    expect(hook.current.isTimedOut).toBe(true);
    expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
  });

  describe('a later revert result passed to the same mounted hook', () => {
    type Props = Parameters<typeof useRevertProgress>[0];

    it('restarts polling for the new revert proposal and refreshes again once it settles', async () => {
      const { originalId, revertId, nextRevertId, server, countPolls } = setup({
        revertStatuses: { a: 'skipped' },
        nextRevertStatuses: { a: 'pending' },
      });
      const first: Props = {
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: { revertProposalId: revertId, operations: [] },
        originalOperations: [],
      };

      const { result: hook, rerender } = renderHook(
        (props: Props) => useRevertProgress(props),
        { initialProps: first },
      );
      await advance(0);

      expect(hook.current.entries).toEqual([
        { key: 'a', state: 'skipped', reason: 'page-being-edited' },
      ]);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

      rerender({
        ...first,
        result: { revertProposalId: nextRevertId, operations: [] },
      });

      // Before the new proposal answers, the previous proposal must not decide the key.
      expect(hook.current.entries).toEqual([
        { key: 'a', state: 'in-progress' },
      ]);

      await advance(0);

      expect(countPolls(nextRevertId)).toBe(1);
      expect(hook.current.entries).toEqual([
        { key: 'a', state: 'in-progress' },
      ]);
      expect(hook.current.isSettled).toBe(false);
      expect(hook.current.isTimedOut).toBe(false);

      await advance(3_000);

      expect(countPolls(nextRevertId)).toBe(2);
      expect(hook.current.entries).toEqual([
        { key: 'a', state: 'in-progress' },
      ]);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

      server.nextRevertStatuses = { a: 'applied' };
      await advance(3_000);

      expect(hook.current.entries).toEqual([{ key: 'a', state: 'reverted' }]);
      expect(hook.current.isSettled).toBe(true);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(2);

      await advance(30_000);

      expect(countPolls(nextRevertId)).toBe(3);
      expect(countPolls()).toBe(1);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(2);
    });

    it('times out the new revert 60 s after its own first response', async () => {
      const { originalId, revertId, nextRevertId } = setup({
        revertStatuses: { a: 'pending' },
        nextRevertStatuses: { a: 'pending' },
      });
      const first: Props = {
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: { revertProposalId: revertId, operations: [] },
        originalOperations: [],
      };

      const { result: hook, rerender } = renderHook(
        (props: Props) => useRevertProgress(props),
        { initialProps: first },
      );
      await advance(0);
      await advance(60_000);
      expect(hook.current.isTimedOut).toBe(true);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

      rerender({
        ...first,
        result: { revertProposalId: nextRevertId, operations: [] },
      });
      await advance(0);

      expect(hook.current.isTimedOut).toBe(false);

      await advance(59_999);
      expect(hook.current.isTimedOut).toBe(false);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

      await advance(1);
      expect(hook.current.isTimedOut).toBe(true);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(2);
    });

    it('refreshes once per result when neither result has a revert proposal', async () => {
      const { originalId } = setup();
      const first: Props = {
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: { operations: [] },
        originalOperations: [],
      };

      const { rerender } = renderHook(
        (props: Props) => useRevertProgress(props),
        { initialProps: first },
      );
      await advance(0);
      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);

      rerender({ ...first, result: { operations: [] } });
      await advance(0);

      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(2);
    });

    it('does not refresh again when re-rendered with the same result', async () => {
      const { originalId } = setup();
      const first: Props = {
        originalProposalId: originalId,
        sentKeys: ['a'],
        result: { operations: [] },
        originalOperations: [],
      };

      const { rerender } = renderHook(
        (props: Props) => useRevertProgress(props),
        { initialProps: first },
      );
      await advance(0);
      rerender({ ...first, sentKeys: ['a'], originalOperations: [] });
      await advance(30_000);

      expect(mockedRefreshAfterRevert).toHaveBeenCalledTimes(1);
    });
  });
});
