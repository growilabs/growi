import type { FC, JSX } from 'react';
import React, { useState } from 'react';

import { useTranslation } from 'next-i18next';

import { NotAvailableForGuest } from '../NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '../NotAvailableForReadOnlyUser';
import { Skeleton } from '../Skeleton';

import RenderTagLabels from './RenderTagLabels';

import styles from './TagLabels.module.scss';

type Props = {
  tags?: string[],
  isTagLabelsDisabled: boolean,
  tagsUpdateInvoked?: (tags: string[]) => Promise<void> | void,
  onClickEditTagsButton: () => void,
}

export const PageTagsSkeleton = (): JSX.Element => {
  return <Skeleton additionalClass={`${styles['grw-tag-labels-skeleton']} mb-2`} />;
};

export const PageTags:FC<Props> = (props: Props) => {
  const {
    tags, isTagLabelsDisabled, onClickEditTagsButton,
  } = props;
  const [isHovered, setIsHovered] = useState(false);
  const { t } = useTranslation();

  if (tags == null) {
    return <></>;
  }

  const printNoneClass = tags.length === 0 ? 'd-print-none' : '';

  const onMouseEnterHandler = () => setIsHovered(true);
  const onMouseLeaveHandler = () => setIsHovered(false);

  return (
    <div className={`${styles['grw-tag-labels']} grw-tag-labels d-flex align-items-center mb-2 ${printNoneClass}`} data-testid="grw-tag-labels">

      {/* for mobile */}
      <div className="d-flex d-lg-none">
        <NotAvailableForGuest>
          <NotAvailableForReadOnlyUser>
            <button
              type="button"
              className={`btn btn-edit-tags btn-outline-neutral-secondary rounded-pill ${styles['grw-tag-icon-button']}`}
              onClick={onClickEditTagsButton}
            >
              <span className="material-symbols-outlined">local_offer</span>
            </button>
          </NotAvailableForReadOnlyUser>
        </NotAvailableForGuest>
      </div>

      {/* for PC */}
      <div className="d-none d-lg-flex row">
        <div className="mb-2">
          <button
            id="edit-tags-btn-wrapper-for-tooltip"
            type="button"
            className="btn btn-link btn-edit-tags text-secondary p-0 border-0"
            onMouseEnter={onMouseEnterHandler}
            onMouseLeave={onMouseLeaveHandler}
            onClick={onClickEditTagsButton}
            disabled={isTagLabelsDisabled}
          >
            <span className="material-symbols-outlined me-1">local_offer</span>
            <span className="me-2">{t('Tags')}</span>
            {(isHovered && !isTagLabelsDisabled) && (
              <span className="material-symbols-outlined p-0">edit</span>
            )}
          </button>
        </div>
        <div>
          <RenderTagLabels tags={tags} />
        </div>
      </div>
    </div>
  );
};
