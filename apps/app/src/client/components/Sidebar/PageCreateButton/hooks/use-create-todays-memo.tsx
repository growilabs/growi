import { useCallback } from 'react';

import { Origin } from '@growi/core';
import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';
import { format } from 'date-fns/format';
import { useTranslation } from 'react-i18next';

import { useCreatePage } from '~/client/services/create-page';
import { useCurrentUser } from '~/states/global';


type UseCreateTodaysMemo = () => {
  isCreating: boolean,
  todaysPath: string | null,
  createTodaysMemo: () => Promise<void>,
}

export const useCreateTodaysMemo: UseCreateTodaysMemo = () => {
  const { t } = useTranslation('commons');

  const currentUser = useCurrentUser();
  const { isCreating, create } = useCreatePage();

  const isCreatable = currentUser != null;

  const parentDirName = t('create_page_dropdown.todays.memo');
  const now = format(new Date(), 'yyyy/MM/dd');
  const parentPath = `${userHomepagePath(currentUser)}/${parentDirName}`;
  const todaysPath = isCreatable
    ? `${parentPath}/${now}`
    : null;

  const createTodaysMemo = useCallback(async() => {
    if (!isCreatable || todaysPath == null) return;

    return create(
      {
        path: todaysPath, parentPath, wip: true, origin: Origin.View,
      },
    );
  }, [create, isCreatable, todaysPath, parentPath]);

  return {
    isCreating,
    todaysPath,
    createTodaysMemo,
  };
};
