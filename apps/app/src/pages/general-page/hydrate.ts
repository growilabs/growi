import { useHydrateAtoms } from 'jotai/utils';

import type { RendererConfig } from '~/interfaces/services/renderer';
import {
  aiEnabledAtom,
  defaultIndentSizeAtom,
  disableLinkSharingAtom,
  disableUserPagesAtom,
  drawioUriAtom,
  elasticsearchMaxBodyLengthToIndexAtom,
  isAclEnabledAtom,
  isAllReplyShownAtom,
  isBulkExportPagesEnabledAtom,
  isContainerFluidAtom,
  isEnabledAttachTitleHeaderAtom,
  isEnabledStaleNotificationAtom,
  isIndentSizeForcedAtom,
  isLocalAccountRegistrationEnabledAtom,
  isPdfBulkExportEnabledAtom,
  isRomUserAllowedToCommentAtom,
  isSlackConfiguredAtom,
  isUploadAllFileAllowedAtom,
  isUploadEnabledAtom,
  isUsersHomepageDeletionEnabledAtom,
  limitLearnablePageCountPerAssistantAtom,
  rendererConfigAtom,
  showPageSideAuthorsAtom,
} from '~/states/server-configurations';
import { createAtomTuple } from '~/utils/jotai-utils';

import type { ServerConfigurationProps } from './types';

/**
 * Hook for hydrating server configuration atoms with server-side data
 * This should be called early in the app component to ensure atoms are properly initialized before rendering
 */
export const useHydrateGeneralPageConfigurationAtoms = (
  serverConfig: ServerConfigurationProps['serverConfig'] | undefined,
  rendererConfigs: RendererConfig | undefined,
): void => {
  const tuples =
    serverConfig == null || rendererConfigs == null
      ? []
      : [
          createAtomTuple(aiEnabledAtom, serverConfig.aiEnabled),
          createAtomTuple(
            limitLearnablePageCountPerAssistantAtom,
            serverConfig.limitLearnablePageCountPerAssistant,
          ),
          createAtomTuple(
            isUsersHomepageDeletionEnabledAtom,
            serverConfig.isUsersHomepageDeletionEnabled,
          ),
          createAtomTuple(
            defaultIndentSizeAtom,
            serverConfig.adminPreferredIndentSize,
          ),
          createAtomTuple(
            elasticsearchMaxBodyLengthToIndexAtom,
            serverConfig.elasticsearchMaxBodyLengthToIndex,
          ),
          createAtomTuple(
            isRomUserAllowedToCommentAtom,
            serverConfig.isRomUserAllowedToComment,
          ),
          createAtomTuple(drawioUriAtom, serverConfig.drawioUri),
          createAtomTuple(isAllReplyShownAtom, serverConfig.isAllReplyShown),
          createAtomTuple(
            showPageSideAuthorsAtom,
            serverConfig.showPageSideAuthors,
          ),
          createAtomTuple(isContainerFluidAtom, serverConfig.isContainerFluid),
          createAtomTuple(
            isEnabledStaleNotificationAtom,
            serverConfig.isEnabledStaleNotification,
          ),
          createAtomTuple(
            disableLinkSharingAtom,
            serverConfig.disableLinkSharing,
          ),
          createAtomTuple(
            isIndentSizeForcedAtom,
            serverConfig.isIndentSizeForced,
          ),
          createAtomTuple(
            isEnabledAttachTitleHeaderAtom,
            serverConfig.isEnabledAttachTitleHeader,
          ),
          createAtomTuple(
            isSlackConfiguredAtom,
            serverConfig.isSlackConfigured,
          ),
          createAtomTuple(isAclEnabledAtom, serverConfig.isAclEnabled),
          createAtomTuple(
            isUploadAllFileAllowedAtom,
            serverConfig.isUploadAllFileAllowed,
          ),
          createAtomTuple(isUploadEnabledAtom, serverConfig.isUploadEnabled),
          createAtomTuple(
            isBulkExportPagesEnabledAtom,
            serverConfig.isBulkExportPagesEnabled,
          ),
          createAtomTuple(
            isPdfBulkExportEnabledAtom,
            serverConfig.isPdfBulkExportEnabled,
          ),
          createAtomTuple(
            isLocalAccountRegistrationEnabledAtom,
            serverConfig.isLocalAccountRegistrationEnabled,
          ),
          createAtomTuple(rendererConfigAtom, rendererConfigs),
          createAtomTuple(disableUserPagesAtom, serverConfig.disableUserPages),
        ];

  useHydrateAtoms(tuples);
};
