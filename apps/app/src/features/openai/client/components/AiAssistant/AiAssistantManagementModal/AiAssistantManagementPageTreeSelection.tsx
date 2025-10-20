import React, { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalBody } from 'reactstrap';
import SimpleBar from 'simplebar-react';

import { ItemsTree } from '~/client/components/ItemsTree';
import ItemsTreeContentSkeleton from '~/client/components/ItemsTree/ItemsTreeContentSkeleton';
import type { TreeItemProps } from '~/client/components/TreeItem';
import { TreeItemLayout } from '~/client/components/TreeItem';
import type { IPageForItem } from '~/interfaces/page';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';

import {
  isSelectablePage,
  type SelectablePage,
} from '../../../../interfaces/selectable-page';
import { useSelectedPages } from '../../../services/use-selected-pages';
import {
  AiAssistantManagementModalPageMode,
  useAiAssistantManagementModalActions,
  useAiAssistantManagementModalStatus,
} from '../../../states/modal/ai-assistant-management';
import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { SelectablePageList } from './SelectablePageList';

import styles from './AiAssistantManagementPageTreeSelection.module.scss';

const moduleClass =
  styles['grw-ai-assistant-management-page-tree-selection'] ?? '';

const SelectablePageTree = memo(
  (props: { onClickAddPageButton: (page: SelectablePage) => void }) => {
    const { onClickAddPageButton } = props;

    const isGuestUser = useIsGuestUser();
    const isReadOnlyUser = useIsReadOnlyUser();

    const pageTreeItemClickHandler = useCallback(
      (page: IPageForItem) => {
        if (!isSelectablePage(page)) {
          return;
        }

        onClickAddPageButton(page);
      },
      [onClickAddPageButton],
    );

    const SelectPageButton = useCallback(
      ({ page }: { page: IPageForItem }) => {
        return (
          <button
            type="button"
            className="border-0 rounded btn p-0"
            onClick={(e) => {
              e.stopPropagation();
              pageTreeItemClickHandler(page);
            }}
          >
            <span className="material-symbols-outlined p-0 me-2 text-primary">
              add_circle
            </span>
          </button>
        );
      },
      [pageTreeItemClickHandler],
    );

    const PageTreeItem = useCallback(
      (props: TreeItemProps) => {
        const { itemNode } = props;
        const { page } = itemNode;

        return (
          <TreeItemLayout
            {...props}
            itemClass={PageTreeItem}
            className="text-muted"
            customHoveredEndComponents={[
              () => <SelectPageButton page={page} />,
            ]}
          />
        );
      },
      [SelectPageButton],
    );

    return (
      <div className="page-tree-item">
        <ItemsTree
          targetPath="/"
          isEnableActions={!isGuestUser}
          isReadOnlyUser={!!isReadOnlyUser}
          CustomTreeItem={PageTreeItem}
        />
      </div>
    );
  },
);

type Props = {
  baseSelectedPages: SelectablePage[];
  updateBaseSelectedPages: (pages: SelectablePage[]) => void;
};

export const AiAssistantManagementPageTreeSelection = (
  props: Props,
): JSX.Element => {
  const { baseSelectedPages, updateBaseSelectedPages } = props;

  const { t } = useTranslation();
  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const { changePageMode } = useAiAssistantManagementModalActions();
  const isNewAiAssistant =
    aiAssistantManagementModalData?.aiAssistantData == null;

  const {
    selectedPages,
    selectedPagesRef,
    selectedPagesArray,
    addPage,
    removePage,
  } = useSelectedPages(baseSelectedPages);

  const addPageButtonClickHandler = useCallback(
    (page: SelectablePage) => {
      const pagePathWithGlob = `${page.path}/*`;
      if (
        selectedPagesRef.current == null ||
        selectedPagesRef.current.has(pagePathWithGlob)
      ) {
        return;
      }

      const clonedPage = { ...page };
      clonedPage.path = pagePathWithGlob;

      addPage(clonedPage);
    },
    [
      addPage,
      selectedPagesRef, // Prevent flickering (use ref to avoid method recreation)
    ],
  );

  const nextButtonClickHandler = useCallback(() => {
    updateBaseSelectedPages(Array.from(selectedPages.values()));
    changePageMode(
      isNewAiAssistant
        ? AiAssistantManagementModalPageMode.HOME
        : AiAssistantManagementModalPageMode.PAGES,
    );
  }, [
    changePageMode,
    isNewAiAssistant,
    selectedPages,
    updateBaseSelectedPages,
  ]);

  return (
    <div className={moduleClass}>
      <AiAssistantManagementHeader
        backButtonColor="secondary"
        backToPageMode={
          baseSelectedPages.length === 0
            ? AiAssistantManagementModalPageMode.PAGE_SELECTION_METHOD
            : AiAssistantManagementModalPageMode.PAGES
        }
        labelTranslationKey={
          isNewAiAssistant
            ? 'modal_ai_assistant.header.add_new_assistant'
            : 'modal_ai_assistant.header.update_assistant'
        }
      />

      <ModalBody className="px-4">
        <h4 className="text-center fw-bold mb-3 mt-2">
          {t('modal_ai_assistant.search_reference_pages_by_keyword')}
        </h4>

        <Suspense fallback={<ItemsTreeContentSkeleton />}>
          <div className="px-4">
            <SelectablePageTree
              onClickAddPageButton={addPageButtonClickHandler}
            />
          </div>
        </Suspense>

        <h4 className="text-center fw-bold mb-3 mt-4">
          {t('modal_ai_assistant.reference_pages')}
        </h4>

        <div className="px-4">
          <SimpleBar
            className="page-list-container"
            style={{ maxHeight: '300px' }}
          >
            <SelectablePageList
              method="remove"
              methodButtonPosition="right"
              pages={selectedPagesArray}
              onClickMethodButton={removePage}
            />
          </SimpleBar>
          <span className="form-text text-muted mt-2">
            {t('modal_ai_assistant.can_add_later')}
          </span>
        </div>

        <div className="d-flex justify-content-center mt-4">
          <button
            type="button"
            className="btn btn-primary rounded next-button"
            disabled={selectedPages.size === 0}
            onClick={nextButtonClickHandler}
          >
            {t('modal_ai_assistant.next')}
          </button>
        </div>
      </ModalBody>
    </div>
  );
};
