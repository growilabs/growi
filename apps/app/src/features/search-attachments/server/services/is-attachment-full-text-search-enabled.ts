import { configManager } from '~/server/service/config-manager';

const isSet = (value: string | null | undefined): boolean =>
  value != null && value.trim() !== '';

/**
 * The computed `isAttachmentFullTextSearchEnabled` flag, read from the live
 * config on every call so that an admin change takes effect without a restart.
 *
 * Code bundled by Next.js (getServerSideProps) must pass crowi.configManager:
 * the bundle holds its own copy of the config-manager module, which never
 * loads the config.
 */
export const isAttachmentFullTextSearchEnabled = (
  isSearchServiceConfigured: boolean,
  config: Pick<typeof configManager, 'getConfig'> = configManager,
): boolean =>
  isSearchServiceConfigured &&
  isSet(config.getConfig('app:attachmentFullTextSearch:extractorUri')) &&
  isSet(config.getConfig('app:attachmentFullTextSearch:extractorToken'));
