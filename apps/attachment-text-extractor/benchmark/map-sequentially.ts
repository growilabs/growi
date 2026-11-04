/** Runs `run` on each item, one after another, keeping the order. */
export const mapSequentially = <T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> =>
  items.reduce<Promise<R[]>>(
    async (done, item) => [...(await done), await run(item)],
    Promise.resolve([]),
  );
