import React from 'react';
import { useTranslation } from 'react-i18next';

import { UncontrolledTooltip } from 'reactstrap';

type RenderTagLabelsProps = {
  tags: string[],
  isGuestUser: boolean,
  openEditorModal?: () => void,
}

const RenderTagLabels = React.memo((props: RenderTagLabelsProps) => {
  const { tags, isGuestUser, openEditorModal } = props;
  const { t } = useTranslation();

  function openEditorHandler() {
    if (openEditorModal == null) {
      return;
    }
    openEditorModal();
  }

  // activate suspense
  if (tags == null) {
    throw new Promise(() => {});
  }

  const isTagsEmpty = tags.length === 0;
  const tagElements = tags.map((tag) => {
    return (
      <a key={tag} href={`/_search?q=tag:${tag}`} className="grw-tag-label badge badge-secondary mr-2">
        {tag}
      </a>
    );
  });

  return (
    <>
      {tagElements}

      <div id="edit-tags-btn-wrapper-for-tooltip">
        <a
          className={`btn btn-link btn-edit-tags p-0 text-muted ${isTagsEmpty ? 'no-tags' : ''} ${isGuestUser ? 'disabled' : ''}`}
          onClick={openEditorHandler}
        >
          { isTagsEmpty && <>{ t('Add tags for this page') }</>}
          <i className="ml-1 icon-plus"></i>
        </a>
      </div>
      {isGuestUser && (
        <UncontrolledTooltip placement="top" target="edit-tags-btn-wrapper-for-tooltip" fade={false}>
          {t('Not available for guest')}
        </UncontrolledTooltip>
      )}
    </>
  );

});


export default RenderTagLabels;
