import type { JSX } from 'react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFieldArray, useFormContext } from 'react-hook-form';
import {
  Button,
  FormFeedback,
  FormGroup,
  FormText,
  Input,
  Label,
} from 'reactstrap';

import { isValidProviderOptionsJson } from '../../utils/provider-options-validation';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

// Vercel AI SDK docs describing the provider-namespaced `providerOptions` shape.
const PROVIDER_OPTIONS_DOC_URL =
  'https://ai-sdk.dev/docs/foundations/provider-options';

// Shown as the textarea placeholder to illustrate the provider-namespaced JSON
// shape. Language-neutral (a code example), so it is not an i18n string.
const PROVIDER_OPTIONS_PLACEHOLDER = `{
    "openai": {
        "reasoningEffort": "low",
        "reasoningSummary": "auto"
    }
}`;

export interface AllowedModelsFieldProps {
  /**
   * Disable every input/control when env-only mode is active (1.6). `disabled`
   * (not `readOnly`) so the locked fields are removed from the tab order and
   * cannot receive focus.
   */
  readonly disabled: boolean;
}

/**
 * The allowed-models list editor (`ai:allowedModels`), registered against the
 * shared react-hook-form context owned by `AiSettings`. Replaces the former
 * single `ai:model` field + single providerOptions textarea.
 *
 * Each row is one allowed model: a model-id text input, a "default" radio
 * (`isDefault`, exactly one across the list — 1.3), a providerOptions JSON
 * textarea validated by the shared `isValidProviderOptionsJson` (2.1/2.3/2.4),
 * and a remove button. An "+ add model" button appends a row. Removing the
 * default row re-assigns the default to the first remaining row so the
 * single-default invariant is preserved.
 *
 * The row label follows the watched provider: the Azure *deployment name* for
 * Azure OpenAI, otherwise the generic model id (the value is universal but its
 * meaning is provider-specific).
 */
export const AllowedModelsField = (
  props: AllowedModelsFieldProps,
): JSX.Element => {
  const { disabled } = props;
  const { t } = useTranslation('admin');
  const {
    control,
    register,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<AiSettingsFormValues>();

  const { fields, append, remove } = useFieldArray<
    AiSettingsFormValues,
    'allowedModels'
  >({ control, name: 'allowedModels' });

  // The radios share one group name so only one is checkable at the DOM level;
  // useId() guarantees uniqueness if multiple instances ever co-exist.
  const radioGroupName = useId();

  // Azure OpenAI stores the *deployment name* in `model`, so the label changes
  // by provider (data-driven on the watched value, no provider-specific branch
  // leaking elsewhere).
  const isAzure = watch('provider') === 'azure-openai';
  const modelLabelKey = isAzure
    ? 'ai_settings.azure_model_deployment_label'
    : 'ai_settings.model_label';

  // Single-default invariant (1.3): selecting a row's radio sets its isDefault
  // and clears every other row's. Done via setValue (not field replacement) so
  // the model/providerOptions inputs keep their values and focus.
  const selectDefault = useCallback(
    (selectedIndex: number): void => {
      const models = getValues('allowedModels');
      models.forEach((_, i) => {
        setValue(`allowedModels.${i}.isDefault`, i === selectedIndex, {
          shouldDirty: true,
        });
      });
    },
    [getValues, setValue],
  );

  // Remove a row, re-assigning the default to the first remaining row when the
  // removed row was the default (keeps exactly one default — 1.3/1.5).
  const removeRow = useCallback(
    (index: number): void => {
      const models = getValues('allowedModels');
      const removedWasDefault = models[index]?.isDefault === true;
      remove(index);
      if (removedWasDefault) {
        const remaining = getValues('allowedModels');
        if (remaining.length > 0) {
          setValue('allowedModels.0.isDefault', true, { shouldDirty: true });
        }
      }
    },
    [getValues, remove, setValue],
  );

  return (
    <FormGroup className="mb-3">
      <Label>{t(modelLabelKey)}</Label>

      {fields.map((field, index) => (
        <AllowedModelRow
          key={field.id}
          index={index}
          labelKey={modelLabelKey}
          radioGroupName={radioGroupName}
          disabled={disabled}
          isDefault={watch(`allowedModels.${index}.isDefault`) === true}
          invalidProviderOptions={
            errors.allowedModels?.[index]?.providerOptionsText != null
          }
          register={register}
          onSelectDefault={() => selectDefault(index)}
          onRemove={() => removeRow(index)}
          t={t}
        />
      ))}

      <Button
        type="button"
        color="secondary"
        outline
        size="sm"
        disabled={disabled}
        onClick={() =>
          append({ model: '', providerOptionsText: '', isDefault: false })
        }
      >
        {t('ai_settings.add_model')}
      </Button>

      <FormText className="d-block mt-2">
        <span
          // biome-ignore lint/security/noDangerouslySetInnerHtml: includes <br> markup from i18n strings
          dangerouslySetInnerHTML={{
            __html: t('ai_settings.provider_options_help'),
          }}
        />{' '}
        <a
          href={PROVIDER_OPTIONS_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {PROVIDER_OPTIONS_DOC_URL}
        </a>
      </FormText>
    </FormGroup>
  );
};

interface AllowedModelRowProps {
  readonly index: number;
  readonly labelKey: string;
  readonly radioGroupName: string;
  readonly disabled: boolean;
  readonly isDefault: boolean;
  readonly invalidProviderOptions: boolean;
  readonly register: ReturnType<
    typeof useFormContext<AiSettingsFormValues>
  >['register'];
  readonly onSelectDefault: () => void;
  readonly onRemove: () => void;
  readonly t: (key: string) => string;
}

/**
 * One allowed-model row: model id + default radio + collapsible providerOptions
 * JSON + remove. Extracted so each row owns its own field ids (label/textarea
 * association) without colliding across rows.
 */
const AllowedModelRow = (props: AllowedModelRowProps): JSX.Element => {
  const {
    index,
    labelKey,
    radioGroupName,
    disabled,
    isDefault,
    invalidProviderOptions,
    register,
    onSelectDefault,
    onRemove,
    t,
  } = props;

  const modelInputId = useId();
  const providerOptionsId = useId();
  const radioId = useId();

  return (
    <FormGroup
      tag="fieldset"
      className="border rounded p-3 mb-2"
      data-testid="allowed-model-row"
    >
      <div className="d-flex align-items-center gap-2 mb-2">
        <div className="flex-grow-1">
          <Label for={modelInputId} className="form-label small mb-1">
            {t(labelKey)}
          </Label>
          <Input
            id={modelInputId}
            type="text"
            disabled={disabled}
            {...registerToInputProps(register(`allowedModels.${index}.model`))}
          />
        </div>

        <FormGroup check className="mt-4 mb-0 text-nowrap">
          <Input
            id={radioId}
            type="radio"
            role="radio"
            name={radioGroupName}
            checked={isDefault}
            disabled={disabled}
            onChange={onSelectDefault}
          />
          <Label check for={radioId} className="ms-1">
            {t('ai_settings.default_model_label')}
          </Label>
        </FormGroup>

        <Button
          type="button"
          color="danger"
          outline
          size="sm"
          className="mt-4"
          disabled={disabled}
          onClick={onRemove}
        >
          {t('ai_settings.remove_model')}
        </Button>
      </div>

      <div>
        <Label for={providerOptionsId} className="form-label small mb-1">
          {t('ai_settings.provider_options_label')}
        </Label>
        <Input
          id={providerOptionsId}
          type="textarea"
          rows={6}
          placeholder={PROVIDER_OPTIONS_PLACEHOLDER}
          disabled={disabled}
          invalid={invalidProviderOptions}
          {...registerToInputProps(
            register(`allowedModels.${index}.providerOptionsText`, {
              validate: (v) =>
                isValidProviderOptionsJson(v) ||
                t('ai_settings.provider_options_invalid_json'),
            }),
          )}
        />
        {invalidProviderOptions && (
          <FormFeedback>
            {t('ai_settings.provider_options_invalid_json')}
          </FormFeedback>
        )}
      </div>
    </FormGroup>
  );
};
