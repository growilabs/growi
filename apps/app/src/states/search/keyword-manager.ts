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

type SetSearchKeyword = (newKeyword: string) => void;

/**
 * Hook to set the search keyword and update the URL
 * @returns A function to update the search keyword and push to router history
 */
export const useSetSearchKeyword = (
  pathname = '/_search',
): SetSearchKeyword => {
  const router = useRouter();
  const routerRef = useRef(router);
  const setKeyword = useSetAtom(searchKeywordAtom);

  return useCallback(
    (newKeyword: string) => {
      setKeyword((prevKeyword) => {
        if (prevKeyword !== newKeyword) {
          const newUrl = new URL(pathname, 'http://example.com');
          newUrl.searchParams.append('q', newKeyword);
          routerRef.current.push(`${newUrl.pathname}${newUrl.search}`, '');
        }

        return newKeyword;
      });
    },
    [setKeyword, pathname],
  );
};
