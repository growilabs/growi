/**
 * Per-namespace lock that every writer of a namespace ref holds for its whole
 * read-build-write sequence (see the squash / instruction serialization notes
 * in .kiro/specs/growi-vault-manager/tasks.md).
 *
 * Not reentrant: a task must not acquire it again for a namespace it holds.
 */

/** Settles when the most recently queued task on the namespace finishes. */
const tails = new Map<string, Promise<void>>();

export async function withNamespaceLock<T>(
  namespaces: readonly string[],
  task: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(namespaces)];

  // Every key is registered in this synchronous block, so a task only ever
  // waits for tasks queued before it: the order is FIFO and cannot deadlock.
  const predecessors = keys.map((key) => tails.get(key));
  let release: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const key of keys) {
    tails.set(key, done);
  }

  try {
    await Promise.all(predecessors);
    return await task();
  } finally {
    release();
    for (const key of keys) {
      if (tails.get(key) === done) {
        tails.delete(key);
      }
    }
  }
}
