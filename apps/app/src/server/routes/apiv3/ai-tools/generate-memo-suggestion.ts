import { PageGrant } from '@growi/core';
import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';

import { configManager } from '~/server/service/config-manager';

import { resolveParentGrant } from './resolve-parent-grant';
import type { PathSuggestion } from './suggest-path-types';
import { SuggestionType } from './suggest-path-types';

const MEMO_LABEL = 'Save as memo';
const MEMO_DESCRIPTION = 'Save to your personal memo area';

export const generateMemoSuggestion = async (user: {
  username: string;
}): Promise<PathSuggestion> => {
  const disableUserPages = configManager.getConfig('security:disableUserPages');

  if (disableUserPages) {
    const path = `/memo/${user.username}/`;
    const grant = await resolveParentGrant(path);
    return {
      type: SuggestionType.MEMO,
      path,
      label: MEMO_LABEL,
      description: MEMO_DESCRIPTION,
      grant,
    };
  }

  return {
    type: SuggestionType.MEMO,
    path: `${userHomepagePath(user)}/memo/`,
    label: MEMO_LABEL,
    description: MEMO_DESCRIPTION,
    grant: PageGrant.GRANT_OWNER,
  };
};
