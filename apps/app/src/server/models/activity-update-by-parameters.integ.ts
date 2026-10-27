/**
 * Integration tests — updateByParameters persists attachment snapshot fields
 * (the direct-deletion save gate).
 *
 * Contract under test (design.md "This Spec Owns > updateByParameters の改修",
 * "Testing Strategy > 保存口の直接検証 (C1 ガード)"): a plain ISnapshot passed to
 * `prisma.activities.updateByParameters` must reach the persisted `snapshot`
 * composite. Prisma composite types cannot take a bare object on update — the
 * function must convert it internally to the `{ update: ... }` envelope while
 * preserving the existing `snapshot._id` and `username` the add-activity
 * middleware wrote at ACTION_UNSETTLED creation time.
 *
 * Every assertion READS THE RECORD BACK FROM THE REAL DATABASE: the update
 * handler in service/activity.ts swallows errors (catch → logger.error →
 * return), so return-value assertions cannot catch a silently-failing save.
 *
 * Premise (verified against the real dev DB, 912 UNSETTLED docs, 2026-07-02):
 * every activity — UNSETTLED included — carries `snapshot._id` (0 docs without
 * a snapshot field, 0 without `snapshot._id`), so the `{ update }` envelope
 * always targets an existing composite and never creates a broken half-object.
 * `snapshot.username` is present for authenticated requests and absent for
 * unauthenticated ones (73/912 docs) — both shapes are pinned below.
 *
 *   - req 2.1: originalName / pagePath / pageId / fileSize are persisted.
 *   - req 2.2: the operator's username ends up in the snapshot; an existing
 *     username is never clobbered by an update that omits it.
 *   - req 4.2: snapshot-less update parameters (every current emit('update')
 *     caller) keep working and leave the stored snapshot untouched; the
 *     not-found → null return of updateByParameters is preserved.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup; per-worker
 * DB isolation is applied by test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 2.1, 2.2, 4.2
 * Design: Boundary Commitments > This Spec Owns (updateByParameters の改修・
 *   型安全性の担保), Testing Strategy (保存口の直接検証 C1 ガード)
 */

import { Types } from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

// Sentinel values so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.74';
const TEST_ENDPOINT = '/test/update-by-parameters';

/**
 * Create an ACTION_UNSETTLED activity exactly the way the add-activity
 * middleware does (src/server/middlewares/add-activity.ts): a snapshot is
 * always passed; username is undefined for unauthenticated requests.
 * Returns the persisted row read back from the DB (id + snapshot pre-state).
 */
async function arrangeUnsettledActivity(options: {
  userId?: string;
  username?: string;
}) {
  await prisma.activities.createByParameters({
    ip: TEST_IP,
    endpoint: TEST_ENDPOINT,
    action: SupportedAction.ACTION_UNSETTLED,
    user: options.userId,
    snapshot: { username: options.username },
  });
  // Read the seeded row back so the test works with the actual DB state
  // (each test creates exactly one UNSETTLED row; beforeEach cleans up).
  return prisma.activities.findFirstOrThrow({
    where: { ip: TEST_IP, action: SupportedAction.ACTION_UNSETTLED },
  });
}

describe('updateByParameters — snapshot persistence (read back from DB)', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 2.1/2.2 — persists all four attachment fields and keeps the existing snapshot._id and username', async () => {
    // Arrange: an UNSETTLED activity as the middleware creates it.
    // Premise check (fixes the { update } envelope choice): the middleware-
    // created row already carries snapshot._id and username in the DB.
    const unsettled = await arrangeUnsettledActivity({
      userId: new Types.ObjectId().toHexString(),
      username: 'alice',
    });
    expect(unsettled.snapshot.id.length).toBeGreaterThan(0);
    expect(unsettled.snapshot.username).toBe('alice');

    const attachmentId = new Types.ObjectId().toHexString();
    const pageId = new Types.ObjectId().toHexString();

    // Act: settle the activity through the save gate under test, passing a
    // plain ISnapshot (callers never build Prisma envelopes themselves)
    const updated = await prisma.activities.updateByParameters(unsettled.id, {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      target: attachmentId,
      targetModel: SupportedTargetModel.MODEL_ATTACHMENT,
      snapshot: {
        username: 'alice',
        originalName: 'design-v2.pdf',
        pagePath: '/Sandbox/specs',
        pageId,
        fileSize: 34567,
      },
    });
    expect(updated).not.toBeNull();

    // Assert: read the record back from the real DB (NOT the return value)
    const persisted = await prisma.activities.findUniqueOrThrow({
      where: { id: unsettled.id },
    });
    expect(persisted.action).toBe(SupportedAction.ACTION_ATTACHMENT_REMOVE);
    expect(persisted.snapshot).toMatchObject({
      username: 'alice',
      originalName: 'design-v2.pdf',
      pagePath: '/Sandbox/specs',
      pageId,
      fileSize: 34567,
    });
    // The pre-existing composite _id must survive the update
    expect(persisted.snapshot.id).toBe(unsettled.snapshot.id);
  });

  it('req 2.2 — an update snapshot that omits username leaves the middleware-written username intact', async () => {
    // Arrange
    const unsettled = await arrangeUnsettledActivity({
      userId: new Types.ObjectId().toHexString(),
      username: 'bob',
    });

    // Act: the snapshot builder could not resolve the operator — the update
    // must not clobber the username the middleware already persisted
    await prisma.activities.updateByParameters(unsettled.id, {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: {
        originalName: 'orphan.png',
        fileSize: 111,
      },
    });

    // Assert: read back — provided fields persisted, username/_id preserved
    const persisted = await prisma.activities.findUniqueOrThrow({
      where: { id: unsettled.id },
    });
    expect(persisted.snapshot.originalName).toBe('orphan.png');
    expect(persisted.snapshot.fileSize).toBe(111);
    expect(persisted.snapshot.username).toBe('bob');
    expect(persisted.snapshot.id).toBe(unsettled.snapshot.id);
    // Fields the update did not provide stay unset (null on Prisma read)
    expect(persisted.snapshot.pagePath).toBeNull();
    expect(persisted.snapshot.pageId).toBeNull();
  });

  it('req 2.1/2.2 — settles a user-less UNSETTLED activity (snapshot: {_id} only) and persists a username provided at update time', async () => {
    // Arrange: unauthenticated middleware call — snapshot has _id only
    // (73/912 real UNSETTLED docs have this shape; see premise note above)
    const unsettled = await arrangeUnsettledActivity({});
    expect(unsettled.snapshot.username).toBeNull();

    // Act
    await prisma.activities.updateByParameters(unsettled.id, {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: {
        username: 'carol',
        originalName: 'late-auth.txt',
        pagePath: '/Project/files',
        pageId: new Types.ObjectId().toHexString(),
        fileSize: 42,
      },
    });

    // Assert: read back — all fields persisted onto the existing composite
    const persisted = await prisma.activities.findUniqueOrThrow({
      where: { id: unsettled.id },
    });
    expect(persisted.snapshot.username).toBe('carol');
    expect(persisted.snapshot.originalName).toBe('late-auth.txt');
    expect(persisted.snapshot.id).toBe(unsettled.snapshot.id);
  });

  it("req 4.2 — snapshot-less parameters (every current emit('update') caller) leave the stored snapshot untouched", async () => {
    // Arrange
    const unsettled = await arrangeUnsettledActivity({
      userId: new Types.ObjectId().toHexString(),
      username: 'dave',
    });

    // Act: the pre-existing caller shape — action settle without a snapshot
    const updated = await prisma.activities.updateByParameters(unsettled.id, {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      target: new Types.ObjectId().toHexString(),
      targetModel: SupportedTargetModel.MODEL_PAGE,
    });
    expect(updated).not.toBeNull();

    // Assert: read back — action settled, snapshot byte-identical
    const persisted = await prisma.activities.findUniqueOrThrow({
      where: { id: unsettled.id },
    });
    expect(persisted.action).toBe(SupportedAction.ACTION_PAGE_UPDATE);
    expect(persisted.snapshot.id).toBe(unsettled.snapshot.id);
    expect(persisted.snapshot.username).toBe('dave');
    expect(persisted.snapshot.originalName).toBeNull();
    expect(persisted.snapshot.pagePath).toBeNull();
    expect(persisted.snapshot.pageId).toBeNull();
    expect(persisted.snapshot.fileSize).toBeNull();
  });

  it('req 4.2 — returns null (not throw) when the activity does not exist, even with a snapshot in parameters', async () => {
    // Act: not-found semantics (C1) must survive the snapshot handling change
    const result = await prisma.activities.updateByParameters(
      new Types.ObjectId().toHexString(),
      {
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
        snapshot: { username: 'nobody', originalName: 'ghost.bin' },
      },
    );

    // Assert
    expect(result).toBeNull();
  });
});
