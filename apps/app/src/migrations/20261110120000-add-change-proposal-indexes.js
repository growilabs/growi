import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-change-proposal-indexes');

// Sparse wherever most documents never set the field. schema.prisma declares the
// same indexes by name but cannot express `sparse`.
const INDEXES = [
  {
    collection: 'changeproposals',
    key: { requester: 1, createdAt: -1 },
    options: { name: 'requester_1_createdAt_-1' },
  },
  {
    collection: 'changeproposals',
    key: { lifecycle: 1, expiresAt: 1 },
    options: { name: 'lifecycle_1_expiresAt_1' },
  },
  {
    collection: 'changeproposals',
    key: { 'applyLease.expiresAt': 1 },
    options: { name: 'applyLease.expiresAt_1', sparse: true },
  },
  {
    collection: 'changeproposals',
    key: { lastAppliedAt: -1 },
    options: { name: 'lastAppliedAt_-1', sparse: true },
  },
  {
    collection: 'changeproposals',
    key: { revertOf: 1 },
    options: { name: 'revertOf_1', sparse: true },
  },
  {
    collection: 'changeproposals',
    key: { 'basedOn.proposalId': 1 },
    options: { name: 'basedOn.proposalId_1', sparse: true },
  },
  {
    collection: 'revisions',
    key: { proposalId: 1, proposalOperationKey: 1 },
    options: { name: 'proposalId_1_proposalOperationKey_1', sparse: true },
  },
];

export async function up() {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists. Sequential, so one collection never builds several indexes at once.
  for (const { collection, key, options } of INDEXES) {
    await mongoose.connection.collection(collection).createIndex(key, options);
  }
}

export async function down() {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  for (const { collection, options } of INDEXES) {
    const target = mongoose.connection.collection(collection);
    if (await target.indexExists(options.name)) {
      await target.dropIndex(options.name);
    }
  }
}
