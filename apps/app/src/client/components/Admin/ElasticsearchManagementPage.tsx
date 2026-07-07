import { type JSX, useEffect } from 'react';
import { useTranslation } from 'next-i18next';

import { AuditLogIndexManagement } from './AuditLogIndexManagement';
import ElasticsearchManagement from './ElasticsearchManagement/ElasticsearchManagement';

export const ElasticsearchManagementPage = (): JSX.Element => {
  const { t } = useTranslation('admin');

  // next/dynamic({ ssr: false }) means Next's own one-shot hash-scroll runs
  // before this mounts, so we scroll to the URL hash ourselves.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === '') return;
    document.getElementById(hash)?.scrollIntoView();
  }, []);

  return (
    <div data-testid="admin-elasticsearch-management">
      <h3 className="mb-4">
        {t('full_text_search_management.page_data_management')}
      </h3>
      <ElasticsearchManagement />

      <hr className="my-5" />

      {/* biome-ignore lint/correctness/useUniqueElementIds: stable id needed as a cross-page link target (AuditLogManagement.tsx links here); useId() output isn't a valid, page-load-stable URL fragment */}
      <h3 id="audit-log-index-management" className="mb-4">
        {t('audit_log_index_management.audit_log_index_management')}
      </h3>
      <AuditLogIndexManagement />
    </div>
  );
};
