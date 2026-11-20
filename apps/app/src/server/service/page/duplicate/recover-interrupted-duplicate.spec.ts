import { PageGrant } from '@growi/core';

import type { StalledDuplicatePageOperation } from './duplicate-page-operation';
import { toInterruptedDuplicate } from './recover-interrupted-duplicate';

const stalled = (
  overrides: Partial<StalledDuplicatePageOperation> = {},
): StalledDuplicatePageOperation => ({
  operation: { operationId: 'op-1', ownerToken: 'token-1' },
  fromPath: '/from',
  toPath: '/to',
  userId: 'user-1',
  sourceGrant: PageGrant.GRANT_PUBLIC,
  sourceDescendantCount: 4,
  ...overrides,
});

describe('toInterruptedDuplicate', () => {
  it('carries the stored values over and marks the cause as stalled', () => {
    const input = stalled();

    expect(toInterruptedDuplicate(input)).toEqual({
      operation: input.operation,
      fromPath: '/from',
      toPath: '/to',
      userId: 'user-1',
      shouldNormalizeParent: true,
      sourcePageCount: 5,
      cause: { kind: 'stalled' },
    });
  });

  it('counts the source top page in addition to its descendants', () => {
    expect(
      toInterruptedDuplicate(stalled({ sourceDescendantCount: 0 }))
        .sourcePageCount,
    ).toBe(1);
  });

  it.each([
    { grant: PageGrant.GRANT_PUBLIC, expected: true },
    { grant: PageGrant.GRANT_OWNER, expected: true },
    { grant: PageGrant.GRANT_USER_GROUP, expected: true },
    { grant: PageGrant.GRANT_RESTRICTED, expected: false },
    { grant: PageGrant.GRANT_SPECIFIED, expected: false },
  ])('attaches the copy to the tree for grant $grant: $expected', ({
    grant,
    expected,
  }) => {
    expect(
      toInterruptedDuplicate(stalled({ sourceGrant: grant }))
        .shouldNormalizeParent,
    ).toBe(expected);
  });
});
