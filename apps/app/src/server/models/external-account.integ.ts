/**
 * Integration tests for external-account findAllWithPagination (offset-based regression).
 *
 * Verifies that the offset-based paginate change (tasks 1.4 + 1.5) does not break
 * observable behaviour: result count, ordering, and pagination metadata remain
 * identical to the pre-offset behaviour when the caller converts page → offset
 * exactly as the users.js route does (offset = (page - 1) * limit).
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally in this environment (no mongod binary).
 * CI exercises them via the app-integration Vitest project.
 */

import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

const DEFAULT_LIMIT = 50;

/**
 * Helper to create a test user in MongoDB via Mongoose so that Prisma's
 * externalaccounts.user relation can be satisfied (userId must reference a
 * real users document).
 */
async function createTestUser(suffix: string) {
  const UsersModel = mongoose.model('User');
  return UsersModel.create({
    name: `Test User ${suffix}`,
    username: `testuser_${suffix}`,
    email: `testuser_${suffix}@example.com`,
    status: 2, // STATUS_ACTIVE
    lang: 'en_US',
    isEmailPublished: false,
    createdAt: new Date(),
  });
}

describe('external-account findAllWithPagination — offset-based regression', () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  afterEach(async () => {
    // Clean up in order (external accounts first because of userId FK)
    if (createdAccountIds.length > 0) {
      await prisma.externalaccounts.deleteMany({
        where: { id: { in: createdAccountIds } },
      });
      createdAccountIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
      createdUserIds.length = 0;
    }
  });

  describe('single-page result (totalDocs <= limit)', () => {
    it('returns all items, correct count, page=1, no next/prev page', async () => {
      const user = await createTestUser('ea_single_1');
      createdUserIds.push(user._id.toString());

      const account = await prisma.externalaccounts.create({
        data: {
          providerType: 'github',
          accountId: 'alice_single',
          userId: user._id.toString(),
        },
      });
      createdAccountIds.push(account.id);

      // Simulate page=1 conversion: offset = (1-1)*50 = 0
      const result = await prisma.externalaccounts.findAllWithPagination({
        offset: 0,
        limit: DEFAULT_LIMIT,
      });

      // The result must include our seeded account (other tests may have seeded records,
      // so we check ≥1 and that our record is included)
      expect(result.totalDocs).toBeGreaterThanOrEqual(1);
      expect(result.page).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(DEFAULT_LIMIT);
      expect(result.docs.length).toBeGreaterThanOrEqual(1);

      const ids = result.docs.map((d) => d.id);
      expect(ids).toContain(account.id);
    });
  });

  describe('pagination: page=1 vs page=2 produce disjoint, correctly-ordered pages', () => {
    it('page 1 (offset=0) and page 2 (offset=limit) return non-overlapping docs', async () => {
      const limit = 2; // use a small limit to force pagination
      const records: string[] = [];

      // Seed 3 accounts so page 1 has 2, page 2 has 1
      for (let i = 1; i <= 3; i++) {
        const user = await createTestUser(`ea_page_${i}`);
        createdUserIds.push(user._id.toString());

        const account = await prisma.externalaccounts.create({
          data: {
            providerType: 'test',
            accountId: `account_page_${String(i).padStart(3, '0')}`,
            userId: user._id.toString(),
          },
        });
        createdAccountIds.push(account.id);
        records.push(account.id);
      }

      // page 1: offset = (1-1)*limit = 0
      const page1 = await prisma.externalaccounts.findAllWithPagination({
        offset: 0,
        limit,
      });

      // page 2: offset = (2-1)*limit = limit
      const page2 = await prisma.externalaccounts.findAllWithPagination({
        offset: limit,
        limit,
      });

      // Page metadata is consistent
      expect(page1.page).toBe(1);
      expect(page1.offset).toBe(0);
      expect(page2.page).toBe(2);
      expect(page2.offset).toBe(limit);

      // Pages are non-overlapping
      const ids1 = new Set(page1.docs.map((d) => d.id));
      const ids2 = new Set(page2.docs.map((d) => d.id));
      for (const id of ids2) {
        expect(ids1.has(id)).toBe(false);
      }

      // Combined totalDocs consistent across pages
      expect(page1.totalDocs).toBe(page2.totalDocs);

      // hasNextPage/hasPrevPage are consistent
      expect(page1.hasPrevPage).toBe(false);
      expect(page1.prevPage).toBeNull();
      expect(page2.hasPrevPage).toBe(true);
      expect(page2.prevPage).toBe(1);
    });
  });

  describe('sort order is stable (accountId asc default)', () => {
    it('docs are ordered by accountId ascending', async () => {
      const limit = 10;
      const accountIds = ['zzz_account', 'aaa_account', 'mmm_account'];

      for (const accountId of accountIds) {
        const user = await createTestUser(`ea_sort_${accountId}`);
        createdUserIds.push(user._id.toString());

        const account = await prisma.externalaccounts.create({
          data: {
            providerType: 'test',
            accountId,
            userId: user._id.toString(),
          },
        });
        createdAccountIds.push(account.id);
      }

      const result = await prisma.externalaccounts.findAllWithPagination({
        offset: 0,
        limit,
      });

      // Find the positions of our seeded accounts in the result
      const resultAccountIds = result.docs.map((d) => d.accountId);
      const seededPositions = accountIds.map((id) =>
        resultAccountIds.indexOf(id),
      );

      // All our seeded accounts must be present
      for (const pos of seededPositions) {
        expect(pos).toBeGreaterThanOrEqual(0);
      }

      // Verify the relative order of our seeded accounts is aaa < mmm < zzz
      const posAaa = resultAccountIds.indexOf('aaa_account');
      const posMmm = resultAccountIds.indexOf('mmm_account');
      const posZzz = resultAccountIds.indexOf('zzz_account');
      expect(posAaa).toBeLessThan(posMmm);
      expect(posMmm).toBeLessThan(posZzz);
    });
  });

  describe('offset field is present in result', () => {
    it('result includes offset field matching the input', async () => {
      const offset = 0;
      const result = await prisma.externalaccounts.findAllWithPagination({
        offset,
        limit: DEFAULT_LIMIT,
      });

      expect(result).toHaveProperty('offset', offset);
    });

    it('result includes correct offset when requesting page 2', async () => {
      const limit = 5;
      const offset = limit; // page 2 = (2-1)*5 = 5
      const result = await prisma.externalaccounts.findAllWithPagination({
        offset,
        limit,
      });

      expect(result).toHaveProperty('offset', offset);
      expect(result.page).toBe(2);
    });
  });
});
