import type { HydratedDocument, Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:revision:normalize-latest-revision',
);

/**
 * Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js'
 *
 * @ref https://github.com/growilabs/growi/pull/8998
 */
export const normalizeLatestRevisionIfBroken = async (
  pageId: string | Types.ObjectId,
): Promise<void> => {
  if (await Revision.exists({ pageId: { $eq: pageId } })) {
    return;
  }

  logger.info(
    `The page ('${pageId}') does not have any revisions. Normalization of the latest revision will be started.`,
  );

  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const page = await Page.findOne(
    { _id: { $eq: pageId } },
    { revision: 1 },
  ).exec();

  if (page == null) {
    logger.warn(
      `Normalization has been canceled since the page ('${pageId}') could not be found.`,
    );
    return;
  }
  if (
    page.revision == null ||
    !(await Revision.exists({ _id: page.revision }))
  ) {
    logger.warn(
      `Normalization has been canceled since the Page.revision of the page ('${pageId}') could not be found.`,
    );
    return;
  }

  // update Revision.pageId
  await Revision.updateOne({ _id: page.revision }, { $set: { pageId } }).exec();
};
