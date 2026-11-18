import { useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';

import type {
  ChangeProposalSettingsUpdate,
  ChangeProposalSettingsView,
} from '../../interfaces';

const ENDPOINT = '/change-proposal-settings';

type SettingsResponse = { readonly settings: ChangeProposalSettingsView };

export type UseChangeProposalSettings = SWRResponse<
  ChangeProposalSettingsView,
  Error
> & {
  // Throws the API errors so the caller can report them and keep the input.
  readonly save: (body: ChangeProposalSettingsUpdate) => Promise<void>;
};

export const useChangeProposalSettings = (): UseChangeProposalSettings => {
  const swr = useSWRImmutable<ChangeProposalSettingsView, Error>(
    ENDPOINT,
    (endpoint: string) =>
      apiv3Get<SettingsResponse>(endpoint).then((res) => res.data.settings),
  );

  const { mutate } = swr;

  const save = useCallback(
    async (body: ChangeProposalSettingsUpdate): Promise<void> => {
      const res = await apiv3Put<SettingsResponse>(ENDPOINT, body);
      await mutate(res.data.settings, { revalidate: false });
    },
    [mutate],
  );

  return { ...swr, save };
};
