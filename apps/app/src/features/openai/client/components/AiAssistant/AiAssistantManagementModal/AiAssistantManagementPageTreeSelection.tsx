import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalBody } from 'reactstrap';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import {
  AiAssistantManagementModalPageMode,
  useAiAssistantManagementModalActions,
  useAiAssistantManagementModalStatus,
} from '../../../states/modal/ai-assistant-management';
import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { usePageTreeSelection } from './hooks/use-page-tree-selection';
import { PageTreeSelectionTree } from './PageTreeSelectionTree';
import { SelectedPagesPanel } from './SelectedPagesPanel';

import styles from './AiAssistantManagementPageTreeSelection.module.scss';

const moduleClass =
  styles['grw-ai-assistant-management-page-tree-selection'] ?? '';

type Props = {
  baseSelectedPages: SelectablePage[];
  updateBaseSelectedPages: (pages: SelectablePage[]) => void;
};

export const AiAssistantManagementPageTreeSelection = (
  props: Props,
): JSX.Element => {
  const { baseSelectedPages, updateBaseSelectedPages } = props;

  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const { changePageMode } = useAiAssistantManagementModalActions();
  const isNewAiAssistant =
    aiAssistantManagementModalData?.aiAssistantData == null;

  const {
    selectedPages,
    selectedPagesArray,
    initialCheckedItems,
    handleCheckedItemsChange,
    removePage,
  } = usePageTreeSelection(baseSelectedPages);

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

        <div className="px-4">
          <PageTreeSelectionTree
            isEnableActions={!isGuestUser}
            isReadOnlyUser={!!isReadOnlyUser}
            initialCheckedItems={initialCheckedItems}
            onCheckedItemsChange={handleCheckedItemsChange}
          />
        </div>

        <SelectedPagesPanel
          pages={selectedPagesArray}
          onRemovePage={removePage}
        />

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
