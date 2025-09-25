import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import ElasticsearchManagement from './ElasticsearchManagement/ElasticsearchManagement';

export const FullTextSearchManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div data-testid="admin-full-text-search">
      <h2 className="mb-4"> { t('full_text_search_management.elasticsearch_management') } </h2>
      <ElasticsearchManagement />
    </div>
  );
};
