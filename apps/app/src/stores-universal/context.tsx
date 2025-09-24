import type EventEmitter from 'node:events';
import type { ColorScheme, IUserHasId } from '@growi/core';
import { AcceptedUploadFileType } from '@growi/core';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

import type { SupportedActionType } from '~/interfaces/activity';
import type { RendererConfig } from '~/interfaces/services/renderer';

import { useContextSWR } from './use-context-swr';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}

type Nullable<T> = T | null;

export const useCsrfToken = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR<string, Error>('csrfToken', initialData);
};

export const useAppTitle = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('appTitle', initialData);
};

export const useSiteUrl = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR<string, Error>('siteUrl', initialData);
};

export const useConfidential = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('confidential', initialData);
};

export const useCurrentUser = (
  initialData?: Nullable<IUserHasId>,
): SWRResponse<Nullable<IUserHasId>, Error> => {
  return useContextSWR('currentUser', initialData);
};

export const useCurrentPathname = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('currentPathname', initialData);
};

export const useIsIdenticalPath = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isIdenticalPath', initialData, {
    fallbackData: false,
  });
};

export const useIsForbidden = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isForbidden', initialData, {
    fallbackData: false,
  });
};

export const useIsNotCreatable = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isNotCreatable', initialData, {
    fallbackData: false,
  });
};

export const useIsSharedUser = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isSharedUser', initialData);
};

export const useShareLinkId = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('shareLinkId', initialData);
};

export const useDisableLinkSharing = (
  initialData?: Nullable<boolean>,
): SWRResponse<Nullable<boolean>, Error> => {
  return useContextSWR<Nullable<boolean>, Error>(
    'disableLinkSharing',
    initialData,
  );
};

export const useRegistrationWhitelist = (
  initialData?: Nullable<string[]>,
): SWRResponse<Nullable<string[]>, Error> => {
  return useContextSWR<Nullable<string[]>, Error>(
    'registrationWhitelist',
    initialData,
  );
};

export const useIsSearchPage = (
  initialData?: Nullable<boolean>,
): SWRResponse<Nullable<boolean>, Error> => {
  return useContextSWR<Nullable<any>, Error>('isSearchPage', initialData);
};

export const useIsAclEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isAclEnabled', initialData);
};

export const useIsSearchServiceConfigured = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>(
    'isSearchServiceConfigured',
    initialData,
  );
};

export const useIsSearchServiceReachable = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isSearchServiceReachable', initialData);
};

export const useElasticsearchMaxBodyLengthToIndex = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR('elasticsearchMaxBodyLengthToIndex', initialData);
};

export const useIsMailerSetup = (
  initialData?: boolean,
): SWRResponse<boolean, any> => {
  return useContextSWR('isMailerSetup', initialData);
};

export const useIsSearchScopeChildrenAsDefault = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>(
    'isSearchScopeChildrenAsDefault',
    initialData,
    { fallbackData: false },
  );
};

export const useShowPageSideAuthors = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('showPageSideAuthors', initialData, {
    fallbackData: false,
  });
};

export const useIsEnabledMarp = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isEnabledMarp', initialData, {
    fallbackData: false,
  });
};

export const useIsSlackConfigured = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isSlackConfigured', initialData);
};

export const useIsEnabledAttachTitleHeader = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>(
    'isEnabledAttachTitleHeader',
    initialData,
  );
};

export const useIsIndentSizeForced = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('isIndentSizeForced', initialData, {
    fallbackData: false,
  });
};

export const useDefaultIndentSize = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR<number, Error>('defaultIndentSize', initialData, {
    fallbackData: 4,
  });
};

export const useAuditLogEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR<boolean, Error>('auditLogEnabled', initialData, {
    fallbackData: false,
  });
};

export const useActivityExpirationSeconds = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR<number, Error>('activityExpirationSeconds', initialData);
};

export const useAuditLogAvailableActions = (
  initialData?: Array<SupportedActionType>,
): SWRResponse<Array<SupportedActionType>, Error> => {
  return useContextSWR<Array<SupportedActionType>, Error>(
    'auditLogAvailableActions',
    initialData,
  );
};

export const useGrowiVersion = (
  initialData?: string,
): SWRResponse<string, any> => {
  return useContextSWR('growiVersion', initialData);
};

export const useIsEnabledStaleNotification = (
  initialData?: boolean,
): SWRResponse<boolean, any> => {
  return useContextSWR('isEnabledStaleNotification', initialData);
};

export const useRendererConfig = (
  initialData?: RendererConfig,
): SWRResponse<RendererConfig, any> => {
  return useContextSWR('growiRendererConfig', initialData);
};

export const useIsAllReplyShown = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isAllReplyShown', initialData);
};

export const useIsBlinkedHeaderAtBoot = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isBlinkedAtBoot', initialData, { fallbackData: false });
};

export const useIsUploadEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isUploadEnabled', initialData);
};

export const useIsUploadAllFileAllowed = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isUploadAllFileAllowed', initialData);
};

export const useIsBulkExportPagesEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isBulkExportPagesEnabled', initialData);
};

export const useIsPdfBulkExportEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isPdfBulkExportEnabled', initialData);
};

export const useShowPageLimitationL = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR('showPageLimitationL', initialData);
};

export const useShowPageLimitationXL = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR('showPageLimitationXL', initialData);
};

export const useCustomizeTitle = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('CustomizeTitle', initialData);
};

export const useIsDefaultLogo = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isDefaultLogo', initialData);
};

export const useIsCustomizedLogoUploaded = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useSWRStatic('isCustomizedLogoUploaded', initialData);
};

export const useForcedColorScheme = (
  initialData?: ColorScheme,
): SWRResponse<ColorScheme, Error> => {
  return useContextSWR('forcedColorScheme', initialData);
};

export const useGrowiCloudUri = (
  initialData?: string,
): SWRResponse<string, Error> => {
  return useContextSWR('growiCloudUri', initialData);
};

export const useGrowiAppIdForGrowiCloud = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR('growiAppIdForGrowiCloud', initialData);
};

export const useIsContainerFluid = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isContainerFluid', initialData);
};

export const useIsLocalAccountRegistrationEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isLocalAccountRegistrationEnabled', initialData);
};

export const useIsRomUserAllowedToComment = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isRomUserAllowedToComment', initialData);
};

export const useIsAiEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useContextSWR('isAiEnabled', initialData);
};

export const useLimitLearnablePageCountPerAssistant = (
  initialData?: number,
): SWRResponse<number, Error> => {
  return useContextSWR('limitLearnablePageCountPerAssistant', initialData);
};

export const useIsUsersHomepageDeletionEnabled = (
  initialData?: boolean,
): SWRResponse<boolean, false> => {
  return useContextSWR('isUsersHomepageDeletionEnabled', initialData);
};

export const useIsEnableUnifiedMergeView = (
  initialData?: boolean,
): SWRResponse<boolean, Error> => {
  return useSWRStatic<boolean, Error>('isEnableUnifiedMergeView', initialData, {
    fallbackData: false,
  });
};

/** **********************************************************
 *                     Computed contexts
 *********************************************************** */

export const useIsGuestUser = (): SWRResponse<boolean, Error> => {
  const { data: currentUser, isLoading } = useCurrentUser();

  return useSWRImmutable(
    isLoading ? null : ['isGuestUser', currentUser?._id],
    ([, currentUserId]) => currentUserId == null,
    { fallbackData: currentUser?._id == null },
  );
};

export const useIsReadOnlyUser = (): SWRResponse<boolean, Error> => {
  const { data: currentUser, isLoading: isCurrentUserLoading } =
    useCurrentUser();
  const { data: isGuestUser, isLoading: isGuestUserLoding } = useIsGuestUser();

  const isLoading = isCurrentUserLoading || isGuestUserLoding;
  const isReadOnlyUser = !isGuestUser && !!currentUser?.readOnly;

  return useSWRImmutable(
    isLoading ? null : ['isReadOnlyUser', isReadOnlyUser, currentUser?._id],
    () => isReadOnlyUser,
    { fallbackData: isReadOnlyUser },
  );
};

export const useIsAdmin = (): SWRResponse<boolean, Error> => {
  const { data: currentUser, isLoading } = useCurrentUser();

  return useSWR(
    isLoading ? null : ['isAdminUser', currentUser?._id, currentUser?.admin],
    ([, , isAdmin]) => isAdmin ?? false,
    {
      fallbackData: currentUser?.admin ?? false,
      keepPreviousData: true,
      // disable all revalidation but revalidateIfStale
      revalidateOnMount: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const useIsEditable = (): SWRResponse<boolean, Error> => {
  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: isForbidden } = useIsForbidden();
  const { data: isNotCreatable } = useIsNotCreatable();
  const { data: isIdenticalPath } = useIsIdenticalPath();

  return useSWRImmutable(
    [
      'isEditable',
      isGuestUser,
      isReadOnlyUser,
      isForbidden,
      isNotCreatable,
      isIdenticalPath,
    ],
    ([
      ,
      isGuestUser,
      isReadOnlyUser,
      isForbidden,
      isNotCreatable,
      isIdenticalPath,
    ]) => {
      return (
        !isForbidden &&
        !isIdenticalPath &&
        !isNotCreatable &&
        !isGuestUser &&
        !isReadOnlyUser
      );
    },
  );
};

export const useAcceptedUploadFileType = (): SWRResponse<
  AcceptedUploadFileType,
  Error
> => {
  const { data: isUploadEnabled } = useIsUploadEnabled();
  const { data: isUploadAllFileAllowed } = useIsUploadAllFileAllowed();

  return useSWRImmutable(
    ['acceptedUploadFileType', isUploadEnabled, isUploadAllFileAllowed],
    ([, isUploadEnabled, isUploadAllFileAllowed]) => {
      if (!isUploadEnabled) {
        return AcceptedUploadFileType.NONE;
      }
      if (isUploadAllFileAllowed) {
        return AcceptedUploadFileType.ALL;
      }
      return AcceptedUploadFileType.IMAGE;
    },
  );
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useGrowiDocumentationUrl = () => {
  const { data: growiCloudUri } = useGrowiCloudUri();

  return useSWR(
    ['documentationUrl', growiCloudUri],
    ([, growiCloudUri]) => {
      const url =
        growiCloudUri != null
          ? new URL('/help', growiCloudUri)
          : new URL('https://docs.growi.org');
      return url.toString();
    },
    {
      fallbackData: 'https://docs.growi.org',
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
