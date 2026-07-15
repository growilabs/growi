import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { atom, useAtomValue, useSetAtom } from 'jotai';

/**
 * Atom for managing search keyword state
 */
const searchKeywordAtom = atom<string>('');

/**
 * Hook to get the current search keyword
 * @returns The current search keyword
 */
export const useSearchKeyword = () => useAtomValue(searchKeywordAtom);

/**
 * Hook to manage search keyword with URL synchronization
 * This hook should be called once at the top level (e.g., in SearchPageBase)
 * It handles URL parsing, browser back/forward navigation, and synchronization
 */
export const useKeywordManager = (): void => {
  const router = useRouter();
  const routerRef = useRef(router);
  const setKeyword = useSetAtom(searchKeywordAtom);

  // Parse URL Query
  const queries = router.query.q;
  const initialKeyword =
    (Array.isArray(queries) ? queries.join(' ') : queries) ?? '';

  // Detect search keyword from the query of URL
  useEffect(() => {
    setKeyword(initialKeyword);
  }, [setKeyword, initialKeyword]);

  // Browser back and forward
  useEffect(() => {
    routerRef.current.beforePopState(({ url }) => {
      const newUrl = new URL(url, 'https://exmple.com');
      const newKeyword = newUrl.searchParams.get('q');
      if (newKeyword != null) {
        setKeyword(newKeyword);
      }
      return true;
    });

    return () => {
      routerRef.current.beforePopState(() => true);
    };
  }, [setKeyword]);
};

type SetSearchKeywordOptions = {
  // router.replace instead of push — for updates that should not add a history
  // entry, e.g. live filter/sort tweaks that would otherwise flood back/forward.
  replace?: boolean;
};

type SetSearchKeyword = (
  newKeyword: string,
  options?: SetSearchKeywordOptions,
) => void;

/**
 * Hook to set the search keyword and update the URL
 * @returns A function to update the search keyword and navigate the router
 */
export const useSetSearchKeyword = (
  pathname = '/_search',
): SetSearchKeyword => {
  const router = useRouter();
  const routerRef = useRef(router);
  const setKeyword = useSetAtom(searchKeywordAtom);

  return useCallback(
    (newKeyword: string, options?: SetSearchKeywordOptions) => {
      setKeyword((prevKeyword) => {
        const isOnSearchPage = routerRef.current.pathname === pathname;
        // Navigate if keyword changed OR if not currently on search page
        if (prevKeyword !== newKeyword || !isOnSearchPage) {
          const newUrl = new URL(pathname, 'http://example.com');
          newUrl.searchParams.append('q', newKeyword);
          const href = `${newUrl.pathname}${newUrl.search}`;
          if (options?.replace) {
            routerRef.current.replace(href, '');
          } else {
            routerRef.current.push(href, '');
          }
        }

        return newKeyword;
      });
    },
    [setKeyword, pathname],
  );
};
