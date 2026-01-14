import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { AccessibleAiAssistantsHasId } from '../../interfaces/ai-assistant';

export const useSWRxAiAssistants = (): SWRResponse<
  AccessibleAiAssistantsHasId,
  Error
> => {
  return useSWRImmutable<AccessibleAiAssistantsHasId>(
    ['/openai/ai-assistants'],
    ([endpoint]) =>
      apiv3Get(endpoint).then(
        (response) => response.data.accessibleAiAssistants,
      ),
  );
};
