import React, { type JSX, useEffect, useRef, useState } from 'react';
import type { IRevisionHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { useSWRxInfinitePageRevisions } from '~/stores/page';

import { RevisionComparer } from '../RevisionComparer/RevisionComparer';
import { Revision } from './Revision';

import styles from './PageRevisionTable.module.scss';

type PageRevisionTableProps = {
  sourceRevisionId?: string;
  targetRevisionId?: string;
  onClose: () => void;
  currentPageId: string;
  currentPagePath: string;
};

export const PageRevisionTable = (
  props: PageRevisionTableProps,
): JSX.Element => {
  const { t } = useTranslation();

  const REVISIONS_PER_PAGE = 10;

  const {
    sourceRevisionId,
    targetRevisionId,
    onClose,
    currentPageId,
    currentPagePath,
  } = props;

  // Load all data if source revision id and target revision id not null
  const revisionPerPage =
    sourceRevisionId != null && targetRevisionId != null
      ? 0
      : REVISIONS_PER_PAGE;
  const swrInifiniteResponse = useSWRxInfinitePageRevisions(
    currentPageId,
    revisionPerPage,
  );

  const { data, size, error, setSize, isValidating } = swrInifiniteResponse;

  const revisions = data?.[0].revisions;
  const oldestRevision = revisions?.[revisions.length - 1];

  // First load
  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    isLoadingInitialData ||
    (isValidating && data != null && typeof data[size - 1] === 'undefined');
  const isReachingEnd =
    revisionPerPage === 0 ||
    !!(
      data != null &&
      data[data.length - 1]?.revisions.length < REVISIONS_PER_PAGE
    );

  const [sourceRevision, setSourceRevision] = useState<IRevisionHasId>();
  const [targetRevision, setTargetRevision] = useState<IRevisionHasId>();

  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (revisions != null) {
      // when both source and target are specified
      if (sourceRevisionId != null && targetRevisionId != null) {
        const sourceRevision = revisions.filter(
          (revision) => revision._id === sourceRevisionId,
        )[0];
        const targetRevision = revisions.filter(
          (revision) => revision._id === targetRevisionId,
        )[0];
        setSourceRevision(sourceRevision);
        setTargetRevision(targetRevision);
      } else {
        const latestRevision = revisions != null ? revisions[0] : undefined;
        const previousRevision =
          revisions.length >= 2 ? revisions[1] : latestRevision;
        setTargetRevision(latestRevision);
        setSourceRevision(previousRevision);
      }
    }
  }, [revisions, sourceRevisionId, targetRevisionId]);

  useEffect(() => {
    // Apply ref to tbody
    const tbody = tbodyRef.current;
    const handleScroll = () => {
      const offset = 30; // Threshold before scroll actually reaching the end
      if (tbody) {
        // Scroll end
        const isEnd =
          tbody.scrollTop + tbody.clientHeight + offset >= tbody.scrollHeight;
        if (isEnd && !isLoadingMore && !isReachingEnd) {
          setSize(size + 1);
        }
      }
    };
    if (tbody) {
      tbody.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (tbody) {
        tbody.removeEventListener('scroll', handleScroll);
      }
    };
  }, [isLoadingMore, isReachingEnd, setSize, size]);

  const renderRow = (
    revision: IRevisionHasId,
    previousRevision: IRevisionHasId,
    latestRevision: IRevisionHasId,
    isOldestRevision: boolean,
    hasDiff: boolean,
  ) => {
    const revisionId = revision._id;

    const handleCompareLatestRevisionButton = () => {
      setSourceRevision(revision);
      setTargetRevision(latestRevision);
    };

    const handleComparePreviousRevisionButton = () => {
      setSourceRevision(previousRevision);
      setTargetRevision(revision);
    };

    return (
      <tr className="d-flex" key={`revision-history-${revisionId}`}>
        <td className="col" key={`revision-history-top-${revisionId}`}>
          <div className="d-lg-flex">
            <Revision
              revision={revision}
              isLatestRevision={revision === latestRevision}
              hasDiff={hasDiff}
              currentPageId={currentPageId}
              currentPagePath={currentPagePath}
              key={`revision-history-rev-${revisionId}`}
              onClose={onClose}
            />
            {hasDiff && (
              <div className="ms-md-3 mt-auto">
                <div className="btn-group">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleCompareLatestRevisionButton}
                  >
                    {t('page_history.compare_latest')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleComparePreviousRevisionButton}
                    disabled={isOldestRevision}
                  >
                    {t('page_history.compare_previous')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </td>
        <td className="col-1">
          <div className="form-check form-check-inline me-0">
            <input
              type="radio"
              className="form-check-input"
              id={`compareSource-${revisionId}`}
              name="compareSource"
              value={revisionId}
              checked={revisionId === sourceRevision?._id}
              onChange={() => setSourceRevision(revision)}
            />
          </div>
        </td>
        <td className="col-2">
          <div className="form-check form-check-inline me-0">
            <input
              type="radio"
              className="form-check-input"
              id={`compareTarget-${revisionId}`}
              name="compareTarget"
              value={revisionId}
              checked={revisionId === targetRevision?._id}
              onChange={() => setTargetRevision(revision)}
            />
          </div>
        </td>
      </tr>
    );
  };

  return (
    <>
      <table
        className={`${styles['revision-history-table']} table revision-history-table`}
      >
        <thead>
          <tr className="d-flex">
            <th className="col">{t('page_history.revision')}</th>
            <th className="col-1">{t('page_history.comparing_source')}</th>
            <th className="col-2">{t('page_history.comparing_target')}</th>
          </tr>
        </thead>
        <tbody className="overflow-auto d-block" ref={tbodyRef}>
          {revisions != null &&
            data != null &&
            data
              .flatMap((apiResult) => apiResult.revisions)
              .map((revision, idx) => {
                const previousRevision =
                  idx + 1 < revisions?.length ? revisions[idx + 1] : revision;

                const isOldestRevision = revision === oldestRevision;
                const latestRevision = revisions[0];

                // set 'true' if undefined for backward compatibility
                const hasDiff = revision.hasDiffToPrev !== false;
                return renderRow(
                  revision,
                  previousRevision,
                  latestRevision,
                  isOldestRevision,
                  hasDiff,
                );
              })}
        </tbody>
      </table>

      {sourceRevision != null && targetRevision != null && (
        <div className="mt-5">
          <RevisionComparer
            sourceRevision={sourceRevision}
            targetRevision={targetRevision}
            currentPageId={currentPageId}
            currentPagePath={currentPagePath}
            onClose={onClose}
          />
        </div>
      )}
    </>
  );
};
