/**
 * Integration test for the `comments` Mongoose schema's inline-comment index.
 *
 * Contract under test: the compound index equivalent to Prisma's
 * `@@index([pageId, isInline])` (task 1.1) is declared on the Mongoose side
 * too, since Mongoose still owns index creation during the Mongoose→Prisma
 * migration (see .claude/rules/model.md). This is verified against a real
 * MongoDB connection by forcing index build via `Model.init()` and reading
 * back the actual index list — not by inspecting the schema definition,
 * so it fails if the index doesn't really get created in a fresh deployment.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ
 * setup; the `comments` model registers itself as a side effect of importing
 * `./comment`).
 */
import type { Collection } from 'mongodb';
import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import './comment';

import * as backfillIsInlineMigration from '~/migrations/20260901160138-backfill-comments-isinline';

describe('comments Mongoose schema (inline comment index)', () => {
  it("creates a { page: 1, isInline: 1 } index matching Prisma's @@index([pageId, isInline])", async () => {
    const Comment = mongoose.model('Comment');
    await Comment.init();

    const indexes = await Comment.collection.indexes();
    const inlineIndex = indexes.find(
      (index) => index.key.page === 1 && index.key.isInline === 1,
    );

    expect(inlineIndex).toBeDefined();
  });
});

/**
 * `countCommentByPageId` backs the page-footer comment count badge
 * (`obsolete-page.js` `updateCommentCount`). Requirement 6.3 also applies
 * here per design.md's "アーキテクチャ選定": inline comments must not
 * inflate that count, even though this isn't a share-link disclosure path.
 */
describe('prisma.comments.countCommentByPageId (inline comment exclusion)', () => {
  const { ObjectId } = Types;
  const pageId = new ObjectId();
  const revisionId = new ObjectId();
  const commentIds: string[] = [];

  beforeAll(async () => {
    await prisma.pages.create({
      data: { id: pageId.toString(), path: '/comment-count-integ', v: 0 },
    });
    await prisma.revisions.create({
      data: {
        id: revisionId.toString(),
        v: 0,
        authorId: new ObjectId().toString(),
        body: 'revision body',
        format: 'markdown',
        pageId: pageId.toString(),
      },
    });

    const normalComment = await prisma.comments.add(
      pageId.toString(),
      new ObjectId().toString(),
      revisionId.toString(),
      'normal comment',
      -1,
    );
    // Push each id right after it is created (not batched at the end) so a
    // failure partway through this setup still leaves afterAll able to clean
    // up whichever comment did get created.
    commentIds.push(normalComment.id);

    const inlineComment = await prisma.comments.create({
      data: {
        pageId: pageId.toString(),
        creatorId: new ObjectId().toString(),
        revisionId: revisionId.toString(),
        comment: 'inline comment',
        commentPosition: -1,
        isInline: true,
        quote: 'quoted text',
      },
    });
    commentIds.push(inlineComment.id);
  });

  afterAll(async () => {
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
    await prisma.revisions.deleteMany({ where: { id: revisionId.toString() } });
    await prisma.pages.deleteMany({ where: { id: pageId.toString() } });
  });

  it('does not count isInline rows toward the page comment count', async () => {
    const count = await prisma.comments.countCommentByPageId(pageId.toString());
    expect(count).toBe(1);
  });
});

/**
 * BLOCKING regression: `findCommentsByPageId` / `findCommentsByRevisionId` /
 * `countCommentByPageId` filter with `where: { isInline: { not: true } }`.
 * Prisma's MongoDB connector does NOT match that filter (nor `NOT: {
 * isInline: true }`, nor `OR: [{ isInline: false }, { isInline: null }]`)
 * against a document where `isInline` is entirely ABSENT from the underlying
 * MongoDB document — only against a document where it is explicitly stored
 * as `false`/some non-true value. Every comment created before the
 * inline-comment feature shipped has no `isInline` field at all, so without
 * the `20260901160138-backfill-comments-isinline` migration, every
 * pre-existing comment would vanish from the page-footer comment thread and
 * comment count badge as soon as this feature ships.
 *
 * The legacy document is inserted via the RAW mongodb driver (bypassing
 * Prisma entirely), which is the only way to reproduce a document that
 * genuinely lacks the `isInline` field — a Prisma `create()` call always
 * writes the schema's `@default(false)`.
 */
describe('backfill-comments-isinline migration (Mongo null-vs-absent regression)', () => {
  const { ObjectId } = Types;
  const pageId = new ObjectId();
  const revisionId = new ObjectId();
  const creatorId = new ObjectId();
  let legacyCommentId: InstanceType<typeof ObjectId>;
  let collection: Collection;

  beforeAll(async () => {
    collection = mongoose.connection.collection('comments');

    await prisma.pages.create({
      data: {
        id: pageId.toString(),
        path: '/legacy-comment-backfill-integ',
        v: 0,
      },
    });
    await prisma.revisions.create({
      data: {
        id: revisionId.toString(),
        v: 0,
        authorId: creatorId.toString(),
        body: 'revision body',
        format: 'markdown',
        pageId: pageId.toString(),
      },
    });

    // A legacy comment document as it looked before the inline-comment
    // feature added `isInline` — the field is entirely absent, not `false`.
    legacyCommentId = new ObjectId();
    await collection.insertOne({
      _id: legacyCommentId,
      page: pageId,
      creator: creatorId,
      revision: revisionId,
      comment: 'a comment predating the inline-comment feature',
      commentPosition: -1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await collection.deleteOne({ _id: legacyCommentId });
    await prisma.revisions.deleteMany({ where: { id: revisionId.toString() } });
    await prisma.pages.deleteMany({ where: { id: pageId.toString() } });
  });

  it('is invisible to findCommentsByPageId/findCommentsByRevisionId/countCommentByPageId before the migration runs (RED — locks in the Mongo connector gotcha this migration exists to fix)', async () => {
    const byPage = await prisma.comments.findCommentsByPageId(
      pageId.toString(),
      {},
    );
    expect(byPage.some((c) => c.id === legacyCommentId.toString())).toBe(false);

    const byRevision = await prisma.comments.findCommentsByRevisionId(
      revisionId.toString(),
      {},
    );
    expect(byRevision.some((c) => c.id === legacyCommentId.toString())).toBe(
      false,
    );

    const count = await prisma.comments.countCommentByPageId(pageId.toString());
    expect(count).toBe(0);
  });

  it('becomes visible to findCommentsByPageId/findCommentsByRevisionId/countCommentByPageId after the migration runs (GREEN)', async () => {
    await backfillIsInlineMigration.up();

    const byPage = await prisma.comments.findCommentsByPageId(
      pageId.toString(),
      {},
    );
    expect(byPage.some((c) => c.id === legacyCommentId.toString())).toBe(true);

    const byRevision = await prisma.comments.findCommentsByRevisionId(
      revisionId.toString(),
      {},
    );
    expect(byRevision.some((c) => c.id === legacyCommentId.toString())).toBe(
      true,
    );

    const count = await prisma.comments.countCommentByPageId(pageId.toString());
    expect(count).toBe(1);

    // Idempotent — re-running must not change or duplicate anything.
    await backfillIsInlineMigration.up();
    const countAfterRerun = await prisma.comments.countCommentByPageId(
      pageId.toString(),
    );
    expect(countAfterRerun).toBe(1);
  });
});
