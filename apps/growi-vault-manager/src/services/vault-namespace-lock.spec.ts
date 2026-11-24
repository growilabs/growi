import { afterEach, describe, expect, it } from 'vitest';

import { withNamespaceLock } from './vault-namespace-lock.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

// The lock is module-wide state; a gate left open by a failed assertion
// would stall every later test on the same namespace.
const openGates: Deferred[] = [];

function createDeferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const deferred = { promise, resolve: () => resolve() };
  openGates.push(deferred);
  return deferred;
}

afterEach(() => {
  for (const gate of openGates.splice(0)) {
    gate.resolve();
  }
});

/** Lets every already-settled promise continuation run. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe('withNamespaceLock', () => {
  it('runs tasks on the same namespace one at a time, in call order', async () => {
    const events: string[] = [];
    const gate = createDeferred();

    const first = withNamespaceLock(['ns-a'], async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = withNamespaceLock(['ns-a'], () => {
      events.push('second:start');
      return Promise.resolve();
    });

    await flush();
    expect(events).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not make a task on another namespace wait', async () => {
    const gate = createDeferred();
    const blocked = withNamespaceLock(['ns-a'], () => gate.promise);

    let otherRan = false;
    await withNamespaceLock(['ns-b'], () => {
      otherRan = true;
      return Promise.resolve();
    });

    expect(otherRan).toBe(true);
    gate.resolve();
    await blocked;
  });

  it('makes a multi-namespace task wait for every namespace it names', async () => {
    const gateA = createDeferred();
    const gateB = createDeferred();
    const holdA = withNamespaceLock(['ns-a'], () => gateA.promise);
    const holdB = withNamespaceLock(['ns-b'], () => gateB.promise);

    let ran = false;
    const both = withNamespaceLock(['ns-a', 'ns-b'], () => {
      ran = true;
      return Promise.resolve();
    });

    gateA.resolve();
    await holdA;
    await flush();
    expect(ran).toBe(false);

    gateB.resolve();
    await Promise.all([holdB, both]);
    expect(ran).toBe(true);
  });

  it('releases the namespace when the task fails and passes the error to the caller', async () => {
    const failing = withNamespaceLock(['ns-a'], () =>
      Promise.reject(new Error('boom')),
    );
    await expect(failing).rejects.toThrow('boom');

    const result = await withNamespaceLock(['ns-a'], () =>
      Promise.resolve('next'),
    );
    expect(result).toBe('next');
  });

  it('completes when the same namespace is named twice in one call', async () => {
    const result = await withNamespaceLock(['ns-a', 'ns-a'], () =>
      Promise.resolve('ok'),
    );
    expect(result).toBe('ok');
  });

  it('runs immediately when no namespace is named', async () => {
    const gate = createDeferred();
    const blocked = withNamespaceLock(['ns-a'], () => gate.promise);

    const result = await withNamespaceLock([], () => Promise.resolve('free'));

    expect(result).toBe('free');
    gate.resolve();
    await blocked;
  });
});
