import type { IUserHasId } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

describe('Revision proposal mark fields', () => {
  let user: IUserHasId;
  let page: PageDocument;

  const buildRevision = (
    mark?: { proposalId: string; proposalOperationKey: string },
    body = 'body',
  ) =>
    prisma.revisions.prepareRevision(page, body, null, user, undefined, {
      proposalMark: mark,
    });

  beforeAll(async () => {
    await getInstance();
    const User = mongoose.model<IUserHasId>('User');
    user = await User.create({
      name: 'revMarkUser',
      username: 'revMarkUser',
      email: 'revMarkUser@example.com',
    });
    const Page: Model<PageDocument> = mongoose.model<PageDocument>('Page');
    page = await Page.create({ path: '/rev-mark-page', grant: 1 });
  });

  it('stores no mark fields on a revision created without a mark', async () => {
    const created = await prisma.revisions.create({ data: buildRevision() });

    const raw = await mongoose.connection
      .collection('revisions')
      .findOne({ _id: new mongoose.Types.ObjectId(created.id) });

    expect(raw).not.toBeNull();
    expect(raw).not.toHaveProperty('proposalId');
    expect(raw).not.toHaveProperty('proposalOperationKey');
  });

  it('persists the mark values when a mark is given', async () => {
    const created = await prisma.revisions.create({
      data: buildRevision({
        proposalId: '65f000000000000000000001',
        proposalOperationKey: 'k-1',
      }),
    });

    const read = await prisma.revisions.findUniqueOrThrow({
      where: { id: created.id },
    });

    const raw = await mongoose.connection
      .collection('revisions')
      .findOne({ _id: new mongoose.Types.ObjectId(created.id) });

    expect(raw?.proposalId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(read.proposalId).toBe('65f000000000000000000001');
    expect(read.proposalOperationKey).toBe('k-1');
  });

  // A marked revision is the lasting record of what a proposal changed, so it must never expire.
  it('has no TTL index on the revisions collection', async () => {
    const Revision = mongoose.model('Revision');
    await Revision.init();

    const indexes = await Revision.collection.indexes();

    expect(
      indexes.filter((i) => i.expireAfterSeconds != null).map((i) => i.name),
    ).toEqual([]);
  });
});
