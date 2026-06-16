import type { AiAssistantAccessScope } from '../../interfaces/ai-assistant';
import { AiAssistantShareScope } from '../../interfaces/ai-assistant';
import { determineShareScope } from '../../utils/determine-share-scope';

export const getShareScopeIcon = (
  shareScope: AiAssistantShareScope,
  accessScope: AiAssistantAccessScope,
): string => {
  const determinedSharedScope = determineShareScope(shareScope, accessScope);
  switch (determinedSharedScope) {
    case AiAssistantShareScope.OWNER:
      return 'lock';
    case AiAssistantShareScope.GROUPS:
      return 'account_tree';
    case AiAssistantShareScope.PUBLIC_ONLY:
      return 'group';
    case AiAssistantShareScope.SAME_AS_ACCESS_SCOPE:
      return '';
  }
};
