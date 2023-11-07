import React from 'react';

import { useTranslation } from 'next-i18next';

import { useKeywordManager } from '~/client/services/search-operation';

import { NotAvailableForGuest } from '../NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '../NotAvailableForReadOnlyUser';

type RenderTagLabelsProps = {
  tags: string[],
  isTagLabelsDisabled: boolean,
  onClickEditTagsButton: () => void,
}

const RenderTagLabels = React.memo((props: RenderTagLabelsProps) => {
  const {
    tags, isTagLabelsDisabled, onClickEditTagsButton,
  } = props;
  const { t } = useTranslation();

  const { pushState } = useKeywordManager();

  const isTagsEmpty = tags.length === 0;

  return (
    <>
      {tags.map((tag) => {
        return (
          <a
            key={tag}
            type="button"
            className="grw-tag-label badge bg-primary me-2"
            onClick={() => pushState(`tag:${tag}`)}
          >
            {tag}
          </a>
        );
      })}
      <NotAvailableForGuest>
        <NotAvailableForReadOnlyUser>
          <div id="edit-tags-btn-wrapper-for-tooltip" className="d-print-none">
            <a
              className={
                `btn btn-link btn-edit-tags text-muted d-flex align-items-center
                ${isTagsEmpty && 'no-tags'}
                ${isTagLabelsDisabled && 'disabled'}`
              }
              onClick={onClickEditTagsButton}
            >
              {isTagsEmpty && <>{ t('Add tags for this page') }</>}
              <i className={`icon-plus ${isTagsEmpty && 'ms-1'}`} />
            </a>
          </div>
        </NotAvailableForReadOnlyUser>
      </NotAvailableForGuest>
    </>

  );

});

RenderTagLabels.displayName = 'RenderTagLabels';

export default RenderTagLabels;
