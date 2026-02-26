import { PageGrant } from '@growi/core';
import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';

import { configManager } from '~/server/service/config-manager';

import type { PathSuggestion } from '../../interfaces/suggest-path-types';
import { SuggestionType } from '../../interfaces/suggest-path-types';
import { resolveParentGrant } from './resolve-parent-grant';

const MEMO_LABEL = 'Save as memo';
const MEMO_DESCRIPTION = 'Save to your personal memo area';

export const generateMemoSuggestion = async (user: {
  username: string;
}): Promise<PathSuggestion> => {
  const disableUserPages = configManager.getConfig('security:disableUserPages');

  if (disableUserPages) {
    // When user pages are disabled, memo falls back to /memo/<username>/
    // which may have inherited grant from an ancestor page — resolve dynamically
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

  // When user pages are enabled, memo is saved under the user's homepage
  // which is always owner-only by convention — no need to resolve
  return {
    type: SuggestionType.MEMO,
    path: `${userHomepagePath(user)}/memo/`,
    label: MEMO_LABEL,
    description: MEMO_DESCRIPTION,
    grant: PageGrant.GRANT_OWNER,
  };
};
