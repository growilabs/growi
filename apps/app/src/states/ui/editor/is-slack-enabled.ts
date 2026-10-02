import { atom, useAtom } from 'jotai';

/**
 * Atom for managing Slack notification enabled state
 */
const isSlackEnabledAtom = atom<boolean>(false);

/**
 * Hook for Slack enabled state
 */
export const useIsSlackEnabled = () => useAtom(isSlackEnabledAtom);
