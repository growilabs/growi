import ShareLink from '~/server/models/share-link';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:certify-shared-page');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  return async (req, res, next) => {
    // Accept both `pageId` (camelCase, used by /revisions, /page/info) and
    // `page_id` (snake_case, used by /comments.get) so this single shared
    // middleware can certify either route.
    const camelPageId = req.query.pageId || req.body.pageId || null;
    const snakePageId = req.query.page_id || null;

    // CRITICAL: reject ambiguous requests where BOTH id params are present but
    // disagree. The middleware verifies one id while the downstream handler may
    // fetch by the other; if they differ, that verify/fetch split is an IDOR
    // (e.g. a valid share link for page A + `page_id=B` would bypass access to
    // B). Legitimate callers send only one of the two, so refusing to certify
    // the ambiguous case is safe and closes the split on every route.
    if (
      camelPageId != null &&
      snakePageId != null &&
      String(camelPageId) !== String(snakePageId)
    ) {
      return next();
    }

    const pageId = camelPageId ?? snakePageId;
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
