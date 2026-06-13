import type { JSX } from 'react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { FormGroup, Input, Label } from 'reactstrap';

export interface AiEnabledToggleProps {
  /** Current value of `app:aiEnabled`. */
  readonly aiEnabled: boolean;
  /** Invoked with the next enabled value when the admin toggles the switch. */
  readonly onChange: (next: boolean) => void;
  /** Disable the control when the env-only mode (`useOnlyEnvVars`) is active (7.1). */
  readonly disabled: boolean;
}

/**
 * Presentational, controlled toggle for the AI enablement flag (`app:aiEnabled`).
 *
 * State and persistence live in the container (`AiSettings`); this component only
 * renders the current value and reports changes via `onChange`.
 */
export const AiEnabledToggle = (props: AiEnabledToggleProps): JSX.Element => {
  const { aiEnabled, onChange, disabled } = props;
  const { t } = useTranslation('admin');

  const inputId = useId();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked);
    },
    [onChange],
  );

  return (
    <FormGroup switch className="mb-3">
      <Input
        id={inputId}
        type="switch"
        role="switch"
        checked={aiEnabled}
        disabled={disabled}
        onChange={handleChange}
      />
      <Label htmlFor={inputId} className="ms-2">
        {t('ai_settings.ai_enabled_label')}
      </Label>
    </FormGroup>
  );
};
