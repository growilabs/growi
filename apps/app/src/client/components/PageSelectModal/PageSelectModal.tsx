import type { FC, JSX } from 'react';
import {
  Suspense, useState, useCallback, useMemo,
} from 'react';

import nodePath from 'path';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter, Button,
} from 'reactstrap';
import SimpleBar from 'simplebar-react';

import type { IPageForItem } from '~/interfaces/page';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageData } from '~/states/page';
import { usePageSelectModalStatus, usePageSelectModalActions } from '~/states/ui/modal/page-select';

import { ItemsTree } from '../ItemsTree';
import ItemsTreeContentSkeleton from '../ItemsTree/ItemsTreeContentSkeleton';

import { TreeItemForModal } from './TreeItemForModal';

const PageSelectModalSubstance: FC = () => {
  const { close: closeModal } = usePageSelectModalActions();

  const [clickedParentPage, setClickedParentPage] = useState<IPageForItem | null>(null);
  const [isIncludeSubPage, setIsIncludeSubPage] = useState(true);

  const { t } = useTranslation();

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const currentPage = useCurrentPageData();
  const { opts } = usePageSelectModalStatus();

  const isHierarchicalSelectionMode = opts?.isHierarchicalSelectionMode ?? false;

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

  const { onSelected } = opts ?? {};
  const onClickDone = useCallback(() => {
    if (clickedParentPage != null) {
      onSelected?.(clickedParentPage, isIncludeSubPage);
    }

    closeModal();
  }, [clickedParentPage, closeModal, isIncludeSubPage, onSelected]);

  // Memoize heavy calculation
  const parentPagePath = useMemo(() => (
    pathUtils.addTrailingSlash(nodePath.dirname(currentPage?.path ?? ''))
  ), [currentPage?.path]);

  // Memoize target path calculation (avoid duplication)
  const targetPath = useMemo(() => (
    clickedParentPage?.path || parentPagePath
  ), [clickedParentPage?.path, parentPagePath]);

  // Memoize checkbox handler
  const handleIncludeSubPageChange = useCallback(() => {
    setIsIncludeSubPage(!isIncludeSubPage);
  }, [isIncludeSubPage]);

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
                targetPathOrId={targetPath}
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
              onChange={handleIncludeSubPageChange}
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
  const pageSelectModalData = usePageSelectModalStatus();
  const { close: closePageSelectModal } = usePageSelectModalActions();
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
