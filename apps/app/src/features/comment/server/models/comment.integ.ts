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
import mongoose from 'mongoose';

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
