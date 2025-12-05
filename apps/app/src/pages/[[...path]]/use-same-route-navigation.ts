import { useEffect } from 'react';
import { useRouter } from 'next/router';

import { useFetchCurrentPage, useIsIdenticalPath } from '~/states/page';
import { useSetEditingMarkdown } from '~/states/ui/editor';

/**
 * This hook is a trigger to fetch page data on client-side navigation.
 * It detects changes in `router.asPath` and calls `fetchCurrentPage`.
 * The responsibility for determining whether to actually fetch data
 * is delegated to `useFetchCurrentPage`.
 */
export const useSameRouteNavigation = (): void => {
  const router = useRouter();

  const isIdenticalPath = useIsIdenticalPath();
  const { fetchCurrentPage } = useFetchCurrentPage();
  const setEditingMarkdown = useSetEditingMarkdown();

  // useEffect to trigger data fetching when the path changes
  useEffect(() => {
    // If the path is identical, do not fetch
    if (isIdenticalPath) return;

    const fetch = async () => {
      const pageData = await fetchCurrentPage({ path: router.asPath });
      if (pageData?.revision?.body != null) {
        setEditingMarkdown(pageData.revision.body);
      }
    };
    fetch();
  }, [router.asPath, isIdenticalPath, fetchCurrentPage, setEditingMarkdown]);
};
