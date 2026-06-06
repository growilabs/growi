import { PageGrant } from '@growi/core/dist/interfaces';
import { atom, useAtom } from 'jotai';

import type { IPageSelectedGrant } from '~/interfaces/page';

/**
 * Atom for selected grant in page editor
 * Stores temporary grant selection before it's applied to the page
 */
const selectedGrantAtom = atom<IPageSelectedGrant | null>({
  grant: PageGrant.GRANT_PUBLIC,
});

/**
 * Hook for managing selected grant in page editor
 * Used for temporary grant selection before applying to the page
 */
export const useSelectedGrant = () => useAtom(selectedGrantAtom);
