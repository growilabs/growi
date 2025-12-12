import type { FC, JSX } from 'react';
import {
  Suspense, useState, useCallback, useMemo,
} from 'react';

import { useTranslation } from 'next-i18next';
import { dirname } from 'pathe';
import {
  Modal, ModalHeader, ModalBody, ModalFooter, Button,
} from 'reactstrap';

import { ItemsTree } from '~/features/page-tree/components';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageData } from '~/states/page';
import {
  usePageSelectModalStatus,
  usePageSelectModalActions,
  useSelectedPageInModal,
} from '~/states/ui/modal/page-select';

import ItemsTreeContentSkeleton from '../ItemsTree/ItemsTreeContentSkeleton';

import { TreeItemForModal, treeItemForModalSize } from './TreeItemForModal';

const PageSelectModalSubstance: FC = () => {
  const { close: closeModal } = usePageSelectModalActions();

  const [isIncludeSubPage, setIsIncludeSubPage] = useState(true);
  const [scrollerElem, setScrollerElem] = useState<HTMLDivElement | null>(null);

  // Callback ref to capture the scroller element and trigger re-render
  const scrollerRefCallback = useCallback((node: HTMLDivElement | null) => {
    setScrollerElem(node);
  }, []);

  const { t } = useTranslation();

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const currentPage = useCurrentPageData();
  const { opts } = usePageSelectModalStatus();

  // Get selected page from atom
  const selectedPage = useSelectedPageInModal();

  const isHierarchicalSelectionMode = opts?.isHierarchicalSelectionMode ?? false;

  const onClickCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const { onSelected } = opts ?? {};
  const onClickDone = useCallback(() => {
    if (selectedPage != null) {
      onSelected?.(selectedPage, isIncludeSubPage);
    }

    closeModal();
  }, [selectedPage, closeModal, isIncludeSubPage, onSelected]);

  // Memoize heavy calculation - parent page path without trailing slash for matching
  const parentPagePath = useMemo(() => {
    const dn = dirname(currentPage?.path ?? '');
    // Ensure root path is '/' not ''
    return dn === '' ? '/' : dn;
  }, [currentPage?.path]);

  // Memoize target path calculation
  const targetPath = useMemo(() => (
    selectedPage?.path || parentPagePath
  ), [selectedPage?.path, parentPagePath]);

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
          {/* 133px = 63px(ModalHeader) + 70px(ModalFooter) */}
          <div
            ref={scrollerRefCallback}
            className="p-3"
            style={{ maxHeight: 'calc(85vh - 133px)', overflowY: 'auto' }}
          >
            {scrollerElem && (
              <ItemsTree
                CustomTreeItem={TreeItemForModal}
                isEnableActions={!isGuestUser}
                isReadOnlyUser={!!isReadOnlyUser}
                targetPath={targetPath}
                targetPathOrId={targetPath}
                estimateTreeItemSize={() => treeItemForModalSize}
                scrollerElem={scrollerElem}
              />
            )}
          </div>
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
