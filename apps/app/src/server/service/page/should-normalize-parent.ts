import { PageGrant } from '@growi/core/dist/interfaces';

export const shouldNormalizeParent = (grant: PageGrant): boolean => {
  return (
    grant !== PageGrant.GRANT_RESTRICTED && grant !== PageGrant.GRANT_SPECIFIED
  );
};
