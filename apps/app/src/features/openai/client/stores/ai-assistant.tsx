import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useIsGuestUser } from '~/states/context';

import type { AccessibleAiAssistantsHasId } from '../../interfaces/ai-assistant';

export const useSWRxAiAssistants = (): SWRResponse<
  AccessibleAiAssistantsHasId,
  Error
> => {
  const isGuestUser = useIsGuestUser();

  return useSWRImmutable<AccessibleAiAssistantsHasId>(
    !isGuestUser ? ['/openai/ai-assistants'] : null,
    ([endpoint]) =>
      apiv3Get(endpoint).then(
        (response) => response.data.accessibleAiAssistants,
      ),
  );
};
