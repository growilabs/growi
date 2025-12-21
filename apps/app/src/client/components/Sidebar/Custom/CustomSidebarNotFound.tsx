import { type JSX, useCallback } from 'react';
import { Origin } from '@growi/core';
import { useTranslation } from 'react-i18next';

import { useCreatePage } from '~/client/services/create-page';

export const SidebarNotFound = (): JSX.Element => {
  const { t } = useTranslation();

  const { create } = useCreatePage();

  const clickCreateButtonHandler = useCallback(async () => {
    create(
      { path: '/Sidebar', wip: false, origin: Origin.View },
      { skipPageExistenceCheck: true },
    );
  }, [create]);

  return (
    <div>
      <button
        type="button"
        className="btn btn-lg btn-link"
        onClick={clickCreateButtonHandler}
      >
        <span className="material-symbols-outlined">edit_note</span>
        <span>{t('Create Sidebar Page')}</span>
      </button>
    </div>
  );
};
