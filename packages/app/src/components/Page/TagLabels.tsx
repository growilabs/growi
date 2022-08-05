import React, { FC, useState } from 'react';

import RenderTagLabels from './RenderTagLabels';
import TagEditModal from './TagEditModal';

import styles from './TagLabels.module.scss';

type Props = {
  tags?: string[],
  isGuestUser: boolean,
  tagsUpdateInvoked?: (tags: string[]) => Promise<void> | void,
}


const TagLabels:FC<Props> = (props: Props) => {
  const { tags, isGuestUser, tagsUpdateInvoked } = props;

  const [isTagEditModalShown, setIsTagEditModalShown] = useState(false);

  const openEditorModal = () => {
    setIsTagEditModalShown(true);
  };

  const closeEditorModal = () => {
    setIsTagEditModalShown(false);
  };

  return (
    <>
      <div className={`${styles['grw-tag-labels']} grw-tag-labels d-flex align-items-center`}>
        <i className="tag-icon icon-tag mr-2"></i>
        { tags == null
          ? (
            <span className="grw-tag-label badge badge-secondary">―</span>
          )
          : (
            <RenderTagLabels
              tags={tags}
              openEditorModal={openEditorModal}
              isGuestUser={isGuestUser}
            />
          )
        }
      </div>

      <TagEditModal
        tags={tags}
        isOpen={isTagEditModalShown}
        onClose={closeEditorModal}
        onTagsUpdated={tagsUpdateInvoked}
      />
    </>
  );
};

export default TagLabels;
