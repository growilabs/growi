// see: https://redmine.weseek.co.jp/issues/150649

import type { IRevisionHasId } from '@growi/core';
import type { FilterQuery, UpdateQuery } from 'mongoose';
import mongoose from 'mongoose';

import type {
  IRevisionDocument,
  IRevisionModel,
} from '~/server/models/revision';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:NormalizeData:convert-revision-page-id-to-string',
);

export const convertRevisionPageIdToObjectId = async (): Promise<void> => {
  const Revision = mongoose.model<IRevisionHasId, IRevisionModel>('Revision');

  const filter: FilterQuery<IRevisionDocument> = {
    pageId: { $type: 'string' },
  };

  const update: UpdateQuery<IRevisionDocument> = [
    {
      $set: {
        pageId: {
          $convert: {
            input: '$pageId',
            to: 'objectId',
            onError: '$pageId',
          },
        },
      },
    },
  ];

  await Revision.updateMany(filter, update);

  const explain = await Revision.updateMany(filter, update).explain(
    'queryPlanner',
  );
  logger.debug(explain);
};
