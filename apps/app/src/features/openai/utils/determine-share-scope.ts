import { AiAssistantShareScope } from '~/features/openai/interfaces/ai-assistant';

import type { AiAssistantAccessScope } from '../interfaces/ai-assistant';

export const determineShareScope = (
  shareScope: AiAssistantShareScope,
  accessScope: AiAssistantAccessScope,
): AiAssistantShareScope => {
  return shareScope === AiAssistantShareScope.SAME_AS_ACCESS_SCOPE
    ? accessScope
    : shareScope;
};
