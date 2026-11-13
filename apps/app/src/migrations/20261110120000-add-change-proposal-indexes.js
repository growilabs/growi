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

export async function up(db) {
  logger.info('Apply migration');

  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists. Sequential, so one collection never builds several indexes at once.
  for (const { collection, key, options } of INDEXES) {
    await db.collection(collection).createIndex(key, options);
  }
}

export async function down(db) {
  logger.info('Rollback migration');

  for (const { collection, options } of INDEXES) {
    const target = db.collection(collection);
    if (await target.indexExists(options.name)) {
      await target.dropIndex(options.name);
    }
  }
}
