import { objectIdUtils } from '@growi/core/dist/utils';

import loggerFactory from '~/utils/logger';

import type { ValidReferer } from '../interfaces';
import { retrieveSiteUrl } from './retrieve-site-url';

const logger = loggerFactory(
  'growi:middlewares:certify-shared-page-attachment:validate-referer',
);

export const validateReferer = (
  referer: string | undefined,
): ValidReferer | false => {
  // not null
  if (referer == null) {
    logger.info('The referer string is undefined');
    return false;
  }

  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch (err) {
    logger.info(`Parsing referer ('${referer}') has failed`);
    return false;
  }

  // siteUrl
  const siteUrl = retrieveSiteUrl();
  if (siteUrl == null) {
    logger.info('The siteUrl is null.');
    return false;
  }

  // validate hostname and port
  if (
    refererUrl.hostname !== siteUrl.hostname ||
    refererUrl.port !== siteUrl.port
  ) {
    logger.warn('The hostname or port mismatched.', {
      refererUrl: {
        hostname: refererUrl.hostname,
        port: refererUrl.port,
      },
      siteUrl: {
        hostname: siteUrl.hostname,
        port: siteUrl.port,
      },
    });
    return false;
  }

  // validate pathname
  // https://regex101.com/r/M5Bp6E/1
  const match = refererUrl.pathname.match(
    /^\/share\/(?<shareLinkId>[a-f0-9]{24})$/i,
  );
  if (match == null) {
    return false;
  }
  if (match.groups?.shareLinkId == null) {
    logger.warn(`The pathname ('${refererUrl.pathname}') is invalid.`, match);
    return false;
  }

  // validate shareLinkId is an correct ObjectId
  if (!objectIdUtils.isValidObjectId(match.groups.shareLinkId)) {
    logger.warn(
      `The shareLinkId ('${match.groups.shareLinkId}') is invalid as an ObjectId.`,
    );
    return false;
  }

  return {
    referer,
    shareLinkId: match.groups.shareLinkId,
  };
};
