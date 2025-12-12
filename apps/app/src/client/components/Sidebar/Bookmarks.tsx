
import React, { type JSX } from 'react';

import { useTranslation } from 'react-i18next';

import { useIsGuestUser } from '~/states/context';

import { BookmarkContents } from './Bookmarks/BookmarkContents';

export const Bookmarks = () : JSX.Element => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();

  return (
    <div className="px-3">
      <div className="grw-sidebar-content-header">
        <h3 className="fs-6 fw-bold mb-0 py-4">{t('Bookmarks')}</h3>
      </div>
      {isGuestUser ? (
        <h4 className="fs-6">
          { t('Not available for guest') }
        </h4>
      ) : (
        <BookmarkContents />
      )}
    </div>
  );
};
