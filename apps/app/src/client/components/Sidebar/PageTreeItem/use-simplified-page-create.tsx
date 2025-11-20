import type { ChangeEvent } from 'react';
import React, {
  useState, type FC, useCallback, useRef,
} from 'react';

import nodePath from 'path';

import { Origin } from '@growi/core';
import { pathUtils, pagePathUtils } from '@growi/core/dist/utils';
import { useRect } from '@growi/ui/dist/utils';
import { useTranslation } from 'next-i18next';
import { debounce } from 'throttle-debounce';

import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '~/client/components/Common/SubmittableInput';
import { useCreatePage } from '~/client/services/create-page';
import { toastWarning, toastError, toastSuccess } from '~/client/util/toastr';
import type { InputValidationResult } from '~/client/util/use-input-validator';
import { ValidationTarget, useInputValidator } from '~/client/util/use-input-validator';
import { ROOT_PAGE_VIRTUAL_ID } from '~/constants/page-tree';
import { usePageTreeInformationUpdate } from '~/states/page-tree-update';

import { shouldCreateWipPage } from '../../../../utils/should-create-wip-page';
import type { TreeItemToolProps } from '../../TreeItem';
import { NewPageCreateButton } from '../../TreeItem/NewPageInput/NewPageCreateButton';

import newPageInputStyles from '../../TreeItem/NewPageInput/NewPageInput.module.scss';


type UseSimplifiedPageCreate = {
  CreateButton: FC<TreeItemToolProps>,
}

export const useSimplifiedPageCreate = (onToggle: () => void, isExpanded: boolean): UseSimplifiedPageCreate => {

  const [showInput, setShowInput] = useState(false);

  const CreateButton: FC<TreeItemToolProps> = (props) => {

    const { item: page, isEnableActions } = props;

    const { t } = useTranslation();
    const { create: createPage } = useCreatePage();
    const { notifyUpdateItems } = usePageTreeInformationUpdate();

    const parentRef = useRef<HTMLDivElement>(null);
    const [parentRect] = useRect(parentRef);

    const [validationResult, setValidationResult] = useState<InputValidationResult>();

    const inputValidator = useInputValidator(ValidationTarget.PAGE);

    const changeHandler = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
      const validationResult = inputValidator(e.target.value);
      setValidationResult(validationResult ?? undefined);
    }, [inputValidator]);
    const changeHandlerDebounced = debounce(300, changeHandler);

    const cancel = useCallback(() => {
      setValidationResult(undefined);
      setShowInput(false);
    }, []);

    const create = useCallback(async (inputText: string) => {
      if (inputText.trim() === '') {
        return cancel();
      }

      const parentPath = pathUtils.addTrailingSlash(page.path as string);
      const newPagePath = nodePath.resolve(parentPath, inputText);
      const isCreatable = pagePathUtils.isCreatablePage(newPagePath);

      if (!isCreatable) {
        toastWarning(t('you_can_not_create_page_with_this_name_or_hierarchy'));
        return;
      }

      setShowInput(false);

      try {
        await createPage(
          {
            path: newPagePath,
            parentPath,
            body: undefined,
            // keep grant info undefined to inherit from parent
            grant: undefined,
            grantUserGroupIds: undefined,
            origin: Origin.View,
            wip: shouldCreateWipPage(newPagePath),
          },
          {
            skipTransition: true,
            onCreated: () => {
              // Notify headless-tree to update children
              const parentId = page._id ?? ROOT_PAGE_VIRTUAL_ID;
              notifyUpdateItems([parentId]);

              // Expand parent if not expanded
              if (!isExpanded) {
                onToggle();
              }

              toastSuccess(t('successfully_saved_the_page'));
            },
          },
        );
      }
      catch (err) {
        toastError(err);
      }
    }, [cancel, page.path, page._id, t, createPage, notifyUpdateItems]);

    const onClick = useCallback(() => {
      setShowInput(true);
      // Expand parent when create button is clicked
      if (!isExpanded) {
        onToggle();
      }
    }, []);

    const inputContainerClass = newPageInputStyles['new-page-input-container'] ?? '';
    const isInvalid = validationResult != null;

    const maxWidth = parentRect != null
      ? getAdjustedMaxWidthForAutosizeInput(parentRect.width, 'sm', validationResult != null ? false : undefined)
      : undefined;

    // Show input if active, otherwise show button
    if (isEnableActions && showInput) {
      return (
        <div ref={parentRef} className={inputContainerClass}>
          <AutosizeSubmittableInput
            inputClassName={`form-control ${isInvalid ? 'is-invalid' : ''}`}
            inputStyle={{ maxWidth }}
            placeholder={t('Input page name')}
            aria-describedby={isInvalid ? 'new-page-input-feedback' : undefined}
            onChange={changeHandlerDebounced}
            onSubmit={create}
            onCancel={cancel}
            autoFocus
          />
          {isInvalid && (
            <div id="new-page-input" className="invalid-feedback d-block my-1">
              {validationResult.message}
            </div>
          )}
        </div>
      );
    }

    return (
      <NewPageCreateButton
        page={page}
        onClick={onClick}
      />
    );
  };

  return {
    CreateButton,
  };
};
