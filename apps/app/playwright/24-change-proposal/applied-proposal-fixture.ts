import { randomUUID } from 'node:crypto';
import { type Db, MongoClient, ObjectId } from 'mongodb';

// Playwright runs outside the server and core has no REST API to create a
// Change Proposal, so the "already applied" state is written to MongoDB the way
// the core applier leaves it. Every @db.ObjectId field of the Prisma schema is
// written as an ObjectId; Prisma would not match a string there.

export type AppliedProposalInput = {
  readonly requesterUsername: string;
  readonly edited: {
    readonly pageId: string;
    readonly path: string;
    readonly proposedBody: string;
  };
  readonly created: {
    readonly pageId: string;
    readonly path: string;
    readonly body: string;
  };
};

export type AppliedProposal = {
  readonly proposalId: string;
};

const mongoUri = (): string => {
  const uri = process.env.MONGO_URI;
  if (uri == null || uri === '') {
    throw new Error(
      'MONGO_URI must point at the database of the server under test',
    );
  }
  return uri;
};

const withDb = async <T>(work: (db: Db) => Promise<T>): Promise<T> => {
  const client = new MongoClient(mongoUri());
  await client.connect();
  try {
    return await work(client.db());
  } finally {
    await client.close();
  }
};

const currentRevisionOf = async (db: Db, pageId: ObjectId) => {
  const page = await db.collection('pages').findOne({ _id: pageId });
  if (page?.revision == null) {
    throw new Error(`page ${pageId} has no revision`);
  }
  return page.revision as ObjectId;
};

/**
 * Turns two pages made through the REST API into the result of applying a Change
 * Proposal with an edit and a create: a marked revision becomes the edited
 * page's current revision, the created page's only revision gets the mark, and
 * a settled proposal document records both operations as applied.
 */
export const writeAppliedProposal = (
  input: AppliedProposalInput,
): Promise<AppliedProposal> =>
  withDb(async (db) => {
    const requester = await db
      .collection('users')
      .findOne({ username: input.requesterUsername });
    if (requester == null) {
      throw new Error(`user ${input.requesterUsername} not found`);
    }
    const requesterId = requester._id;
    const proposalId = new ObjectId();
    const editKey = randomUUID();
    const createKey = randomUUID();
    const now = new Date();

    const editedPageId = new ObjectId(input.edited.pageId);
    const baseRevisionId = await currentRevisionOf(db, editedPageId);
    const editRevisionId = new ObjectId();
    await db.collection('revisions').insertOne({
      _id: editRevisionId,
      __v: 0,
      pageId: editedPageId,
      body: input.edited.proposedBody,
      format: 'markdown',
      author: requesterId,
      hasDiffToPrev: true,
      createdAt: now,
      proposalId,
      proposalOperationKey: editKey,
    });
    await db.collection('pages').updateOne(
      { _id: editedPageId },
      {
        $set: {
          revision: editRevisionId,
          lastUpdateUser: requesterId,
          updatedAt: now,
        },
      },
    );

    const createdPageId = new ObjectId(input.created.pageId);
    const createRevisionId = await currentRevisionOf(db, createdPageId);
    await db
      .collection('revisions')
      .updateOne(
        { _id: createRevisionId },
        { $set: { proposalId, proposalOperationKey: createKey } },
      );

    const applied = { status: 'applied', approvedAt: now, appliedAt: now };
    await db.collection('changeproposals').insertOne({
      _id: proposalId,
      __v: 0,
      requester: requesterId,
      entry: 'ai-chat',
      lifecycle: 'settled',
      operations: [
        {
          index: 0,
          key: editKey,
          type: 'edit',
          ...applied,
          pageId: editedPageId,
          baseRevisionId,
          body: input.edited.proposedBody,
          // the page path recorded at apply time
          path: input.edited.path,
          resultPageId: editedPageId,
          resultRevisionId: editRevisionId,
        },
        {
          index: 1,
          key: createKey,
          type: 'create',
          ...applied,
          path: input.created.path,
          body: input.created.body,
          resultPageId: createdPageId,
          resultRevisionId: createRevisionId,
        },
      ],
      appliedPageIds: [editedPageId, createdPageId],
      lastAppliedAt: now,
      perPageNotifications: false,
      createdAt: now,
      updatedAt: now,
    });

    return { proposalId: proposalId.toHexString() };
  });

/** The page's current revision id, or null once the page is gone. */
export const findCurrentRevisionId = (pageId: string): Promise<string | null> =>
  withDb(async (db) => {
    const page = await db
      .collection('pages')
      .findOne({ _id: new ObjectId(pageId) });
    return page?.revision == null ? null : String(page.revision);
  });

/** Removes the proposal, the reverts made from it and their notifications. */
export const removeProposalAndReverts = (proposalId: string): Promise<void> =>
  withDb(async (db) => {
    const original = new ObjectId(proposalId);
    const proposals = await db
      .collection('changeproposals')
      .find(
        { $or: [{ _id: original }, { revertOf: original }] },
        { projection: { _id: 1 } },
      )
      .toArray();
    const ids = proposals.map((p) => p._id);
    await db.collection('inappnotifications').deleteMany({
      target: { $in: ids },
    });
    await db.collection('changeproposals').deleteMany({ _id: { $in: ids } });
  });
