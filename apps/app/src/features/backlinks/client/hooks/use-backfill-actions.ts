import { useCallback, useState } from 'react';
import type { KeyedMutator } from 'swr';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';

import type {
  BacklinksBackfillStartRequest,
  BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';

type StateResponse = { state: BacklinksBackfillState };

export interface BackfillActions {
  readonly start: (request: BacklinksBackfillStartRequest) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly isSubmitting: boolean;
}

/** Start, Stop and Resume; each shows the state the endpoint answers with, or its refusal. */
export const useBackfillActions = (
  mutate: KeyedMutator<BacklinksBackfillState>,
): BackfillActions => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(
    async (send: () => Promise<{ data: StateResponse }>) => {
      setIsSubmitting(true);
      try {
        const response = await send();
        await mutate(response.data.state, { revalidate: false });
      } catch (err) {
        toastError(err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [mutate],
  );

  const start = useCallback(
    (request: BacklinksBackfillStartRequest) =>
      submit(() =>
        apiv3Post<StateResponse>('/backlinks-backfill/start', request),
      ),
    [submit],
  );
  const stop = useCallback(
    () => submit(() => apiv3Post<StateResponse>('/backlinks-backfill/stop')),
    [submit],
  );
  const resume = useCallback(
    () => submit(() => apiv3Post<StateResponse>('/backlinks-backfill/resume')),
    [submit],
  );

  return { start, stop, resume, isSubmitting };
};
