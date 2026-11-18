/**
 * Legacy documents are inserted via the raw driver so that nothing defaults the
 * reviewer fields. The template DB used in CI already has every migration
 * applied, so each index test starts from `down` and ends after `up`.
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

const INDEX_NAME = 'lifecycle_1_reviewers.id_1__id_1';

const legacyProposal = (requester: ObjectId) => ({
  _id: new ObjectId(),
  requester,
  entry: 'api',
  lifecycle: 'open',
  operations: [
    { index: 0, key: 'op-0', type: 'create', status: 'pending', path: '/a' },
  ],
  appliedPageIds: [],
  perPageNotifications: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  __v: 0,
});

describe('add-change-proposal-reviewer-indexes', () => {
  let collection: Collection;
  let migrate: typeof import('./20261116120000-add-change-proposal-reviewer-indexes');
  const requester = new ObjectId();

  const findReviewerIndex = async () =>
    (await collection.indexes()).find((index) => index.name === INDEX_NAME);

  beforeAll(async () => {
    migrate = await import(
      './20261116120000-add-change-proposal-reviewer-indexes'
    );
    collection = mongoose.connection.collection('changeproposals');
  });

  afterEach(async () => {
    await collection.deleteMany({ requester });
  });

  it('creates the reviewer queue index on lifecycle, reviewers.id and _id, and down drops it (Req 19.5)', async () => {
    await migrate.down(mongoose.connection.db);
    expect(await findReviewerIndex()).toBeUndefined();

    await migrate.up(mongoose.connection.db);
    const index = await findReviewerIndex();
    expect(index?.key).toEqual({ lifecycle: 1, 'reviewers.id': 1, _id: 1 });
    expect(index?.sparse).not.toBe(true);
    expect(index?.expireAfterSeconds).toBeUndefined();

    await migrate.down(mongoose.connection.db);
    expect(await findReviewerIndex()).toBeUndefined();

    await migrate.up(mongoose.connection.db);
  });

  it('backfills empty reviewers and reviews on a legacy proposal, which then reads through Prisma with no reviewers (Req 15.4)', async () => {
    const legacy = legacyProposal(requester);
    await collection.insertOne(legacy);

    await migrate.up(mongoose.connection.db);

    const raw = await collection.findOne({ _id: legacy._id });
    expect(raw?.reviewers).toEqual([]);
    expect(raw?.reviews).toEqual([]);

    const read = await prisma.changeproposals.findUniqueOrThrow({
      where: { id: legacy._id.toString() },
    });
    expect(read.reviewers).toEqual([]);
    expect(read.reviews).toEqual([]);
    expect(read.purpose).toBeNull();
    expect(read.operations[0]).toMatchObject({
      approvedBy: null,
      approvedChannel: null,
      decisionToken: null,
    });
  });

  it('leaves reviewers and reviews that a proposal already has untouched', async () => {
    const reviewer = {
      kind: 'user',
      id: new ObjectId(),
      addedBy: requester,
      addedAt: new Date('2026-11-01T00:00:00Z'),
    };
    const review = {
      kind: 'abstain',
      operationKey: 'op-0',
      by: reviewer.id,
      at: new Date('2026-11-02T00:00:00Z'),
      channel: 'ui',
    };
    const withReviewers = {
      ...legacyProposal(requester),
      reviewers: [reviewer],
      reviews: [review],
    };
    const reviewersOnly = {
      ...legacyProposal(requester),
      reviewers: [reviewer],
    };
    await collection.insertMany([withReviewers, reviewersOnly]);

    await migrate.up(mongoose.connection.db);

    const rawWithReviewers = await collection.findOne({
      _id: withReviewers._id,
    });
    expect(rawWithReviewers?.reviewers).toEqual([reviewer]);
    expect(rawWithReviewers?.reviews).toEqual([review]);
    const rawReviewersOnly = await collection.findOne({
      _id: reviewersOnly._id,
    });
    expect(rawReviewersOnly?.reviewers).toEqual([reviewer]);
    expect(rawReviewersOnly?.reviews).toEqual([]);
  });

  it('is a no-op when run again', async () => {
    await collection.insertOne(legacyProposal(requester));
    await migrate.up(mongoose.connection.db);
    const indexesBefore = await collection.indexes();
    const docsBefore = await collection.find({ requester }).toArray();

    await migrate.up(mongoose.connection.db);

    expect(await collection.indexes()).toEqual(indexesBefore);
    expect(await collection.find({ requester }).toArray()).toEqual(docsBefore);
  });
});
