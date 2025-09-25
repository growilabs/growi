import type { FC } from 'react';
import React from 'react';

import { useTranslation } from 'next-i18next';

export const NotCreatablePage: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="row not-found-message-row">
      <div className="col-md-12">
        <h2 className="text-muted">
          <span className="material-symbols-outlined" aria-hidden="true">block</span>
          { t('not_creatable_page.message') }
        </h2>
      </div>
    </div>
  );
};
