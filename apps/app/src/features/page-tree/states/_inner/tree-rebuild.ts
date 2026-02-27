import { atom, useAtomValue, useSetAtom } from 'jotai';

/**
 * Atom to track when the tree needs to be rebuilt.
 * Incrementing this value will trigger a re-render in components that subscribe to it.
 *
 * This is useful for triggering tree rebuilds after operations that change the tree structure,
 * such as:
 * - Creating a new page (placeholder node added)
 * - Renaming a page
 * - Expanding/collapsing items with async data loading
 */
const treeRebuildTriggerAtom = atom(0);

/**
 * Hook to get the current rebuild trigger value.
 * Components using this hook will re-render when the trigger changes.
 */
export const useTreeRebuildTrigger = (): number => {
  return useAtomValue(treeRebuildTriggerAtom);
};

/**
 * Hook to get a function that triggers a tree rebuild.
 * The returned function is stable and can be passed to callbacks without causing re-renders.
 */
export const useTriggerTreeRebuild = (): (() => void) => {
  const setTrigger = useSetAtom(treeRebuildTriggerAtom);
  // Note: useSetAtom returns a stable function reference
  return () => setTrigger((prev) => prev + 1);
};
