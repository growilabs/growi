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
  const lastBrowserUrlRef = useRef<string>();

  // Sync pathname by Shallow Routing with performance optimization
  useEffect(() => {
    if (!isClient() || !props.currentPathname) return;

    const currentURL = decodeURI(window.location.pathname);

    // Skip if both props.currentPathname and browser URL haven't changed
    // This handles the case where:
    // 1. props.currentPathname is the same (e.g., /${pageId})
    // 2. But browser URL changed via navigation (e.g., /path/to/page)
    if (
      lastPathnameRef.current === props.currentPathname &&
      lastBrowserUrlRef.current === currentURL
    ) {
      return;
    }

    // Only update if URLs actually differ
    if (currentURL !== props.currentPathname) {
      const { search, hash } = window.location;
      router.replace(`${props.currentPathname}${search}${hash}`, undefined, {
        shallow: true,
      });
    }

    // Update references for next comparison
    lastPathnameRef.current = props.currentPathname;
    lastBrowserUrlRef.current = currentURL;
  }, [props.currentPathname, router]);
};
