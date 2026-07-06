import React, { type JSX } from 'react';
import { useTranslation } from 'next-i18next';

import { AuditLogIndexManagement } from './AuditLogIndexManagement';
import ElasticsearchManagement from './ElasticsearchManagement/ElasticsearchManagement';

export const ElasticsearchManagementPage = (): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div data-testid="admin-elasticsearch-management">
      <h3 className="mb-4">
        {t('full_text_search_management.page_data_management')}
      </h3>
      <ElasticsearchManagement />

      <hr className="my-5" />

      <h3 className="mb-4">
        {t('audit_log_index_management.audit_log_index_management')}
      </h3>
      <AuditLogIndexManagement />
    </div>
  );
};
