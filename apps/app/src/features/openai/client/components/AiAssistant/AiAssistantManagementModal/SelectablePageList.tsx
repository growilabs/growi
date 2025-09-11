import React, {
  useMemo, memo, useState, useCallback, useRef, useEffect,
} from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useRect } from '@growi/ui/dist/utils';
import { useTranslation } from 'react-i18next';
import AutosizeInput from 'react-input-autosize';

import { type SelectablePage } from '../../../../interfaces/selectable-page';
import { isCreatablePagePathPattern } from '../../../../utils/is-creatable-page-path-pattern';

import styles from './SelectablePageList.module.scss';

const moduleClass = styles['selectable-page-list'] ?? '';

type MethodButtonProps = {
  page: SelectablePage;
  disablePagePaths: string[];
  method: 'add' | 'remove' | 'delete'
  onClickMethodButton: (page: SelectablePage) => void;
}

const MethodButton = memo((props: MethodButtonProps) => {
  const {
    page,
    disablePagePaths,
    method,
    onClickMethodButton,
  } = props;

  const iconName = useMemo(() => {
    switch (method) {
      case 'add':
        return 'add_circle';
      case 'remove':
        return 'do_not_disturb_on';
      case 'delete':
        return 'delete';
      default:
        return '';
    }
  }, [method]);

  const color = useMemo(() => {
    switch (method) {
      case 'add':
        return 'text-primary';
      case 'remove':
        return 'text-secondary';
      case 'delete':
        return 'text-secondary';
      default:
        return '';
    }
  }, [method]);

  return (
    <button
      type="button"
      className={`btn border-0 ${color}`}
      disabled={disablePagePaths.includes(page.path)}
      onClick={(e) => {
        e.stopPropagation();
        onClickMethodButton(page);
      }}
    >
      <span className="material-symbols-outlined">
        {iconName}
      </span>
    </button>
  );
});


type EditablePagePathProps = {
  isEditable?: boolean;
  page: SelectablePage;
  disablePagePaths: string[];
  methodButtonPosition?: 'left' | 'right';
}

const EditablePagePath = memo((props: EditablePagePathProps): JSX.Element => {
  const {
    page,
    isEditable,
    disablePagePaths = [],
    methodButtonPosition = 'left',
  } = props;

  const [editingPagePath, setEditingPagePath] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');

  const inputRef = useRef<HTMLInputElement & AutosizeInput | null>(null);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const [editingContainerRect] = useRect(editingContainerRef);

  const isEditing = isEditable && editingPagePath === page.path;

  const handlePagePathClick = useCallback((page: SelectablePage) => {
    if (!isEditable || disablePagePaths.includes(page.path)) {
      return;
    }
    setEditingPagePath(page.path);
    setInputValue(page.path);
  }, [disablePagePaths, isEditable]);

  const handleInputBlur = useCallback(() => {
    setEditingPagePath(null);
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {

      // Validate page path
      const pagePathWithSlash = pathUtils.addHeadingSlash(inputValue);
      if (inputValue === '' || disablePagePaths.includes(pagePathWithSlash) || !isCreatablePagePathPattern(pagePathWithSlash)) {
        handleInputBlur();
        return;
      }

      // Update page path
      page.path = pagePathWithSlash;

      handleInputBlur();
    }
  }, [disablePagePaths, handleInputBlur, inputValue, page]);

  // Autofocus
  useEffect(() => {
    if (editingPagePath != null && inputRef.current != null) {
      inputRef.current.focus();
    }
  }, [editingPagePath]);

  return (
    <div
      ref={editingContainerRef}
      className={`flex-grow-1 ${methodButtonPosition === 'left' ? 'me-2' : 'mx-2'}`}
      style={{ minWidth: 0 }}
    >
      {isEditing
        ? (
          <AutosizeInput
            id="page-path-input"
            inputClassName="page-path-input"
            type="text"
            ref={inputRef}
            value={inputValue}
            onBlur={handleInputBlur}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            inputStyle={{ maxWidth: (editingContainerRect?.width ?? 0) - 10 }}
          />
        )
        : (
          <span
            className={`page-path ${isEditable && !disablePagePaths.includes(page.path) ? 'page-path-editable' : ''}`}
            onClick={() => handlePagePathClick(page)}
            title={page.path}
          >
            {page.path}
          </span>
        )}
    </div>
  );
});


type SelectablePageListProps = {
  pages: SelectablePage[],
  method: 'add' | 'remove' | 'delete'
  methodButtonPosition?: 'left' | 'right',
  disablePagePaths?: string[],
  isEditable?: boolean,
  onClickMethodButton: (page: SelectablePage) => void,
}

export const SelectablePageList = (props: SelectablePageListProps): JSX.Element => {
  const {
    pages,
    method,
    methodButtonPosition = 'left',
    disablePagePaths = [],
    isEditable,
    onClickMethodButton,
  } = props;

  const { t } = useTranslation();

  if (pages.length === 0) {
    return (
      <div className={moduleClass}>
        <div className="border-0 text-center page-list-item rounded py-3">
          <p className="text-muted mb-0">{t('modal_ai_assistant.no_pages_selected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`list-group ${moduleClass}`}>
      {pages.map((page) => {
        return (
          <div
            key={page.path}
            className="list-group-item border-0 page-list-item d-flex align-items-center p-1 mb-2 rounded"
          >

            {methodButtonPosition === 'left'
              && (
                <MethodButton
                  page={page}
                  method={method}
                  disablePagePaths={disablePagePaths}
                  onClickMethodButton={onClickMethodButton}
                />
              )
            }

            <EditablePagePath
              page={page}
              isEditable={isEditable}
              disablePagePaths={disablePagePaths}
              methodButtonPosition={methodButtonPosition}
            />

            <span className={`badge bg-body-secondary rounded-pill ${methodButtonPosition === 'left' ? 'me-2' : ''}`}>
              <span className="text-body-tertiary">
                {page.descendantCount}
              </span>
            </span>

            {methodButtonPosition === 'right'
              && (
                <MethodButton
                  page={page}
                  method={method}
                  disablePagePaths={disablePagePaths}
                  onClickMethodButton={onClickMethodButton}
                />
              )
            }
          </div>
        );
      })}
    </div>
  );
};
