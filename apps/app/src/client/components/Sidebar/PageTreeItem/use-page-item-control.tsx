import type { ChangeEvent, FC } from 'react';
import React, {
  useCallback, useRef, useState,
} from 'react';

import nodePath from 'path';

import type { IPageInfoExt, IPageToDeleteWithMeta } from '@growi/core';
import { pathUtils } from '@growi/core/dist/utils';
import { useRect } from '@growi/ui/dist/utils';
import { useTranslation } from 'next-i18next';
import { DropdownToggle } from 'reactstrap';
import { debounce } from 'throttle-debounce';

import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '~/client/components/Common/SubmittableInput';
import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { bookmark, unbookmark, resumeRenameOperation } from '~/client/services/page-operation';
import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { ValidationTarget, useInputValidator, type InputValidationResult } from '~/client/util/use-input-validator';
import { useSWRMUTxCurrentUserBookmarks } from '~/stores/bookmark';
import { useSWRMUTxPageInfo } from '~/stores/page';

import { PageItemControl } from '../../Common/Dropdown/PageItemControl';
import type { TreeItemToolProps } from '../../TreeItem';


type UsePageItemControl = {
  Control: FC<TreeItemToolProps>,
  RenameInput: FC<TreeItemToolProps>,
  showRenameInput: boolean,
}

export const usePageItemControl = (): UsePageItemControl => {
  const { t } = useTranslation();

  const [showRenameInput, setShowRenameInput] = useState(false);


  const Control: FC<TreeItemToolProps> = (props) => {
    const {
      itemNode,
      isEnableActions,
      isReadOnlyUser,
      onClickDuplicateMenuItem, onClickDeleteMenuItem,
    } = props;
    const { page } = itemNode;

    const { trigger: mutateCurrentUserBookmarks } = useSWRMUTxCurrentUserBookmarks();
    const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(page._id ?? null);

    const bookmarkMenuItemClickHandler = useCallback(async(_pageId: string, _newValue: boolean): Promise<void> => {
      const bookmarkOperation = _newValue ? bookmark : unbookmark;
      await bookmarkOperation(_pageId);
      mutateCurrentUserBookmarks();
      mutatePageInfo();
    }, [mutateCurrentUserBookmarks, mutatePageInfo]);

    const duplicateMenuItemClickHandler = useCallback((): void => {
      if (onClickDuplicateMenuItem == null) {
        return;
      }

      const { _id: pageId, path } = page;

      if (pageId == null || path == null) {
        throw Error('Any of _id and path must not be null.');
      }

      const pageToDuplicate = { pageId, path };

      onClickDuplicateMenuItem(pageToDuplicate);
    }, [onClickDuplicateMenuItem, page]);

    const renameMenuItemClickHandler = useCallback(() => {
      setShowRenameInput(true);
    }, []);

    const deleteMenuItemClickHandler = useCallback(async(_pageId: string, pageInfo: IPageInfoExt | undefined): Promise<void> => {
      if (onClickDeleteMenuItem == null) {
        return;
      }

      if (page._id == null || page.path == null) {
        throw Error('_id and path must not be null.');
      }

      const pageToDelete: IPageToDeleteWithMeta = {
        data: {
          _id: page._id,
          revision: page.revision as string,
          path: page.path,
        },
        meta: pageInfo,
      };

      onClickDeleteMenuItem(pageToDelete);
    }, [onClickDeleteMenuItem, page]);

    const pathRecoveryMenuItemClickHandler = async(pageId: string): Promise<void> => {
      try {
        await resumeRenameOperation(pageId);
        toastSuccess(t('page_operation.paths_recovered'));
      }
      catch {
        toastError(t('page_operation.path_recovery_failed'));
      }
    };

    return (
      <NotAvailableForGuest>
        <div className="grw-pagetree-control d-flex">
          <PageItemControl
            pageId={page._id}
            isEnableActions={isEnableActions}
            isReadOnlyUser={isReadOnlyUser}
            onClickBookmarkMenuItem={bookmarkMenuItemClickHandler}
            onClickDuplicateMenuItem={duplicateMenuItemClickHandler}
            onClickRenameMenuItem={renameMenuItemClickHandler}
            onClickDeleteMenuItem={deleteMenuItemClickHandler}
            onClickPathRecoveryMenuItem={pathRecoveryMenuItemClickHandler}
            isInstantRename
            // Todo: It is wanted to find a better way to pass operationProcessData to PageItemControl
            operationProcessData={page.processData}
          >
            {/* pass the color property to reactstrap dropdownToggle props. https://6-4-0--reactstrap.netlify.app/components/dropdowns/  */}
            <DropdownToggle color="transparent" className="border-0 rounded btn-page-item-control p-0 mr-1">
              <span id="option-button-in-page-tree" className="material-symbols-outlined p-1">more_vert</span>
            </DropdownToggle>
          </PageItemControl>
        </div>
      </NotAvailableForGuest>
    );
  };


  const RenameInput: FC<TreeItemToolProps> = (props) => {
    const { itemNode, onRenamed } = props;
    const { page } = itemNode;

    const parentRef = useRef<HTMLDivElement>(null);
    const [parentRect] = useRect(parentRef);

    const [validationResult, setValidationResult] = useState<InputValidationResult>();


    const inputValidator = useInputValidator(ValidationTarget.PAGE);

    const changeHandler = useCallback(async(e: ChangeEvent<HTMLInputElement>) => {
      const validationResult = inputValidator(e.target.value);
      setValidationResult(validationResult ?? undefined);
    }, [inputValidator]);
    const changeHandlerDebounced = debounce(300, changeHandler);

    const cancel = useCallback(() => {
      setValidationResult(undefined);
      setShowRenameInput(false);
    }, []);

    const rename = useCallback(async(inputText) => {
      if (inputText.trim() === '') {
        return cancel();
      }

      const parentPath = pathUtils.addTrailingSlash(nodePath.dirname(page.path ?? ''));
      const newPagePath = nodePath.resolve(parentPath, inputText);

      if (newPagePath === page.path) {
        setValidationResult(undefined);
        setShowRenameInput(false);
        return;
      }

      try {
        await apiv3Put('/pages/rename', {
          pageId: page._id,
          revisionId: page.revision,
          newPagePath,
        });

        onRenamed?.(page.path, newPagePath);
        setShowRenameInput(false);

        toastSuccess(t('renamed_pages', { path: page.path }));
      }
      catch (err) {
        toastError(err);
      }
      finally {
        setValidationResult(undefined);
      }

    }, [cancel, onRenamed, page._id, page.path, page.revision]);


    if (!showRenameInput) {
      return <></>;
    }

    const isInvalid = validationResult != null;

    const maxWidth = parentRect != null
      ? getAdjustedMaxWidthForAutosizeInput(parentRect.width, 'sm', validationResult != null ? false : undefined)
      : undefined;

    return (
      <div ref={parentRef} className="flex-fill">
        <AutosizeSubmittableInput
          value={nodePath.basename(page.path ?? '')}
          inputClassName={`form-control ${isInvalid ? 'is-invalid' : ''}`}
          inputStyle={{ maxWidth }}
          placeholder={t('Input page name')}
          aria-describedby={isInvalid ? 'rename-feedback' : undefined}
          onChange={changeHandlerDebounced}
          onSubmit={rename}
          onCancel={cancel}
          autoFocus
        />
        { isInvalid && (
          <div id="rename-feedback" className="invalid-feedback d-block my-1">
            {validationResult.message}
          </div>
        ) }
      </div>
    );
  };


  return {
    Control,
    RenameInput,
    showRenameInput,
  };

};
