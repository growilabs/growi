import ShareLink from '~/server/models/share-link';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:certify-shared-page');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  return async (req, res, next) => {
    const pageId = req.query.pageId || req.body.pageId || null;
    const shareLinkId = req.query.shareLinkId || req.body.shareLinkId || null;
    if (pageId == null || shareLinkId == null) {
      return next();
    }

    const sharelink = await ShareLink.findOne({
      _id: { $eq: shareLinkId },
      relatedPage: { $eq: pageId },
    });

    // check sharelink enabled
    if (sharelink == null || sharelink.isExpired()) {
      return next();
    }

    logger.debug('shareLink id is', sharelink._id);

    req.isSharedPage = true;

    logger.debug('Confirmed target page id is a share page');

    next();
  };
};
