import type { ChangeEvent, JSX } from 'react';
import {
  useState, useCallback, memo,
} from 'react';

import nodePath from 'path';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { useTranslation } from 'next-i18next';
import { debounce } from 'throttle-debounce';

import type { InputValidationResult } from '~/client/util/use-input-validator';
import { ValidationTarget, useInputValidator } from '~/client/util/use-input-validator';
import type { IPageForItem } from '~/interfaces/page';
import LinkedPagePath from '~/models/linked-page-path';
import { usePageSelectModalActions } from '~/states/ui/modal/page-select';

import { PagePathHierarchicalLink } from '../../../components/Common/PagePathHierarchicalLink';
import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '../Common/SubmittableInput';
import { usePagePathRenameHandler } from '../PageEditor/page-path-rename-utils';

import styles from './PagePathHeader.module.scss';

const moduleClass = styles['page-path-header'];


type Props = {
  currentPage: IPagePopulatedToShowRevision,
  className?: string,
  maxWidth?: number,
  onRenameTerminated?: () => void,
}

export const PagePathHeader = memo((props: Props): JSX.Element => {
  const { t } = useTranslation();
  const {
    currentPage, className, maxWidth, onRenameTerminated,
  } = props;

  const dPagePath = new DevidedPagePath(currentPage.path, true);
  const parentPagePath = dPagePath.former;

  const linkedPagePath = new LinkedPagePath(parentPagePath);

  const [isRenameInputShown, setRenameInputShown] = useState(false);
  const [isHover, setHover] = useState(false);

  const { open: openPageSelectModal } = usePageSelectModalActions();

  const [validationResult, setValidationResult] = useState<InputValidationResult>();

  const inputValidator = useInputValidator(ValidationTarget.PAGE);

  const changeHandler = useCallback(async(e: ChangeEvent<HTMLInputElement>) => {
    const validationResult = inputValidator(e.target.value);
    setValidationResult(validationResult ?? undefined);
  }, [inputValidator]);
  const changeHandlerDebounced = debounce(300, changeHandler);


  const pagePathRenameHandler = usePagePathRenameHandler(currentPage);

  const onClickOpenPageSelectModalButton = useCallback(() => {
    const onSelected = (page: IPageForItem): void => {
      if (page == null || page.path == null) {
        return;
      }

      const currentPageTitle = nodePath.basename(currentPage?.path ?? '') || '/';
      const newPagePath = nodePath.resolve(page.path, currentPageTitle);

      pagePathRenameHandler(newPagePath);
    };

    openPageSelectModal({ onSelected });
  }, [currentPage?.path, openPageSelectModal, pagePathRenameHandler]);

  const rename = useCallback((inputText) => {
    const pathToRename = normalizePath(`${inputText}/${dPagePath.latter}`);
    pagePathRenameHandler(pathToRename,
      () => {
        setRenameInputShown(false);
        setValidationResult(undefined);
        onRenameTerminated?.();
      },
      () => {
        setRenameInputShown(true);
      });
  }, [dPagePath.latter, pagePathRenameHandler, onRenameTerminated]);

  const cancel = useCallback(() => {
    // reset
    setValidationResult(undefined);
    setRenameInputShown(false);
  }, []);

  const onClickEditButton = useCallback(() => {
    // reset
    setRenameInputShown(true);
  }, []);

  if (dPagePath.isRoot) {
    return <></>;
  }


  const isInvalid = validationResult != null;

  const fixedMaxWidth = maxWidth != null
    ? maxWidth - 60 // 60px is the width of the buttons
    : undefined;
  const inputMaxWidth = maxWidth != null
    ? getAdjustedMaxWidthForAutosizeInput(maxWidth, 'sm', validationResult != null ? false : undefined) - 16
    : undefined;

  return (
    <div
      id="page-path-header"
      className={`d-flex ${moduleClass} ${className ?? ''} small position-relative ms-2`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="page-path-header-input d-inline-block"
        style={{ maxWidth: fixedMaxWidth }}
      >
        { isRenameInputShown && (
          <div className="position-relative">
            <div className="position-absolute w-100">
              <AutosizeSubmittableInput
                value={parentPagePath}
                inputClassName={`form-control form-control-sm ${isInvalid ? 'is-invalid' : ''}`}
                inputStyle={{ maxWidth: inputMaxWidth }}
                placeholder={t('Input parent page path')}
                onChange={changeHandlerDebounced}
                onSubmit={rename}
                onCancel={cancel}
                autoFocus
              />
            </div>
          </div>
        ) }
        <div className={`${isRenameInputShown ? 'invisible' : ''} text-truncate`}>
          <PagePathHierarchicalLink
            linkedPagePath={linkedPagePath}
          />
        </div>
      </div>

      <div
        className={`page-path-header-buttons d-flex align-items-center ms-2 ${isHover && !isRenameInputShown ? '' : 'invisible'}`}
      >
        <button
          type="button"
          className="btn btn-outline-neutral-secondary me-2 d-flex align-items-center justify-content-center"
          onClick={onClickEditButton}
        >
          <span className="material-symbols-outlined fs-6">edit</span>
        </button>

        <button
          type="button"
          className="btn btn-outline-neutral-secondary d-flex align-items-center justify-content-center"
          onClick={onClickOpenPageSelectModalButton}
        >
          <span className="material-symbols-outlined fs-6">account_tree</span>
        </button>
      </div>
    </div>
  );
});
