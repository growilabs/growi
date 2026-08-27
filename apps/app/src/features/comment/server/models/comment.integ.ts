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
import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import './comment';

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
