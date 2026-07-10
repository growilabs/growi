/**
 * Integration tests — createByParameters persists attachment snapshot fields
 * (the cascade-deletion save gate).
 *
 * Contract under test (design.md "Testing Strategy > 保存口の直接検証 (C1 ガード)"):
 * an ISnapshot passed to `prisma.activities.createByParameters` must actually
 * reach the persisted `snapshot` composite. The pre-fix implementation
 * hand-built `{ id, username }` and silently dropped the attachment fields
 * (design.md Overview「型は通るが保存されない」), so every assertion here READS
 * THE RECORD BACK FROM THE REAL DATABASE via an independent query — never the
 * builder/service return value.
 *
 *   - req 2.1 / 3.3: originalName / pagePath / pageId / fileSize are persisted.
 *   - req 2.3-adjacent: a partial attachment snapshot (builder could not
 *     resolve some fields) persists the provided fields only.
 *   - req 4.2: username-only snapshots and snapshot-less calls keep working
 *     (backward compatibility of the write path).
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup; in the
 * devcontainer run with MONGO_URI pointing at mongo:27017/rs0 — per-worker DB
 * isolation is applied by test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 2.1, 3.3, 4.2
 * Design: Boundary Commitments > This Spec Owns (createByParameters 改修・書き込み口の
 *   パラメータ型拡張), Testing Strategy (保存口の直接検証 C1 ガード)
 */

import { Types } from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

// Sentinel values so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.73';
const TEST_ENDPOINT = '/test/create-by-parameters';

describe('createByParameters — snapshot persistence (read back from DB)', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 2.1/3.3 — persists all four attachment fields of an AttachmentRemoveSnapshot', async () => {
    // Arrange: an attachment-removal snapshot as the cascade path builds it
    const pageId = new Types.ObjectId().toHexString();
    const attachmentId = new Types.ObjectId().toHexString();

    // Act: create through the save gate under test
    await prisma.activities.createByParameters({
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      user: new Types.ObjectId().toHexString(),
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

    // Assert: read the record back from the real DB (NOT the return value)
    const persisted = await prisma.activities.findFirst({
      where: { ip: TEST_IP, action: SupportedAction.ACTION_ATTACHMENT_REMOVE },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.snapshot).toMatchObject({
      username: 'alice',
      originalName: 'design-v2.pdf',
      pagePath: '/Sandbox/specs',
      pageId,
      fileSize: 34567,
    });
    // The composite _id is still generated for the snapshot subdocument
    expect(typeof persisted?.snapshot.id).toBe('string');
    expect(persisted?.snapshot.id.length).toBeGreaterThan(0);
  });

  it('req 2.1/3.3 — a partial attachment snapshot persists provided fields and leaves the rest unset', async () => {
    // Arrange/Act: builders omit fields they cannot resolve (e.g. page already
    // gone); the save gate must persist what it received without inventing values
    await prisma.activities.createByParameters({
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      user: new Types.ObjectId().toHexString(),
      snapshot: {
        username: 'carol',
        originalName: 'orphan.png',
        fileSize: 111,
      },
    });

    // Assert: read back — provided fields persisted, absent ones read as null
    const persisted = await prisma.activities.findFirst({
      where: { ip: TEST_IP, action: SupportedAction.ACTION_ATTACHMENT_REMOVE },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.snapshot).toMatchObject({
      username: 'carol',
      originalName: 'orphan.png',
      fileSize: 111,
    });
    // Prisma materializes missing optional composite fields as null on read
    expect(persisted?.snapshot.pagePath).toBeNull();
    expect(persisted?.snapshot.pageId).toBeNull();
  });

  it('req 4.2 — a username-only snapshot (DefaultSnapshot) keeps working unchanged', async () => {
    // Act: the pre-existing caller shape (e.g. add-activity middleware)
    await prisma.activities.createByParameters({
      action: SupportedAction.ACTION_PAGE_CREATE,
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      user: new Types.ObjectId().toHexString(),
      snapshot: { username: 'bob' },
    });

    // Assert: read back — username persisted, attachment fields untouched
    const persisted = await prisma.activities.findFirst({
      where: { ip: TEST_IP, action: SupportedAction.ACTION_PAGE_CREATE },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.snapshot.username).toBe('bob');
    expect(persisted?.snapshot.originalName).toBeNull();
    expect(persisted?.snapshot.pagePath).toBeNull();
    expect(persisted?.snapshot.pageId).toBeNull();
    expect(persisted?.snapshot.fileSize).toBeNull();
  });

  it("req 4.2 — a snapshot-less call still creates the activity; username stays unset (no '' placeholder)", async () => {
    // Act: user-less/system paths pass no snapshot at all
    await prisma.activities.createByParameters({
      action: SupportedAction.ACTION_USER_LOGOUT,
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });

    // Assert: read back — the record exists with a generated snapshot._id.
    // username must be unset (null on read), NOT the semantically wrong ''
    // the migration-era code stored: schema.prisma made username optional
    // precisely to allow user-less paths to omit it (matches pre-migration
    // Mongoose behavior, which never defaulted username).
    const persisted = await prisma.activities.findFirst({
      where: { ip: TEST_IP, action: SupportedAction.ACTION_USER_LOGOUT },
    });
    expect(persisted).not.toBeNull();
    expect(typeof persisted?.snapshot.id).toBe('string');
    expect(persisted?.snapshot.id.length).toBeGreaterThan(0);
    expect(persisted?.snapshot.username).toBeNull();
    expect(persisted?.snapshot.originalName).toBeNull();
    expect(persisted?.snapshot.fileSize).toBeNull();
  });
});
