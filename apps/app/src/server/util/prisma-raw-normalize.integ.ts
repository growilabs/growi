import mongoose, { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import { generateGrantCondition } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import { normalizeAggregateRaw, toRawFilter } from './prisma-raw-normalize';

const PATH_PREFIX = '/prisma-raw-normalize-integ';

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

describe('a page filter containing ObjectId values, passed to pages.findRaw', () => {
  const viewerId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const viewerGroupId = new Types.ObjectId();
  const otherGroupId = new Types.ObjectId();

  const makePage = (
    name: string,
    grant: number,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: new Types.ObjectId(),
    path: `${PATH_PREFIX}/${name}`,
    grant,
    grantedUsers: [],
    grantedGroups: [],
    status: 'published',
    ...extra,
  });

  const publicPage = makePage('public', GRANT_PUBLIC);
  const ownPage = makePage('own', GRANT_OWNER, { grantedUsers: [viewerId] });
  const othersPage = makePage('others', GRANT_OWNER, {
    grantedUsers: [otherUserId],
  });
  const ownGroupPage = makePage('own-group', GRANT_USER_GROUP, {
    grantedGroups: [{ type: 'UserGroup', item: viewerGroupId }],
  });
  const otherGroupPage = makePage('other-group', GRANT_USER_GROUP, {
    grantedGroups: [{ type: 'UserGroup', item: otherGroupId }],
  });
  const publicPageOutsideIds = makePage('public-outside-ids', GRANT_PUBLIC);

  const allPages = [
    publicPage,
    ownPage,
    othersPage,
    ownGroupPage,
    otherGroupPage,
    publicPageOutsideIds,
  ];

  // Seeded through the driver so that ids are stored as real BSON ObjectIds,
  // exactly as the application stores them.
  const pagesCollection = () => mongoose.connection.collection('pages');

  beforeAll(async () => {
    await pagesCollection().insertMany(allPages);
  });

  afterAll(async () => {
    await pagesCollection().deleteMany({
      _id: { $in: allPages.map((page) => page._id) },
    });
  });

  it('returns exactly the matching pages, each with only its id and path', async () => {
    const candidateIds = allPages
      .filter((page) => page !== publicPageOutsideIds)
      .map((page) => page._id);

    const filter = toRawFilter({
      $and: [
        { _id: { $in: candidateIds } },
        generateGrantCondition({ _id: viewerId }, [viewerGroupId]),
      ],
    });

    const raw = await prisma.pages.findRaw({
      // Same boundary cast the executors use for aggregateRaw pipelines.
      filter: filter as Prisma.InputJsonObject,
      options: { projection: { _id: 1, path: 1 } },
    });

    const expected = [publicPage, ownPage, ownGroupPage].map((page) => ({
      _id: page._id.toHexString(),
      path: page.path,
    }));
    expect(normalizeAggregateRaw(raw)).toHaveLength(expected.length);
    expect(normalizeAggregateRaw(raw)).toEqual(
      expect.arrayContaining(expected),
    );
  });
});
