import { useCallback, useEffect } from 'react';

import { type Nullable } from '@growi/core';
import { withUtils, type SWRResponseWithUtils, useSWRStatic } from '@growi/core/dist/swr';
import type { EditorSettings } from '@growi/editor';
import useSWR, { type SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiGet } from '~/client/util/apiv1-client';
import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type { SlackChannels } from '~/interfaces/user-trigger-notification';
import {
  useCurrentUser, useDefaultIndentSize, useIsGuestUser, useIsReadOnlyUser,
} from '~/stores-universal/context';

// import { localStorageMiddleware } from './middlewares/sync-to-storage';
import { useSWRxTagsInfo } from './page';


export const useWaitingSaveProcessing = (): SWRResponse<boolean, Error> => {
  return useSWRStatic('waitingSaveProcessing', undefined, { fallbackData: false });
};


export const useEditingMarkdown = (initialData?: string): SWRResponse<string, Error> => {
  return useSWRStatic('editingMarkdown', initialData);
};


type EditorSettingsOperation = {
  update: (updateData: Partial<EditorSettings>) => Promise<void>,
}

// TODO: Enable localStorageMiddleware
//   - Unabling localStorageMiddleware occurrs a flickering problem when loading theme.
//   - see: https://github.com/growilabs/growi/pull/6781#discussion_r1000285786
export const useEditorSettings = (): SWRResponseWithUtils<EditorSettingsOperation, EditorSettings, Error> => {
  const { data: currentUser } = useCurrentUser();
  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();

  const swrResult = useSWRImmutable(
    (isGuestUser || isReadOnlyUser) ? null : ['/personal-setting/editor-settings', currentUser?.username],
    ([endpoint]) => {
      return apiv3Get(endpoint).then(result => result.data);
    },
    {
      // use: [localStorageMiddleware], // store to localStorage for initialization fastly
      // fallbackData: undefined,
    },
  );

  return withUtils<EditorSettingsOperation, EditorSettings, Error>(swrResult, {
    update: async(updateData) => {
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

export const useCurrentIndentSize = (): SWRResponse<number, Error> => {
  const { data: defaultIndentSize } = useDefaultIndentSize();
  return useSWRStatic<number, Error>(
    defaultIndentSize == null ? null : 'currentIndentSize',
    undefined,
    { fallbackData: defaultIndentSize },
  );
};

/*
* Slack Notification
*/
export const useSWRxSlackChannels = (currentPagePath: Nullable<string>): SWRResponse<string[], Error> => {
  const shouldFetch: boolean = currentPagePath != null;
  return useSWR(
    shouldFetch ? ['/pages.updatePost', currentPagePath] : null,
    ([endpoint, path]) => apiGet(endpoint, { path }).then((response: SlackChannels) => response.updatePost),
    {
      revalidateOnFocus: false,
      fallbackData: [''],
    },
  );
};

export const useIsSlackEnabled = (): SWRResponse<boolean, Error> => {
  return useSWRStatic(
    'isSlackEnabled',
    undefined,
    { fallbackData: false },
  );
};

export type IPageTagsForEditorsOption = {
  sync: (tags?: string[]) => void;
}

export const usePageTagsForEditors = (pageId: Nullable<string>): SWRResponse<string[], Error> & IPageTagsForEditorsOption => {
  const { data: tagsInfoData } = useSWRxTagsInfo(pageId);
  const swrResult = useSWRStatic<string[], Error>('pageTags', undefined);
  const { mutate } = swrResult;
  const sync = useCallback((): void => {
    mutate(tagsInfoData?.tags || [], false);
  }, [mutate, tagsInfoData?.tags]);

  return {
    ...swrResult,
    sync,
  };
};

export const useIsEnabledUnsavedWarning = (): SWRResponse<boolean, Error> => {
  return useSWRStatic<boolean, Error>('isEnabledUnsavedWarning');
};


export const useReservedNextCaretLine = (initialData?: number): SWRResponse<number> => {

  const swrResponse = useSWRStatic('saveNextCaretLine', initialData, { fallbackData: 0 });
  const { mutate } = swrResponse;

  useEffect(() => {
    const handler = (lineNumber: number) => {
      mutate(lineNumber);
    };

    globalEmitter.on('reservedNextCaretLine', handler);

    return function cleanup() {
      globalEmitter.removeListener('reservedNextCaretLine', handler);
    };
  }, [mutate]);

  return {
    ...swrResponse,
  };
};
