import React, { type JSX } from 'react';
import Link from 'next/link';
import type { IRevisionHasId } from '@growi/core';
import { returnPathForURL } from '@growi/core/dist/utils/path-utils';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import urljoin from 'url-join';

import UserDate from '../../../components/User/UserDate';
import { Username } from '../../../components/User/Username';

import styles from './Revision.module.scss';

type RevisionProps = {
  revision: IRevisionHasId;
  isLatestRevision: boolean;
  hasDiff: boolean;
  currentPageId: string;
  currentPagePath: string;
  onClose: () => void;
};

export const Revision = (props: RevisionProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    revision,
    isLatestRevision,
    hasDiff,
    onClose,
    currentPageId,
    currentPagePath,
  } = props;

  const renderSimplifiedNodiff = (revision: IRevisionHasId) => {
    const author = revision.author;

    const pic =
      typeof author === 'object' ? (
        <UserPicture user={author} size="sm" />
      ) : (
        <></>
      );

    return (
      <div
        className={`${styles['revision-history-main']} ${styles['revision-history-main-nodiff']}
        revision-history-main revision-history-main-nodiff my-1 flex-grow-1 d-flex`}
      >
        <div className="d-flex align-items-center">
          <div className="picture-container">{pic}</div>
          <div className="ms-2">
            <span className="text-muted small">
              <UserDate dateTime={revision.createdAt} />
            </span>
          </div>
        </div>
        <div className="flex-grow-1 text-center">
          <span className="text-muted small">{t('No diff')}</span>
        </div>
      </div>
    );
  };

  const renderFull = (revision: IRevisionHasId) => {
    const author = revision.author;

    const pic =
      typeof author === 'object' ? (
        <UserPicture user={author} size="lg" />
      ) : (
        <></>
      );

    return (
      <div
        className={`${styles['revision-history-main']} revision-history-main d-flex`}
      >
        <div className="picture-container">{pic}</div>
        <div className="ms-2">
          <div className="revision-history-author mb-1">
            <strong>
              <Username user={author} />
            </strong>
            {isLatestRevision && (
              <span className="badge bg-info ms-2">{t('Latest')}</span>
            )}
          </div>
          <div className="mb-1">
            <UserDate dateTime={revision.createdAt} />
            <br className="d-xl-none d-block" />
            <Link
              href={urljoin(
                returnPathForURL(currentPagePath, currentPageId),
                `?revisionId=${revision._id}`,
              )}
              className="ms-xl-3"
              onClick={onClose}
              prefetch={false}
            >
              <span className="material-symbols-outlined">login</span>{' '}
              {t('Go to this version')}
            </Link>
          </div>
        </div>
      </div>
    );
  };

  if (!hasDiff) {
    return renderSimplifiedNodiff(revision);
  }

  return renderFull(revision);
};
