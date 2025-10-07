import React, {
  useRef, useMemo, useCallback, useState, useEffect, type KeyboardEvent,
} from 'react';

import type { IPageHasId } from '@growi/core';
import { isGlobPatternPath } from '@growi/core/dist/utils/page-path-utils';
import { type TypeaheadRef, Typeahead } from 'react-bootstrap-typeahead';
import { useTranslation } from 'react-i18next';
import {
  ModalBody,
} from 'reactstrap';
import SimpleBar from 'simplebar-react';

import { useSWRxSearch } from '~/stores/search';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import { useSelectedPages } from '../../../services/use-selected-pages';
import {
  useAiAssistantManagementModalStatus, useAiAssistantManagementModalActions, AiAssistantManagementModalPageMode,
} from '../../../states/modal/ai-assistant-management';

import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { SelectablePageList } from './SelectablePageList';

import styles from './AiAssistantManagementKeywordSearch.module.scss';

const moduleClass = styles['grw-ai-assistant-keyword-search'] ?? '';

type SelectedSearchKeyword = {
  id: string
  label: string
}

const isSelectedSearchKeyword = (value: unknown): value is SelectedSearchKeyword => {
  return (value as SelectedSearchKeyword).label != null;
};


type Props = {
  isActivePane: boolean
  baseSelectedPages: SelectablePage[],
  updateBaseSelectedPages: (pages: SelectablePage[]) => void;
}

export const AiAssistantKeywordSearch = (props: Props): JSX.Element => {
  const { isActivePane, baseSelectedPages, updateBaseSelectedPages } = props;

  const [selectedSearchKeywords, setSelectedSearchKeywords] = useState<Array<SelectedSearchKeyword>>([]);
  const {
    selectedPages, selectedPagesArray, addPage, removePage,
  } = useSelectedPages(baseSelectedPages);

  const joinedSelectedSearchKeywords = useMemo(() => {
    return selectedSearchKeywords.map(item => item.label).join(' ');
  }, [selectedSearchKeywords]);

  const { t } = useTranslation();
  const { data: searchResult } = useSWRxSearch(joinedSelectedSearchKeywords, null, {
    limit: 10,
    offset: 0,
    includeUserPages: true,
    includeTrashPages: false,
  });

  // Search results will include subordinate pages by default
  const pagesWithGlobPath = useMemo((): IPageHasId[] | undefined => {
    if (searchResult == null) {
      return;
    }

    const pages = searchResult.data.map(item => item.data);
    return pages.map((page) => {
      const newPage = { ...page };
      if (newPage.path === '/') {
        newPage.path = '/*';
        return newPage;
      }
      if (!isGlobPatternPath(newPage.path)) {
        newPage.path = `${newPage.path}/*`;
      }
      return newPage;
    });
  }, [searchResult]);

  const shownSearchResult = useMemo(() => {
    return selectedSearchKeywords.length > 0 && searchResult != null && searchResult.data.length > 0;
  }, [searchResult, selectedSearchKeywords.length]);


  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const { changePageMode } = useAiAssistantManagementModalActions();
  const isNewAiAssistant = aiAssistantManagementModalData?.aiAssistantData == null;

  const typeaheadRef = useRef<TypeaheadRef>(null);

  const changeHandler = useCallback((selected: Array<SelectedSearchKeyword>) => {
    setSelectedSearchKeywords(selected);
  }, []);

  const keyDownHandler = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.code !== 'Space') {
      return;
    }

    if (selectedSearchKeywords.length >= 5) {
      return;
    }

    event.preventDefault();

    // fix: https://redmine.weseek.co.jp/issues/140689
    // "event.isComposing" is not supported
    const isComposing = event.nativeEvent.isComposing;
    if (isComposing) {
      return;
    }

    const initialItem = typeaheadRef?.current?.state?.initialItem;
    const handleMenuItemSelect = typeaheadRef?.current?._handleMenuItemSelect;
    if (initialItem == null || handleMenuItemSelect == null) {
      return;
    }

    if (!isSelectedSearchKeyword(initialItem)) {
      return;
    }

    const allLabels = selectedSearchKeywords.map(item => item.label);
    if (allLabels.includes(initialItem.label)) {
      return;
    }

    handleMenuItemSelect(initialItem, event);
  }, [selectedSearchKeywords]);

  const nextButtonClickHandler = useCallback(() => {
    updateBaseSelectedPages(Array.from(selectedPages.values()));
    changePageMode(isNewAiAssistant ? AiAssistantManagementModalPageMode.HOME : AiAssistantManagementModalPageMode.PAGES);
  }, [changePageMode, isNewAiAssistant, selectedPages, updateBaseSelectedPages]);

  // Autofocus
  useEffect(() => {
    if (isActivePane) {
      typeaheadRef.current?.focus();
    }
  }, [isActivePane]);

  return (
    <div className={moduleClass}>
      <AiAssistantManagementHeader
        backButtonColor="secondary"
        backToPageMode={baseSelectedPages.length === 0 ? AiAssistantManagementModalPageMode.PAGE_SELECTION_METHOD : AiAssistantManagementModalPageMode.PAGES}
        labelTranslationKey={isNewAiAssistant ? 'modal_ai_assistant.header.add_new_assistant' : 'modal_ai_assistant.header.update_assistant'}
      />

      <ModalBody className="px-4">
        <h4 className="text-center fw-bold mb-3 mt-2">
          {t('modal_ai_assistant.search_reference_pages_by_keyword')}
        </h4>

        <div className="px-4">
          <Typeahead
            allowNew
            multiple
            options={[]}
            selected={selectedSearchKeywords}
            placeholder={t('modal_ai_assistant.enter_keywords')}
            id="ai-assistant-keyword-search"
            ref={typeaheadRef}
            onChange={changeHandler}
            onKeyDown={keyDownHandler}
          />

          <label htmlFor="ai-assistant-keyword-search" className="form-text text-muted mt-2">
            {t('modal_ai_assistant.max_items_space_separated_hint')}
          </label>
        </div>

        { shownSearchResult && (
          <>
            <h4 className="text-center fw-bold mb-3 mt-4">
              {t('modal_ai_assistant.select_assistant_reference_pages')}
            </h4>
            <div className="px-4">
              <SimpleBar className="page-list-container" style={{ maxHeight: '300px' }}>
                <SelectablePageList
                  isEditable
                  pages={pagesWithGlobPath ?? []}
                  method="add"
                  onClickMethodButton={addPage}
                  disablePagePaths={selectedPagesArray.map(page => page.path)}
                />
              </SimpleBar>
            </div>
          </>
        )}

        <h4 className="text-center fw-bold mb-3 mt-4">
          {t('modal_ai_assistant.reference_pages')}
        </h4>

        <div className="px-4">
          <SimpleBar className="page-list-container" style={{ maxHeight: '300px' }}>
            <SelectablePageList
              pages={selectedPagesArray}
              method="remove"
              onClickMethodButton={removePage}
            />
          </SimpleBar>
          <label className="form-text text-muted mt-2">
            {t('modal_ai_assistant.can_add_later')}
          </label>

        </div>

        <div className="d-flex justify-content-center mt-4">
          <button
            disabled={selectedPages.size === 0}
            type="button"
            className="btn btn-primary rounded next-button"
            onClick={nextButtonClickHandler}
          >
            {t('modal_ai_assistant.next')}
          </button>
        </div>
      </ModalBody>
    </div>
  );
};
