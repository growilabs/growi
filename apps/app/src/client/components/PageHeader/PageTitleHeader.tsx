import type { ChangeEvent, JSX } from 'react';
import {
  useState, useCallback, useEffect, useMemo,
} from 'react';

import nodePath from 'path';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { pathUtils } from '@growi/core/dist/utils';
import { isMovablePage } from '@growi/core/dist/utils/page-path-utils';
import { useTranslation } from 'next-i18next';

import type { InputValidationResult } from '~/client/util/use-input-validator';
import { ValidationTarget, useInputValidator } from '~/client/util/use-input-validator';
import { useIsUntitledPage } from '~/states/page';
import { EditorMode, useEditorMode } from '~/states/ui/editor';

import { CopyDropdown } from '../Common/CopyDropdown';
import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '../Common/SubmittableInput';
import { usePagePathRenameHandler } from '../PageEditor/page-path-rename-utils';

import styles from './PageTitleHeader.module.scss';

const moduleClass = styles['page-title-header'] ?? '';
const borderColorClass = styles['page-title-header-border-color'] ?? '';

type Props = {
  currentPage: IPagePopulatedToShowRevision,
  className?: string,
  maxWidth?: number,
  onMoveTerminated?: () => void,
};

export const PageTitleHeader = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { currentPage, maxWidth, onMoveTerminated } = props;

  const currentPagePath = currentPage.path;

  const isMovable = isMovablePage(currentPagePath);

  const dPagePath = new DevidedPagePath(currentPage.path, true);
  const pageTitle = dPagePath.latter;

  const [isRenameInputShown, setRenameInputShown] = useState(false);
  const [editedPagePath, setEditedPagePath] = useState(currentPagePath);
  const [validationResult, setValidationResult] = useState<InputValidationResult>();

  const pagePathRenameHandler = usePagePathRenameHandler(currentPage);
  const inputValidator = useInputValidator(ValidationTarget.PAGE);

  const editedPageTitle = nodePath.basename(editedPagePath);

  const { editorMode } = useEditorMode();
  const isUntitledPage = useIsUntitledPage();

  const changeHandler = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const newPageTitle = pathUtils.removeHeadingSlash(e.target.value);
    const parentPagePath = pathUtils.addTrailingSlash(nodePath.dirname(currentPage.path));
    const newPagePath = nodePath.resolve(parentPagePath, newPageTitle);

    setEditedPagePath(newPagePath);

    // validation
    const validationResult = inputValidator(e.target.value);
    setValidationResult(validationResult ?? undefined);
  }, [currentPage.path, inputValidator]);

  const rename = useCallback(() => {
    pagePathRenameHandler(editedPagePath,
      () => {
        setRenameInputShown(false);
        setValidationResult(undefined);
        onMoveTerminated?.();
      },
      () => {
        setRenameInputShown(true);
      });
  }, [editedPagePath, onMoveTerminated, pagePathRenameHandler]);

  const cancel = useCallback(() => {
    setEditedPagePath(currentPagePath);
    setValidationResult(undefined);
    setRenameInputShown(false);
  }, [currentPagePath]);

  const onClickPageTitle = useCallback(() => {
    if (!isMovable) {
      return;
    }

    setEditedPagePath(currentPagePath);
    setRenameInputShown(true);
  }, [currentPagePath, isMovable]);

  useEffect(() => {
    setEditedPagePath(currentPagePath);
    if (isUntitledPage != null) {
      setRenameInputShown(isUntitledPage && editorMode === EditorMode.Editor);
    }
  }, [currentPage._id, currentPagePath, editorMode, isUntitledPage]);

  const isInvalid = validationResult != null;

  // calculate inputMaxWidth as the maximum width of AutoSizeInput minus the width of WIP badge and CopyDropdown
  const inputMaxWidth = useMemo(() => {
    if (maxWidth == null) {
      return undefined;
    }

    const wipBadgeAndCopyDropdownWidth = 4 // me-1
      + (currentPage.wip ? 49 : 0) // WIP badge + gap
      + 24; // CopyDropdown

    return getAdjustedMaxWidthForAutosizeInput(maxWidth, 'md', validationResult != null ? false : undefined) - wipBadgeAndCopyDropdownWidth;
  }, [currentPage.wip, maxWidth, validationResult]);

  // calculate h1MaxWidth as the inputMaxWidth plus padding
  const h1MaxWidth = useMemo(() => {
    if (inputMaxWidth == null) {
      return undefined;
    }

    return inputMaxWidth + 16; // plus the padding of px-2 because AutosizeInput has "box-sizing: content-box;"
  }, [inputMaxWidth]);

  return (
    <div className={`d-flex ${moduleClass} ${props.className ?? ''} position-relative`}>
      <div className="page-title-header-input me-1 d-inline-block">
        {isRenameInputShown && (
          <div className="position-relative">
            <div className="position-absolute w-100">
              <AutosizeSubmittableInput
                value={isUntitledPage ? '' : editedPageTitle}
                inputClassName={`form-control fs-4 ${isInvalid ? 'is-invalid' : ''}`}
                inputStyle={{ maxWidth: inputMaxWidth }}
                placeholder={t('Input page name')}
                onChange={changeHandler}
                onSubmit={rename}
                onCancel={cancel}
                autoFocus
              />
            </div>
          </div>
        )}
        <h1
          className={`mb-0 mb-sm-1 px-2 fs-4
            ${isRenameInputShown ? 'invisible' : ''} text-truncate
            ${isMovable ? 'border border-2 rounded-2' : ''} ${borderColorClass}
          `}
          style={{ maxWidth: h1MaxWidth }}
          onClick={onClickPageTitle}
        >
          {pageTitle}
        </h1>
      </div>

      <div className={`${isRenameInputShown ? 'invisible' : ''} d-flex align-items-center gap-2`}>
        {currentPage.wip && (
          <span className="badge rounded-pill text-bg-secondary">WIP</span>
        )}

        <CopyDropdown
          pageId={currentPage._id}
          pagePath={currentPage.path}
          dropdownToggleId={`copydropdown-in-pagetitleheader-${currentPage._id}`}
          dropdownToggleClassName="p-1"
          dropdownMenuContainer="body"
        >
          <span className="material-symbols-outlined fs-6">content_paste</span>
        </CopyDropdown>
      </div>
    </div>
  );
};
