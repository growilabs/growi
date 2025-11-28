import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { isClient } from '@growi/core/dist/utils';

import type { CommonEachProps } from '../common-props';

/**
 * Custom hook for syncing pathname by Shallow Routing
 * Optimized to minimize unnecessary router operations and re-renders
 */
export const useShallowRouting = (props: CommonEachProps): void => {
  const router = useRouter();
  const lastPathnameRef = useRef<string>();

  // Sync pathname by Shallow Routing with performance optimization
  useEffect(() => {
    if (!isClient() || !props.currentPathname) return;

    // Skip if pathname hasn't changed (prevents unnecessary operations)
    if (lastPathnameRef.current === props.currentPathname) return;

    const currentURL = decodeURI(window.location.pathname);

    // Only update if URLs actually differ
    if (currentURL !== props.currentPathname) {
      const { search, hash } = window.location;
      router.replace(`${props.currentPathname}${search}${hash}`, undefined, {
        shallow: true,
      });
    }

    // Update reference for next comparison
    lastPathnameRef.current = props.currentPathname;
  }, [props.currentPathname, router]);
};
