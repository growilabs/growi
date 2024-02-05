import { useCallback, useState } from 'react';

import type { PageGrant, IGrantedGroup } from '@growi/core';
import { useRouter } from 'next/router';

import { createPage, exist } from '~/client/services/page-operation';
import { toastError } from '~/client/util/toastr';
import { useSWRxNearestParentGrant } from '~/stores/page';

export const useOnNewButtonClicked = (
    currentPagePath?: string,
    currentPageGrant?: PageGrant,
    currentPageGrantedGroups?: IGrantedGroup[],
    isLoading?: boolean,
): {
  onClickHandler: () => Promise<void>,
  isPageCreating: boolean
} => {
  const router = useRouter();
  const [isPageCreating, setIsPageCreating] = useState(false);

  const onClickHandler = useCallback(async() => {
    if (isLoading) return;

    try {
      setIsPageCreating(true);

      /**
       * !! NOTICE !! - Verification of page createable or not is checked on the server side.
       * since the new page path is not generated on the client side.
       * need shouldGeneratePath flag.
       */
      const shouldUseRootPath = currentPagePath == null || currentPageGrant == null;
      const parentPath = shouldUseRootPath
        ? '/'
        : currentPagePath;

      const params = {
        isSlackEnabled: false,
        slackChannels: '',
        grant: shouldUseRootPath ? 1 : currentPageGrant,
        grantUserGroupIds: shouldUseRootPath ? undefined : currentPageGrantedGroups,
        shouldGeneratePath: true,
      };

      // !! NOTICE !! - if shouldGeneratePath is flagged, send the parent page path
      const response = await createPage(parentPath, '', params);

      router.push(`/${response.page.id}#edit`);
    }
    catch (err) {
      toastError(err);
    }
    finally {
      setIsPageCreating(false);
    }
  }, [currentPageGrant, currentPageGrantedGroups, currentPagePath, isLoading, router]);

  return { onClickHandler, isPageCreating };
};

export const useOnTodaysButtonClicked = (
    todaysPath: string | null,
): {
  onClickHandler: () => Promise<void>,
  isPageCreating: boolean
} => {
  const router = useRouter();
  const [isPageCreating, setIsPageCreating] = useState(false);
  const { data: parentGrantData } = useSWRxNearestParentGrant(todaysPath ?? '/');

  const onClickHandler = useCallback(async() => {
    if (todaysPath == null) {
      return;
    }

    try {
      setIsPageCreating(true);

      const params = {
        isSlackEnabled: false,
        slackChannels: '',
        grant: parentGrantData?.grant ?? 1,
        grantUserGroupId: parentGrantData?.grantedGroups ?? undefined,
      };

      const res = await exist(JSON.stringify([todaysPath]));
      if (!res.pages[todaysPath]) {
        await createPage(todaysPath, '', params);
      }

      router.push(`${todaysPath}#edit`);
    }
    catch (err) {
      toastError(err);
    }
    finally {
      setIsPageCreating(false);
    }
  }, [parentGrantData?.grant, parentGrantData?.grantedGroups, router, todaysPath]);

  return { onClickHandler, isPageCreating };
};
