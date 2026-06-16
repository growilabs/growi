import type { Nullable } from '@growi/core';
import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import type { EditorSettings } from '@growi/editor';
import useSWR, { type SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiGet } from '~/client/util/apiv1-client';
import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type { SlackChannels } from '~/interfaces/user-trigger-notification';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentUser } from '~/states/global';

type EditorSettingsOperation = {
  update: (updateData: Partial<EditorSettings>) => Promise<void>;
};

// TODO: Enable localStorageMiddleware
//   - Unabling localStorageMiddleware occurrs a flickering problem when loading theme.
//   - see: https://github.com/growilabs/growi/pull/6781#discussion_r1000285786
export const useEditorSettings = (): SWRResponseWithUtils<
  EditorSettingsOperation,
  EditorSettings,
  Error
> => {
  const currentUser = useCurrentUser();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();

  const swrResult = useSWRImmutable(
    isGuestUser || isReadOnlyUser
      ? null
      : ['/personal-setting/editor-settings', currentUser?.username],
    ([endpoint]) => {
      return apiv3Get(endpoint).then((result) => result.data);
    },
    {
      // use: [localStorageMiddleware], // store to localStorage for initialization fastly
      // fallbackData: undefined,
    },
  );

  return withUtils<EditorSettingsOperation, EditorSettings, Error>(swrResult, {
    update: async (updateData) => {
      const { data, mutate } = swrResult;

      if (data == null) {
        return;
      }

      mutate({ ...data, ...updateData }, false);

      // invoke API
      await apiv3Put('/personal-setting/editor-settings', updateData);
    },
  });
};

/*
 * Slack Notification
 */
export const useSWRxSlackChannels = (
  currentPagePath: Nullable<string>,
): SWRResponse<string[], Error> => {
  const shouldFetch: boolean = currentPagePath != null;
  return useSWR(
    shouldFetch ? ['/pages.updatePost', currentPagePath] : null,
    ([endpoint, path]) =>
      apiGet(endpoint, { path }).then(
        (response: SlackChannels) => response.updatePost,
      ),
    {
      revalidateOnFocus: false,
      fallbackData: [''],
    },
  );
};

export type IPageTagsForEditorsOption = {
  sync: (tags?: string[]) => void;
};
