import { useCallback } from 'react';
import { useTranslation } from 'next-i18next';

export const AlertType = {
  WARNING: 'Warning',
  ERROR: 'Error',
} as const;

export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const ValidationTarget = {
  FOLDER: 'folder_name',
  PAGE: 'page_name',
  DEFAULT: 'field',
};

export type ValidationTarget =
  (typeof ValidationTarget)[keyof typeof ValidationTarget];

export type AlertInfo = {
  type?: AlertType;
  message?: string;
  target?: string;
};

export type InputValidationResult = {
  type: AlertType;
  typeLabel: string;
  message: string;
  target: string;
};

export type InputValidator = (
  input?: string,
  alertType?: AlertType,
) => InputValidationResult | void;

export const useInputValidator = (
  validationTarget: ValidationTarget = ValidationTarget.DEFAULT,
): InputValidator => {
  const { t } = useTranslation();

  const inputValidator: InputValidator = useCallback(
    (input?, alertType = AlertType.WARNING) => {
      if ((input ?? '').trim() === '') {
        return {
          target: validationTarget,
          type: alertType,
          typeLabel: t(alertType),
          message: t('input_validation.message.field_required', {
            target: t(`input_validation.target.${validationTarget}`),
          }),
        };
      }

      return;
    },
    [t, validationTarget],
  );

  return inputValidator;
};
