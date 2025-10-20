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
import { usePageTreeDescCountMap } from '~/states/ui/page-tree-desc-count-map';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing';

import { shouldCreateWipPage } from '../../../../utils/should-create-wip-page';
import type { TreeItemToolProps } from '../interfaces';

import { NewPageCreateButton } from './NewPageCreateButton';


import newPageInputStyles from './NewPageInput.module.scss';


type UseNewPageInput = {
  Input: FC<TreeItemToolProps>,
  CreateButton: FC<TreeItemToolProps>,
  isProcessingSubmission: boolean,
}

export const useNewPageInput = (): UseNewPageInput => {

  const [showInput, setShowInput] = useState(false);
  const [isProcessingSubmission, setProcessingSubmission] = useState(false);

  const CreateButton: FC<TreeItemToolProps> = (props) => {

    const { itemNode, stateHandlers } = props;
    const { page } = itemNode;

    const onClick = useCallback(() => {
      setShowInput(true);
      stateHandlers?.setIsOpen(true);
    }, [stateHandlers]);

    return (
      <NewPageCreateButton
        page={page}
        onClick={onClick}
      />
    );
  };

  const Input: FC<TreeItemToolProps> = (props) => {

    const { t } = useTranslation();
    const { create: createPage } = useCreatePage();

    const { itemNode, stateHandlers, isEnableActions } = props;
    const { page, children } = itemNode;

    const { getDescCount } = usePageTreeDescCountMap();
    const descendantCount = getDescCount(page._id) || page.descendantCount || 0;

    const isChildrenLoaded = children?.length > 0;
    const hasDescendants = descendantCount > 0 || isChildrenLoaded;

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

    const create = useCallback(async (inputText) => {
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

      setProcessingSubmission(true);

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
              mutatePageTree();
              mutateRecentlyUpdated();

              if (!hasDescendants) {
                stateHandlers?.setIsOpen(true);
              }

              toastSuccess(t('successfully_saved_the_page'));
            },
          },
        );
      }
      catch (err) {
        toastError(err);
      }
      finally {
        setProcessingSubmission(false);
      }
    }, [cancel, hasDescendants, page.path, stateHandlers, t, createPage]);

    const inputContainerClass = newPageInputStyles['new-page-input-container'] ?? '';
    const isInvalid = validationResult != null;

    const maxWidth = parentRect != null
      ? getAdjustedMaxWidthForAutosizeInput(parentRect.width, 'sm', validationResult != null ? false : undefined)
      : undefined;

    return isEnableActions && showInput
      ? (
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
      )
      : <></>;
  };

  return {
    Input,
    CreateButton,
    isProcessingSubmission,
  };
};
