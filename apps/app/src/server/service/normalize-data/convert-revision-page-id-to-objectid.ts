// see: https://redmine.weseek.co.jp/issues/150649

import { prisma } from '~/utils/prisma';

export const convertRevisionPageIdToObjectId = async (): Promise<void> => {
  await prisma.$runCommandRaw({
    update: 'revisions',
    updates: [
      {
        q: { pageId: { $type: 'string' } },
        u: [
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
        ],
        multi: true,
      },
    ],
  });
};
