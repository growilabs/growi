import { configManager } from '~/server/service/config-manager';

const isSet = (value: string | null | undefined): boolean =>
  value != null && value !== '';

/**
 * The computed `isAttachmentFullTextSearchEnabled` flag, read from the live
 * config on every call so that an admin change takes effect without a restart.
 */
export const isAttachmentFullTextSearchEnabled = (
  isSearchServiceConfigured: boolean,
): boolean =>
  isSearchServiceConfigured &&
  isSet(configManager.getConfig('app:attachmentFullTextSearch:extractorUri')) &&
  isSet(configManager.getConfig('app:attachmentFullTextSearch:extractorToken'));
