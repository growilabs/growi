import { useEffect } from 'react';

import { isClient } from '@growi/core/dist/utils';
import { Breakpoint } from '@growi/ui/dist/interfaces';
import { addBreakpointListener, cleanupBreakpointListener } from '@growi/ui/dist/utils';
import { atom, useAtom } from 'jotai';

import type { UseAtom } from '../helper';


// Device state atoms
export const isDeviceLargerThanXlAtom = atom(false);

export const useDeviceLargerThanXl = (): UseAtom<typeof isDeviceLargerThanXlAtom> => {
  const [isLargerThanXl, setIsLargerThanXl] = useAtom(isDeviceLargerThanXlAtom);

  useEffect(() => {
    if (isClient()) {
      const xlOrAboveHandler = function(this: MediaQueryList): void {
        // lg -> xl: matches will be true
        // xl -> lg: matches will be false
        setIsLargerThanXl(this.matches);
      };
      const mql = addBreakpointListener(Breakpoint.XL, xlOrAboveHandler);

      // initialize
      setIsLargerThanXl(mql.matches);

      return () => {
        cleanupBreakpointListener(mql, xlOrAboveHandler);
      };
    }
    return undefined;
  }, [setIsLargerThanXl]);

  return [isLargerThanXl, setIsLargerThanXl] as const;
};
