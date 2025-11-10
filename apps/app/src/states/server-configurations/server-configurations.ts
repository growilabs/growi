import { atom, useAtomValue } from 'jotai';

import type { SupportedActionType } from '~/interfaces/activity';
import type { RendererConfig } from '~/interfaces/services/renderer';

/**
 * Atom for AI feature enabled status
 */
export const aiEnabledAtom = atom<boolean>(false);

/**
 * Atom for limit learnable page count per assistant
 */
export const limitLearnablePageCountPerAssistantAtom = atom<number>(0);

/**
 * Atom for users homepage deletion enabled status
 */
export const isUsersHomepageDeletionEnabledAtom = atom<boolean>(false);

/**
 * Atom for default indent size (default indent size)
 */
export const defaultIndentSizeAtom = atom<number>(4);

/**
 * Atom for mailer setup status
 */
export const isMailerSetupAtom = atom<boolean>(false);

/**
 * Atom for search scope children as default
 */
export const isSearchScopeChildrenAsDefaultAtom = atom<boolean>(false);

/**
 * Atom for elasticsearch max body length to index
 */
export const elasticsearchMaxBodyLengthToIndexAtom = atom<number>(0);

/**
 * Atom for ROM user allowed to comment
 */
export const isRomUserAllowedToCommentAtom = atom<boolean>(false);

/**
 * Atom for drawio URI
 */
export const drawioUriAtom = atom<string | null>(null);

/**
 * Atom for all reply shown
 */
export const isAllReplyShownAtom = atom<boolean>(false);

/**
 * Atom for show page limitation L
 */
export const showPageLimitationLAtom = atom<number>(50);

/**
 * Atom for show page limitation XL
 */
export const showPageLimitationXLAtom = atom<number>(20);

/**
 * Atom for show page side authors
 */
export const showPageSideAuthorsAtom = atom<boolean>(false);

/**
 * Atom for whether Customized Logo Uploaded
 */
export const isCustomizedLogoUploadedAtom = atom<boolean>(false);

/**
 * Atom for container fluid
 */
export const isContainerFluidAtom = atom<boolean>(false);

/**
 * Atom for stale notification enabled
 */
export const isEnabledStaleNotificationAtom = atom<boolean>(false);

/**
 * Atom for disable link sharing
 */
export const disableLinkSharingAtom = atom<boolean>(false);

/**
 * Atom for indent size forced
 */
export const isIndentSizeForcedAtom = atom<boolean>(false);

/**
 * Atom for attach title header enabled
 */
export const isEnabledAttachTitleHeaderAtom = atom<boolean>(false);

/**
 * Atom for search service configured
 */
export const isSearchServiceConfiguredAtom = atom<boolean>(false);

/**
 * Atom for search service reachable
 */
export const isSearchServiceReachableAtom = atom<boolean>(false);

/**
 * Atom for Slack configured
 */
export const isSlackConfiguredAtom = atom<boolean>(false);

/**
 * Atom for ACL enabled
 */
export const isAclEnabledAtom = atom<boolean>(false);

/**
 * Atom for registration whitelist
 */
export const registrationWhitelistAtom = atom<string[] | null>(null);

/**
 * Atom for upload all file allowed
 */
export const isUploadAllFileAllowedAtom = atom<boolean>(false);

/**
 * Atom for upload enabled
 */
export const isUploadEnabledAtom = atom<boolean>(false);

/**
 * Atom for bulk export pages enabled
 */
export const isBulkExportPagesEnabledAtom = atom<boolean>(false);

/**
 * Atom for PDF bulk export enabled
 */
export const isPdfBulkExportEnabledAtom = atom<boolean>(false);

/**
 * Atom for local account registration enabled
 */
export const isLocalAccountRegistrationEnabledAtom = atom<boolean>(false);

/**
 * Audit Log Enabled atom
 */
export const auditLogEnabledAtom = atom<boolean>(false);

/**
 * Activity Expiration Seconds atom
 */
export const activityExpirationSecondsAtom = atom<number>(0);

/**
 * Audit Log Available Actions atom
 */
export const auditLogAvailableActionsAtom = atom<SupportedActionType[]>([]);

/**
 * Atom for renderer config
 */
export const rendererConfigAtom = atom<RendererConfig>({
  isEnabledLinebreaks: false,
  isEnabledLinebreaksInComments: false,
  isEnabledMarp: false,
  adminPreferredIndentSize: 4,
  isIndentSizeForced: false,
  drawioUri: '',
  plantumlUri: '',
  highlightJsStyleBorder: false,
  isEnabledXssPrevention: true,
  sanitizeType: 'Recommended',
  customTagWhitelist: [],
  customAttrWhitelist: {},
});

export const useRendererConfig = () => useAtomValue(rendererConfigAtom);
