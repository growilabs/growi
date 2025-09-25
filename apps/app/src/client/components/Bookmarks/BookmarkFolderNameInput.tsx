import type { ChangeEvent, JSX } from 'react';
import { useCallback, useRef, useState } from 'react';

import { useRect } from '@growi/ui/dist/utils';
import { useTranslation } from 'next-i18next';
import type { AutosizeInputProps } from 'react-input-autosize';
import { debounce } from 'throttle-debounce';

import type { InputValidationResult } from '~/client/util/use-input-validator';
import { ValidationTarget, useInputValidator } from '~/client/util/use-input-validator';

import { AutosizeSubmittableInput, getAdjustedMaxWidthForAutosizeInput } from '../Common/SubmittableInput';
import type { SubmittableInputProps } from '../Common/SubmittableInput/types';


type Props = Pick<SubmittableInputProps<AutosizeInputProps>, 'value' | 'onSubmit' | 'onCancel'>;

export const BookmarkFolderNameInput = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { value, onSubmit, onCancel } = props;

  const parentRef = useRef<HTMLDivElement>(null);
  const [parentRect] = useRect(parentRef);

  const [validationResult, setValidationResult] = useState<InputValidationResult>();


  const inputValidator = useInputValidator(ValidationTarget.FOLDER);

  const changeHandler = useCallback(async(e: ChangeEvent<HTMLInputElement>) => {
    const validationResult = inputValidator(e.target.value);
    setValidationResult(validationResult ?? undefined);
  }, [inputValidator]);
  const changeHandlerDebounced = debounce(300, changeHandler);

  const cancelHandler = useCallback(() => {
    setValidationResult(undefined);
    onCancel?.();
  }, [onCancel]);

  const isInvalid = validationResult != null;

  const maxWidth = parentRect != null
    ? getAdjustedMaxWidthForAutosizeInput(parentRect.width, 'md', validationResult != null ? false : undefined)
    : undefined;

  return (
    <div ref={parentRef}>
      <AutosizeSubmittableInput
        value={value}
        inputClassName={`form-control ${isInvalid ? 'is-invalid' : ''}`}
        inputStyle={{ maxWidth }}
        placeholder={t('bookmark_folder.input_placeholder')}
        aria-describedby={isInvalid ? 'bookmark-folder-name-input-feedback' : undefined}
        autoFocus
        onChange={changeHandlerDebounced}
        onSubmit={onSubmit}
        onCancel={cancelHandler}
      />
      { isInvalid && (
        <div id="bookmark-folder-name-input-feedback" className="invalid-feedback d-block my-1">
          {validationResult.message}
        </div>
      ) }
    </div>
  );
};
