import { PageGrant } from '@growi/core';
import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';

import { configManager } from '~/server/service/config-manager';

import type { PathSuggestion } from './suggest-path-types';
import { SuggestionType } from './suggest-path-types';

const MEMO_LABEL = 'Save as memo';
const MEMO_DESCRIPTION = 'Save to your personal memo area';

export const generateMemoSuggestion = (user: {
  username: string;
}): PathSuggestion => {
  const disableUserPages = configManager.getConfig('security:disableUserPages');

  const path = disableUserPages
    ? `/memo/${user.username}/`
    : `${userHomepagePath(user)}/memo/`;

  return {
    type: SuggestionType.MEMO,
    path,
    label: MEMO_LABEL,
    description: MEMO_DESCRIPTION,
    grant: PageGrant.GRANT_OWNER,
  };
};
