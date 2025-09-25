import type { FC, JSX } from 'react';
import {
  Suspense, useState, useCallback,
} from 'react';

import nodePath from 'path';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter, Button,
} from 'reactstrap';
import SimpleBar from 'simplebar-react';

import type { IPageForItem } from '~/interfaces/page';
import { useIsGuestUser, useIsReadOnlyUser } from '~/stores-universal/context';
import { usePageSelectModal } from '~/stores/modal';
import { useSWRxCurrentPage } from '~/stores/page';

import { ItemsTree } from '../ItemsTree';
import ItemsTreeContentSkeleton from '../ItemsTree/ItemsTreeContentSkeleton';

import { TreeItemForModal } from './TreeItemForModal';

const PageSelectModalSubstance: FC = () => {
  const {
    data: PageSelectModalData,
    close: closeModal,
  } = usePageSelectModal();

  const [clickedParentPage, setClickedParentPage] = useState<IPageForItem | null>(null);
  const [isIncludeSubPage, setIsIncludeSubPage] = useState(true);

  const { t } = useTranslation();

  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: currentPage } = useSWRxCurrentPage();
  const { data: pageSelectModalData } = usePageSelectModal();

  const isHierarchicalSelectionMode = pageSelectModalData?.opts?.isHierarchicalSelectionMode ?? false;

  const onClickTreeItem = useCallback((page: IPageForItem) => {
    const parentPagePath = page.path;

    if (parentPagePath == null) {
      return;
    }

    setClickedParentPage(page);
  }, []);

  const onClickCancel = useCallback(() => {
    setClickedParentPage(null);
    closeModal();
  }, [closeModal]);

  const onClickDone = useCallback(() => {
    if (clickedParentPage != null) {
      PageSelectModalData?.opts?.onSelected?.(clickedParentPage, isIncludeSubPage);
    }

    closeModal();
  }, [PageSelectModalData?.opts, clickedParentPage, closeModal, isIncludeSubPage]);

  const parentPagePath = pathUtils.addTrailingSlash(nodePath.dirname(currentPage?.path ?? ''));

  const targetPathOrId = clickedParentPage?.path || parentPagePath;

  const targetPath = clickedParentPage?.path || parentPagePath;

  if (isGuestUser == null) {
    return <></>;
  }

  return (
    <>
      <ModalHeader toggle={closeModal}>{t('page_select_modal.select_page_location')}</ModalHeader>
      <ModalBody className="p-0">
        <Suspense fallback={<ItemsTreeContentSkeleton />}>
          <SimpleBar style={{ maxHeight: 'calc(85vh - 133px)' }}> {/* 133px = 63px(ModalHeader) + 70px(ModalFooter) */}
            <div className="p-3">
              <ItemsTree
                CustomTreeItem={TreeItemForModal}
                isEnableActions={!isGuestUser}
                isReadOnlyUser={!!isReadOnlyUser}
                targetPath={targetPath}
                targetPathOrId={targetPathOrId}
                onClickTreeItem={onClickTreeItem}
              />
            </div>
          </SimpleBar>
        </Suspense>
      </ModalBody>
      <ModalFooter className="border-top d-flex flex-column">
        { isHierarchicalSelectionMode && (
          <div className="form-check form-check-info align-self-start ms-4">
            <input
              type="checkbox"
              id="includeSubPages"
              className="form-check-input"
              name="fileUpload"
              checked={isIncludeSubPage}
              onChange={() => setIsIncludeSubPage(!isIncludeSubPage)}
            />
            <label
              className="form-label form-check-label"
              htmlFor="includeSubPages"
            >
              {t('Include Subordinated Page')}
            </label>
          </div>
        )}
        <div className="d-flex gap-2 align-self-end">
          <Button color="secondary" onClick={onClickCancel}>{t('Cancel')}</Button>
          <Button color="primary" onClick={onClickDone}>{t('Done')}</Button>
        </div>
      </ModalFooter>
    </>
  );
};

export const PageSelectModal = (): JSX.Element => {
  const { data: pageSelectModalData, close: closePageSelectModal } = usePageSelectModal();
  const isOpen = pageSelectModalData?.isOpened ?? false;

  if (!isOpen) {
    return <></>;
  }

  return (
    <Modal isOpen={isOpen} toggle={closePageSelectModal} centered>
      <PageSelectModalSubstance />
    </Modal>
  );
};
