/**
 * Per-namespace write lock shared by every writer of a namespace ref.
 *
 * A namespace ref is advanced by reading the current commit, building a new
 * commit on top of it and overwriting the ref, with no compare-and-swap. Two
 * writers interleaving on the same namespace therefore silently discard one
 * another's commit, so instruction application and squash must both run
 * their whole read-build-write sequence inside this lock. Namespaces that a
 * task does not name are never blocked (requirement 6.6).
 *
 * The lock is not reentrant: a task must not acquire it again for a
 * namespace it already holds.
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
