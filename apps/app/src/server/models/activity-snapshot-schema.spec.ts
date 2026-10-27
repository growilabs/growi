import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ActivitiesSnapshot, Prisma } from '~/generated/prisma/client';

/**
 * Type-level contract for the ActivitiesSnapshot composite type generated
 * from prisma/schema.prisma (activity-log, requirement 4.2).
 *
 * These assertions are enforced by `pnpm run lint:typecheck`: they stop
 * compiling when schema.prisma drops an attachment field or reverts
 * `username` to required. The runtime expectations only make the contract
 * visible in the test report; the meaningful check happens at compile time.
 */
describe('ActivitiesSnapshot composite type (generated from schema.prisma)', () => {
  it('types username as nullable on the read model (optional in schema)', () => {
    expectTypeOf<ActivitiesSnapshot['username']>().toEqualTypeOf<
      string | null
    >();
  });

  it('exposes the four attachment fields as nullable on the read model', () => {
    expectTypeOf<ActivitiesSnapshot['originalName']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ActivitiesSnapshot['pagePath']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ActivitiesSnapshot['pageId']>().toEqualTypeOf<string | null>();
    expectTypeOf<ActivitiesSnapshot['fileSize']>().toEqualTypeOf<
      number | null
    >();
  });

  it('accepts a create input without any optional field (backward compat, requirement 4.2)', () => {
    // Existing activity documents carry only { _id, username } (or just
    // { _id }); a create input providing only `id` must stay valid so that
    // no destructive data migration is required.
    const minimalSnapshot: Prisma.ActivitiesSnapshotCreateInput = {
      id: '675547e97f208f8050a361d4',
    };
    expect(minimalSnapshot.username).toBeUndefined();
  });

  it('accepts a create input carrying all attachment fields', () => {
    const attachmentSnapshot: Prisma.ActivitiesSnapshotCreateInput = {
      id: '675547e97f208f8050a361d4',
      username: 'alice',
      originalName: 'design.pdf',
      pagePath: '/Sandbox',
      pageId: '675547e97f208f8050a361d5',
      fileSize: 1024,
    };
    expect(attachmentSnapshot.originalName).toBe('design.pdf');
  });
});
