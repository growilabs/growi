import { SupportedAction } from '~/interfaces/activity';

// Mock prisma before the module under test is imported
vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock mongoose so we can control Revision.countDocuments
vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      model: vi.fn(),
    },
  };
});

// Import AFTER mocks are registered
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import { shouldGenerateUpdate } from './update-activity-logic';

// Typed references to mocked functions
const mockFindFirst = vi.mocked(prisma.activities.findFirst);
const mockMongooseModel = vi.mocked(mongoose.model);

// Fake ObjectId-shaped strings for test IDs
const TARGET_PAGE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CURRENT_USER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccccccccccccccccccc';
const CURRENT_ACTIVITY_ID = 'dddddddddddddddddddddddd';

const FOUR_MINUTES_MS = 4 * 60 * 1000;
const SIX_MINUTES_MS = 6 * 60 * 1000;

/** Minimal activity stub returned by mockFindFirst.
 *  Includes the computed fields `_id` and `__v` added by createPrisma()'s extension.
 */
function makeActivity(overrides: { userId?: string | null; createdAt?: Date }) {
  const id = 'eeeeeeeeeeeeeeeeeeeeeeee';
  return {
    id,
    _id: id, // computed alias from createPrisma extension
    v: 0,
    __v: 0, // computed alias from createPrisma extension
    userId: overrides.userId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    action: SupportedAction.ACTION_PAGE_UPDATE,
    target: TARGET_PAGE_ID,
    endpoint: '/api',
    ip: '127.0.0.1',
    snapshot: { id: 'u1', username: 'testuser' },
    event: null,
    eventModel: null,
    targetModel: null,
  };
}

/** Register a mock Revision model that returns a given countDocuments value */
function setRevisionCount(count: number) {
  const fakeRevisionModel = {
    countDocuments: vi.fn().mockResolvedValue(count),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockMongooseModel.mockReturnValue(fakeRevisionModel as any);
}

describe('shouldGenerateUpdate() — DB-free unit (Prisma findFirst)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Contract: correct Prisma query is issued
  // ────────────────────────────────────────────────────────────────────────────

  it('calls prisma.activities.findFirst with Prisma operators (in, not, orderBy createdAt desc)', async () => {
    // Arrange
    mockFindFirst.mockResolvedValue(null);
    setRevisionCount(0);

    // Act
    await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    // Assert: converted from MongoDB $in/$ne to Prisma in/not
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        target: TARGET_PAGE_ID,
        action: {
          in: [
            SupportedAction.ACTION_PAGE_CREATE,
            SupportedAction.ACTION_PAGE_UPDATE,
          ],
        },
        id: { not: CURRENT_ACTIVITY_ID },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Early exit: currentUserId == null
  // ────────────────────────────────────────────────────────────────────────────

  it('returns false immediately when currentUserId is undefined, never calls findFirst', async () => {
    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: undefined,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(false);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Decision contract: no prior activity → generate
  // ────────────────────────────────────────────────────────────────────────────

  it('returns true when no last content activity is found (isLastActivityByMe = false)', async () => {
    mockFindFirst.mockResolvedValue(null);
    setRevisionCount(3);

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Decision contract: last by other user → always generate
  // ────────────────────────────────────────────────────────────────────────────

  it('returns true when last activity is by a different user', async () => {
    const recentTime = new Date(Date.now() - FOUR_MINUTES_MS);
    mockFindFirst.mockResolvedValue(
      makeActivity({ userId: OTHER_USER_ID, createdAt: recentTime }),
    );
    setRevisionCount(5);

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Decision contract: last by me, within 5 min → suppress
  // ────────────────────────────────────────────────────────────────────────────

  it('returns false when last activity is by me and within 5-minute suppression window', async () => {
    const recentTime = new Date(Date.now() - FOUR_MINUTES_MS);
    mockFindFirst.mockResolvedValue(
      makeActivity({ userId: CURRENT_USER_ID, createdAt: recentTime }),
    );
    setRevisionCount(5);

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Decision contract: last by me, outside 5 min, more than 2 revisions → generate
  // ────────────────────────────────────────────────────────────────────────────

  it('returns true when last activity is by me, outside window, revision count > 2', async () => {
    const olderTime = new Date(Date.now() - SIX_MINUTES_MS);
    mockFindFirst.mockResolvedValue(
      makeActivity({ userId: CURRENT_USER_ID, createdAt: olderTime }),
    );
    setRevisionCount(3);

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Decision contract: last by me, outside 5 min, exactly 2 revisions → suppress
  // ────────────────────────────────────────────────────────────────────────────

  it('returns false when last activity is by me, outside window, revision count === 2 (not > 2)', async () => {
    const olderTime = new Date(Date.now() - SIX_MINUTES_MS);
    mockFindFirst.mockResolvedValue(
      makeActivity({ userId: CURRENT_USER_ID, createdAt: olderTime }),
    );
    setRevisionCount(2); // MINIMUM_REVISION_FOR_ACTIVITY = 2; only > 2 generates

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Behavioral: userId field drives isLastActivityByMe (not .user)
  // ────────────────────────────────────────────────────────────────────────────

  it('correctly identifies "last by me" via userId field — if code used .user instead, this would return true (generate) not false (suppress)', async () => {
    // The activity has userId = CURRENT_USER_ID but no .user relation populated.
    // Within 5 min → should suppress (false).
    // If the code read `.user` (which is undefined here), isLastActivityByMe would be false
    // and the result would be true. So the correct result (false) proves userId is used.
    const recentTime = new Date(Date.now() - FOUR_MINUTES_MS);
    mockFindFirst.mockResolvedValue(
      makeActivity({ userId: CURRENT_USER_ID, createdAt: recentTime }),
    );
    setRevisionCount(5);

    const result = await shouldGenerateUpdate({
      targetPageId: TARGET_PAGE_ID,
      currentUserId: CURRENT_USER_ID,
      currentActivityId: CURRENT_ACTIVITY_ID,
    });

    expect(result).toBe(false); // suppressed, proving userId read was correct
  });
});
