import type { JSX } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { FormGroup, Input, Label } from 'reactstrap';

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface ModelFieldProps {
  /**
   * i18n key for the field label. The underlying `ai:model` value is universal,
   * but its meaning (and therefore its label) differs by provider — a model id
   * for most providers, the Azure *deployment name* for Azure OpenAI — so the
   * caller supplies the label.
   */
  readonly labelKey: string;
  /** Disable the input when env-only mode is active (4.2). */
  readonly disabled: boolean;
}

/**
 * The shared `ai:model` field, registered against the form owned by `AiSettings`.
 * It is rendered by whichever provider section is active (the generic one for
 * most providers, the Azure section for Azure OpenAI), so only one instance is
 * mounted at a time and the single `ai:model` value is preserved across provider
 * switches. Keeping it here avoids a provider-specific label branch leaking into
 * the otherwise provider-agnostic common-settings component.
 */
export const ModelField = (props: ModelFieldProps): JSX.Element => {
  const { labelKey, disabled } = props;
  const { t } = useTranslation('admin');
  const { register } = useFormContext<AiSettingsFormValues>();
  const modelId = useId();

  return (
    <FormGroup className="mb-3">
      <Label for={modelId}>{t(labelKey)}</Label>
      <Input
        id={modelId}
        type="text"
        disabled={disabled}
        {...registerToInputProps(register('model'))}
      />
    </FormGroup>
  );
};
