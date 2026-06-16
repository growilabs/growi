import type { FC, InputHTMLAttributes } from 'react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { debounce } from 'throttle-debounce';

import type { InputValidationResult } from '~/client/util/use-input-validator';
import {
  useInputValidator,
  ValidationTarget,
} from '~/client/util/use-input-validator';

import { CREATING_PAGE_VIRTUAL_ID } from '../constants/_inner';
import type { TreeItemToolProps } from '../interfaces';

type TreeNameInputProps = {
  /**
   * Props from headless-tree's getRenameInputProps()
   * Includes value, onChange, onBlur, onKeyDown, ref
   */
  inputProps: InputHTMLAttributes<HTMLInputElement> & {
    ref?: (r: HTMLInputElement | null) => void;
  };
  /**
   * Validation function for the input value
   */
  validateName?: (name: string) => InputValidationResult | null;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Additional CSS class
   */
  className?: string;
};

/**
 * Unified input component for tree item name editing (rename/create)
 * Uses headless-tree's renamingFeature for keyboard handling (Enter/Escape)
 */
const TreeNameInputSubstance: FC<TreeNameInputProps> = ({
  inputProps,
  validateName,
  placeholder,
  className,
}) => {
  const [validationResult, setValidationResult] =
    useState<InputValidationResult | null>(null);

  const validate = debounce(300, (value: string) => {
    setValidationResult(validateName?.(value) ?? null);
  });

  const isInvalid = validationResult != null;

  return (
    <div className={`${className ?? ''} flex-fill`}>
      <input
        {...inputProps}
        onChange={(e) => {
          inputProps.onChange?.(e);
          validate(e.target.value);
        }}
        onBlur={(e) => {
          setValidationResult(null);
          inputProps.onBlur?.(e);
        }}
        type="text"
        placeholder={placeholder}
        className={`form-control form-control-sm ${isInvalid ? 'is-invalid' : ''}`}
      />
      {isInvalid && (
        <div className="invalid-feedback d-block my-1">
          {validationResult.message}
        </div>
      )}
    </div>
  );
};

/**
 * Tree item name input component for rename/create mode
 * Wraps TreeNameInputSubstance with headless-tree's item props
 */
export const TreeNameInput: FC<TreeItemToolProps> = ({ item }) => {
  const { t } = useTranslation();
  const inputValidator = useInputValidator(ValidationTarget.PAGE);

  const validateName = (name: string): InputValidationResult | null => {
    return inputValidator(name) ?? null;
  };

  // Show placeholder only for create mode
  const isCreating = item.getId() === CREATING_PAGE_VIRTUAL_ID;
  const placeholder = isCreating ? t('Input page name') : undefined;

  return (
    <TreeNameInputSubstance
      inputProps={item.getRenameInputProps()}
      validateName={validateName}
      placeholder={placeholder}
      className="flex-grow-1"
    />
  );
};
