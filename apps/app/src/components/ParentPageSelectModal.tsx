Fimport React, { FC } from 'react';

import {
  Modal, ModalHeader, ModalBody, ModalFooter, Button,
} from 'reactstrap';

import { useTargetAndAncestors, useIsGuestUser, useIsReadOnlyUser } from '~/stores/context';
import { useParentPageSelectModal } from '~/stores/modal';
import { useCurrentPagePath, useCurrentPageId } from '~/stores/page';
import { useSWRxV5MigrationStatus } from '~/stores/page-listing';

import ItemsTree from './Sidebar/PageTree/ItemsTree';
import { PageTreeItemForModal } from './Sidebar/PageTree/PageTreeItemForModal';


export const ParentPageSelectModal = () => {
  const {
    data: parentPageSelectModalData,
    close: closeModal,
  } = useParentPageSelectModal();

  const isOpened = parentPageSelectModalData?.isOpened ?? false;

  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: currentPath } = useCurrentPagePath();
  const { data: targetId } = useCurrentPageId();
  const { data: targetAndAncestorsData } = useTargetAndAncestors();
  const { data: migrationStatus } = useSWRxV5MigrationStatus();

  const targetPathOrId = targetId || currentPath;

  if (isGuestUser == null) {
    return null;
  }

  const path = currentPath || '/';

  return (
    <Modal
      isOpen={isOpened}
      toggle={() => closeModal()}
      centered={true}
    >
      <ModalHeader toggle={() => closeModal()}>modal</ModalHeader>
      <ModalBody >
        <ItemsTree
          CustomTreeItem={PageTreeItemForModal}
          isEnableActions={!isGuestUser}
          isReadOnlyUser={!!isReadOnlyUser}
          targetPath={path}
          targetPathOrId={targetPathOrId}
          targetAndAncestorsData={targetAndAncestorsData}
        />
      </ModalBody>
      <ModalFooter>
        <Button color="primary">
        Do Something
        </Button>{' '}
        <Button color="secondary">
        Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};
