/**
 * Unit tests for scenario modules: baseline, load, drain
 *
 * Uses a fake LoadDriver (all methods return Promise.resolve() and track call
 * counts) to verify:
 *  - runLoad calls each op with the correct count (Req 2.5 reproducibility)
 *  - runBaseline / runDrain call setTimeout with the correct duration
 *  - All exported op-count constants match the design-spec defaults
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadDriver } from '../load-driver';

// ---------------------------------------------------------------------------
// Fake LoadDriver factory
// ---------------------------------------------------------------------------

interface CallRecord {
  method: string;
  count: number;
}

function makeFakeDriver(): LoadDriver & { calls: CallRecord[] } {
  const calls: CallRecord[] = [];

  const makeOp =
    (method: string) =>
    (count: number): Promise<void> => {
      calls.push({ method, count });
      return Promise.resolve();
    };

  return {
    calls,
    initInstaller: async () => ({
      adminEmail: 'admin@test.local',
      adminPassword: 'password',
      cookie: 'session=fake',
    }),
    pageCreate: makeOp('pageCreate'),
    pageEdit: makeOp('pageEdit'),
    pageGet: makeOp('pageGet'),
    pageList: makeOp('pageList'),
    pageSearch: makeOp('pageSearch'),
    yjsSessionCleanClose: makeOp('yjsSessionCleanClose'),
    yjsSessionAbort: makeOp('yjsSessionAbort'),
  };
}

// ---------------------------------------------------------------------------
// load.ts
// ---------------------------------------------------------------------------

describe('load scenario', () => {
  it('exports default op counts that match the design spec', async () => {
    const {
      LOAD_PAGE_CREATE,
      LOAD_PAGE_EDIT,
      LOAD_PAGE_GET,
      LOAD_PAGE_LIST,
      LOAD_PAGE_SEARCH,
      LOAD_YJS_CLEAN_CLOSE,
      LOAD_YJS_ABORT,
    } = await import('./load');

    expect(LOAD_PAGE_CREATE).toBe(20);
    expect(LOAD_PAGE_EDIT).toBe(20);
    expect(LOAD_PAGE_GET).toBe(50);
    expect(LOAD_PAGE_LIST).toBe(10);
    expect(LOAD_PAGE_SEARCH).toBe(30);
    expect(LOAD_YJS_CLEAN_CLOSE).toBe(10);
    expect(LOAD_YJS_ABORT).toBe(10);
  });

  it('calls pageSearch with LOAD_PAGE_SEARCH (30) by default', async () => {
    const { runLoad, LOAD_PAGE_SEARCH } = await import('./load');
    const driver = makeFakeDriver();

    await runLoad(driver);

    const searchCall = driver.calls.find((c) => c.method === 'pageSearch');
    expect(searchCall).toBeDefined();
    expect(searchCall?.count).toBe(LOAD_PAGE_SEARCH);
  });

  it('calls pageGet with LOAD_PAGE_GET (50) by default', async () => {
    const { runLoad, LOAD_PAGE_GET } = await import('./load');
    const driver = makeFakeDriver();

    await runLoad(driver);

    const getCall = driver.calls.find((c) => c.method === 'pageGet');
    expect(getCall).toBeDefined();
    expect(getCall?.count).toBe(LOAD_PAGE_GET);
  });

  it('calls pageList with LOAD_PAGE_LIST (10) by default', async () => {
    const { runLoad, LOAD_PAGE_LIST } = await import('./load');
    const driver = makeFakeDriver();

    await runLoad(driver);

    const listCall = driver.calls.find((c) => c.method === 'pageList');
    expect(listCall).toBeDefined();
    expect(listCall?.count).toBe(LOAD_PAGE_LIST);
  });

  it('calls yjsSessionAbort with LOAD_YJS_ABORT (10) by default', async () => {
    const { runLoad, LOAD_YJS_ABORT } = await import('./load');
    const driver = makeFakeDriver();

    await runLoad(driver);

    const abortCall = driver.calls.find((c) => c.method === 'yjsSessionAbort');
    expect(abortCall).toBeDefined();
    expect(abortCall?.count).toBe(LOAD_YJS_ABORT);
  });

  it('calls all 7 operations in sequence', async () => {
    const { runLoad } = await import('./load');
    const driver = makeFakeDriver();

    await runLoad(driver);

    const methods = driver.calls.map((c) => c.method);
    expect(methods).toEqual([
      'pageCreate',
      'pageEdit',
      'pageGet',
      'pageList',
      'pageSearch',
      'yjsSessionCleanClose',
      'yjsSessionAbort',
    ]);
  });
});

// ---------------------------------------------------------------------------
// baseline.ts
// ---------------------------------------------------------------------------

describe('baseline scenario', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('exports BASELINE_IDLE_SECONDS defaulting to 300', async () => {
    const { BASELINE_IDLE_SECONDS } = await import('./baseline');
    expect(BASELINE_IDLE_SECONDS).toBe(300);
  });

  it('resolves after BASELINE_IDLE_SECONDS ms when timers are advanced', async () => {
    const { runBaseline, BASELINE_IDLE_SECONDS } = await import('./baseline');
    const driver = makeFakeDriver();

    const promise = runBaseline(driver);

    // Should still be pending before the timeout fires
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    // Advance to just before completion — still pending
    await vi.advanceTimersByTimeAsync(BASELINE_IDLE_SECONDS * 1000 - 1);
    expect(settled).toBe(false);

    // Advance past the timeout — resolves now
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// drain.ts
// ---------------------------------------------------------------------------

describe('drain scenario', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('exports DRAIN_IDLE_SECONDS defaulting to 300', async () => {
    const { DRAIN_IDLE_SECONDS } = await import('./drain');
    expect(DRAIN_IDLE_SECONDS).toBe(300);
  });

  it('resolves after DRAIN_IDLE_SECONDS ms when timers are advanced', async () => {
    const { runDrain, DRAIN_IDLE_SECONDS } = await import('./drain');
    const driver = makeFakeDriver();

    const promise = runDrain(driver);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(DRAIN_IDLE_SECONDS * 1000 - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });
});
