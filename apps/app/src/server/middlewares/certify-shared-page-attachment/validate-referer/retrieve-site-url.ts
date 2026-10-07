import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:middlewares:certify-shared-page-attachment:validate-referer:retrieve-site-url',
);

export const retrieveSiteUrl = (): URL | null => {
  const siteUrlString = configManager.getConfig('app:siteUrl');
  if (siteUrlString == null) {
    logger.warn(
      "Verification referer does not work because 'Site URL' is NOT set. All of attachments in share link page is invisible.",
    );
    return null;
  }

  try {
    return new URL(siteUrlString);
  } catch (err) {
    logger.error(`Parsing 'app:siteUrl' ('${siteUrlString}') has failed.`);
    return null;
  }
};
