import { atom, useAtom } from 'jotai';

import type { IPageSelectedGrant } from '~/interfaces/page';

/**
 * Atom for selected grant in page editor
 * Stores temporary grant selection before it's applied to the page
 */
const selectedGrantAtom = atom<IPageSelectedGrant | null>(null);

/**
 * Hook for managing selected grant in page editor
 * Used for temporary grant selection before applying to the page
 */
export const useSelectedGrant = () => useAtom(selectedGrantAtom);
