import type { JSX } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { FormGroup, Input, Label } from 'reactstrap';

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface AiEnabledToggleProps {
  /** Disable the control when the env-only mode (`useOnlyEnvVars`) is active (7.1). */
  readonly disabled: boolean;
}

/**
 * Register-based toggle for the AI enablement flag (`app:aiEnabled`).
 *
 * Reads/writes the `aiEnabled` field of the shared react-hook-form context
 * owned by the `AiSettings` container; persistence happens on the container's
 * single save (7.1).
 */
export const AiEnabledToggle = (props: AiEnabledToggleProps): JSX.Element => {
  const { disabled } = props;
  const { t } = useTranslation('admin');
  const { register } = useFormContext<AiSettingsFormValues>();

  const inputId = useId();

  return (
    <FormGroup switch className="mb-3">
      <Input
        id={inputId}
        type="switch"
        role="switch"
        disabled={disabled}
        {...registerToInputProps(register('aiEnabled'))}
      />
      <Label htmlFor={inputId} className="ms-2 fw-bold">
        {t('ai_settings.ai_enabled_label')}
      </Label>
    </FormGroup>
  );
};
