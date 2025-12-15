import React, {
  useState, useCallback, useEffect, useMemo,
} from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { useUpdateStateAfterSave } from '~/client/services/page-operation';
import { apiPost } from '~/client/util/apiv1-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useTagEditModalStatus, useTagEditModalActions, type TagEditModalStatus } from '~/states/ui/modal/tag-edit';
import { useSWRxTagsInfo } from '~/stores/page';

import { TagsInput } from './TagsInput';

type TagEditModalSubstanceProps = {
  tagEditModalData: TagEditModalStatus,
  closeTagEditModal: () => void,
}

const TagEditModalSubstance: React.FC<TagEditModalSubstanceProps> = (props: TagEditModalSubstanceProps) => {
  const { tagEditModalData, closeTagEditModal } = props;
  const { t } = useTranslation();

  const initTags = tagEditModalData.tags;
  const isOpen = tagEditModalData.isOpen;
  const pageId = tagEditModalData.pageId;
  const revisionId = tagEditModalData.revisionId;
  const updateStateAfterSave = useUpdateStateAfterSave(pageId);
  const { mutate: mutateTags } = useSWRxTagsInfo(pageId);
  const [tags, setTags] = useState<string[]>(initTags ?? []);

  // use to take initTags when redirect to other page
  useEffect(() => {
    setTags(initTags);
  }, [initTags]);

  // Memoized API request data
  const updateTagsData = useMemo(() => ({
    pageId,
    revisionId,
    tags,
  }), [pageId, revisionId, tags]);

  const handleSubmit = useCallback(async() => {
    try {
      await apiPost('/tags.update', updateTagsData);
      mutateTags();
      updateStateAfterSave?.();

      toastSuccess('updated tags successfully');
      closeTagEditModal();
    }
    catch (err) {
      toastError(err);
    }
  }, [updateTagsData, mutateTags, updateStateAfterSave, closeTagEditModal]);

  // Memoized tags update handler
  const handleTagsUpdate = useCallback((newTags: string[]) => {
    setTags(newTags);
  }, []);

  return (
    <Modal isOpen={isOpen} toggle={closeTagEditModal} id="edit-tag-modal" autoFocus={false}>
      <ModalHeader tag="h4" toggle={closeTagEditModal}>
        {t('tag_edit_modal.edit_tags')}
      </ModalHeader>
      <ModalBody>
        <TagsInput tags={tags} onTagsUpdated={handleTagsUpdate} autoFocus />
      </ModalBody>
      <ModalFooter>
        <button type="button" data-testid="tag-edit-done-btn" className="btn btn-primary" onClick={handleSubmit}>
          {t('tag_edit_modal.done')}
        </button>
      </ModalFooter>
    </Modal>
  );

};

export const TagEditModal: React.FC = () => {
  const tagEditModalData = useTagEditModalStatus();
  const { close: closeTagEditModal } = useTagEditModalActions();

  if (!tagEditModalData?.isOpen) {
    return <></>;
  }

  return <TagEditModalSubstance tagEditModalData={tagEditModalData} closeTagEditModal={closeTagEditModal} />;
};
