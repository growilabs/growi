/** Resolves once the watcher has started reading fd 4. */
export const startParentWatch = (): Promise<void> =>
  Promise.reject(
    new Error('not implemented: child/parent-watch.startParentWatch'),
  );
