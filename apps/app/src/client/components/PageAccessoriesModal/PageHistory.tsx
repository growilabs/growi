import type React from 'react';

import { useCurrentPageId, useCurrentPagePath } from '~/states/page/index.js';
import loggerFactory from '~/utils/logger/index.js';

import { PageRevisionTable } from '../PageHistory/PageRevisionTable.js';
import { useAutoComparingRevisionsByQueryParam } from './hooks.js';

const logger = loggerFactory('growi:PageHistory');

type PageHistoryProps = {
  onClose: () => void;
};

export const PageHistory: React.FC<PageHistoryProps> = (
  props: PageHistoryProps,
) => {
  const { onClose } = props;

  const currentPageId = useCurrentPageId();
  const currentPagePath = useCurrentPagePath();

  const comparingRevisions = useAutoComparingRevisionsByQueryParam();

  return (
    <div className="revision-history" data-testid="page-history">
      {currentPageId != null && currentPagePath != null && (
        <PageRevisionTable
          sourceRevisionId={comparingRevisions?.sourceRevisionId}
          targetRevisionId={comparingRevisions?.targetRevisionId}
          currentPageId={currentPageId}
          currentPagePath={currentPagePath}
          onClose={onClose}
        />
      )}
    </div>
  );
};
