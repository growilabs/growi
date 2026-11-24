import { PageGrant } from '@growi/core/dist/interfaces';

import { shouldNormalizeParent } from './should-normalize-parent';

describe('shouldNormalizeParent', () => {
  it.each([
    ['GRANT_PUBLIC', PageGrant.GRANT_PUBLIC, true],
    ['GRANT_RESTRICTED', PageGrant.GRANT_RESTRICTED, false],
    ['GRANT_SPECIFIED', PageGrant.GRANT_SPECIFIED, false],
    ['GRANT_OWNER', PageGrant.GRANT_OWNER, true],
    ['GRANT_USER_GROUP', PageGrant.GRANT_USER_GROUP, true],
  ])('%s -> %s', (_name, grant, expected) => {
    expect(shouldNormalizeParent(grant)).toBe(expected);
  });
});
