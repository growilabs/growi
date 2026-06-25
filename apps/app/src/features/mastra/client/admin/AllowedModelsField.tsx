import type { JSX } from 'react';
import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'next-i18next';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Badge, Button, FormGroup, Input, Label } from 'reactstrap';

import { isValidProviderOptionsJson } from '../../utils/provider-options-validation';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { getProviderOptionsJsonStatus } from './provider-options-json-status';
import { buildInitialProviderOptionsText } from './provider-options-namespace';
import { registerToInputProps } from './register-to-input-props';

// Vercel AI SDK docs describing the provider-namespaced `providerOptions` shape.
const PROVIDER_OPTIONS_DOC_URL =
  'https://ai-sdk.dev/docs/foundations/provider-options';

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
 * shared react-hook-form context owned by `AiSettings`.
 *
 * The section is headed "Models" with a single one-line description; one card per
 * allowed model. Each card carries the model id (its own identifier — no separate
 * alias field), a "set as default" radio (`isDefault`, exactly one across the
 * list — 1.3), and a providerOptions JSON textarea. The card currently chosen as
 * the default is marked with a "default" badge next to the model label and its
 * radio checked.
 *
 * Removing a card is a low-emphasis trash icon gated by a confirmation dialog;
 * removing the default card re-assigns the default to the first remaining card so
 * the single-default invariant holds (1.3/1.5). The "+ add model" button appends
 * a card pre-seeded with the current provider's empty namespace.
 *
 * The model label follows the watched provider: the Azure *deployment name* for
 * Azure OpenAI, otherwise the generic model id (the value is universal but its
 * meaning is provider-specific).
 */
export const AllowedModelsField = (
  props: AllowedModelsFieldProps,
): JSX.Element => {
  const { disabled } = props;
  const { t } = useTranslation('admin');
  const { control, watch, setValue, getValues } =
    useFormContext<AiSettingsFormValues>();

  const { fields, append, remove } = useFieldArray<
    AiSettingsFormValues,
    'allowedModels'
  >({ control, name: 'allowedModels' });

  // The radios share one group name so only one is checkable at the DOM level;
  // useId() guarantees uniqueness if multiple instances ever co-exist.
  const radioGroupName = useId();

  const provider = watch('provider');

  // Azure OpenAI stores the *deployment name* in `modelId`, so the label changes
  // by provider (data-driven on the watched value, no provider-specific branch
  // leaking elsewhere).
  const isAzure = provider === 'azure-openai';
  const modelLabelKey = isAzure
    ? 'ai_settings.azure_model_deployment_label'
    : 'ai_settings.model_label';
  // The add button likewise follows the provider so Azure reads "+ Add deployment"
  // (the value is a deployment name there, not a model id).
  const addLabelKey = isAzure
    ? 'ai_settings.azure_add_deployment'
    : 'ai_settings.add_model';

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
      <h3 className="h5 fw-bold mt-4 mb-1">
        {t('ai_settings.models_section_title')}
      </h3>
      <p className="form-text text-muted mt-0 mb-3">
        {t('ai_settings.models_section_desc')}
      </p>

      {fields.map((field, index) => (
        <AllowedModelRow
          key={field.id}
          index={index}
          labelKey={modelLabelKey}
          radioGroupName={radioGroupName}
          disabled={disabled}
          isDefault={watch(`allowedModels.${index}.isDefault`) === true}
          docUrl={PROVIDER_OPTIONS_DOC_URL}
          placeholder={buildInitialProviderOptionsText(provider)}
          onSelectDefault={() => selectDefault(index)}
          onRemove={() => removeRow(index)}
        />
      ))}

      <Button
        type="button"
        color="secondary"
        outline
        className="w-100 d-flex align-items-center justify-content-center"
        style={{ borderStyle: 'dashed' }}
        disabled={disabled}
        onClick={() =>
          append({
            modelId: '',
            providerOptionsText: buildInitialProviderOptionsText(provider),
            // The first model added to an empty list is the default so the
            // single-default invariant holds from the start.
            isDefault: fields.length === 0,
          })
        }
      >
        <span
          className="material-symbols-outlined fs-6 me-1"
          aria-hidden="true"
        >
          add
        </span>
        {t(addLabelKey)}
      </Button>
    </FormGroup>
  );
};

interface AllowedModelRowProps {
  readonly index: number;
  readonly labelKey: string;
  readonly radioGroupName: string;
  readonly disabled: boolean;
  readonly isDefault: boolean;
  readonly docUrl: string;
  readonly placeholder: string;
  readonly onSelectDefault: () => void;
  readonly onRemove: () => void;
}

/**
 * One allowed-model card: model id (monospace) + "default" badge/radio + remove
 * trash icon + providerOptions JSON with a live valid/invalid indicator, a format
 * button, and a docs link. Extracted so each card owns its own field ids and
 * watches only its own providerOptions value.
 */
const AllowedModelRow = (props: AllowedModelRowProps): JSX.Element => {
  const {
    index,
    labelKey,
    radioGroupName,
    disabled,
    isDefault,
    docUrl,
    placeholder,
    onSelectDefault,
    onRemove,
  } = props;
  const { t } = useTranslation('admin');
  const { control, register } = useFormContext<AiSettingsFormValues>();

  const modelInputId = useId();
  const providerOptionsId = useId();
  const radioId = useId();

  // Watch only this card's providerOptions text so the inline status follows
  // edits without re-rendering sibling cards.
  const providerOptionsText =
    useWatch({ control, name: `allowedModels.${index}.providerOptionsText` }) ??
    '';
  const status = useMemo(
    () => getProviderOptionsJsonStatus(providerOptionsText),
    [providerOptionsText],
  );
  const isInvalid =
    status.kind === 'syntax-error' || status.kind === 'shape-error';

  return (
    <FormGroup
      tag="fieldset"
      className="rounded p-3 mb-2 border"
      data-testid="allowed-model-row"
    >
      {/* The label/badge sit on their own line; the input, default radio, and
          remove icon share one center-aligned row below so the controls line up
          with the input box (not pushed down from the label by magic margins). */}
      <div className="mb-2">
        <div className="d-flex align-items-center gap-2 mb-1">
          <Label for={modelInputId} className="form-label small mb-0">
            {t(labelKey)}
          </Label>
          {isDefault && (
            <Badge color="info" pill>
              {t('ai_settings.default_badge')}
            </Badge>
          )}
        </div>
        <div className="d-flex align-items-center gap-3">
          <Input
            id={modelInputId}
            type="text"
            className="font-monospace flex-grow-1"
            disabled={disabled}
            {...registerToInputProps(
              register(`allowedModels.${index}.modelId`),
            )}
          />
          <FormGroup check className="mb-0 text-nowrap">
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
              {t('ai_settings.set_as_default')}
            </Label>
          </FormGroup>
          <Button
            type="button"
            color="link"
            className="text-body-secondary p-1"
            aria-label={t('ai_settings.remove_model')}
            title={t('ai_settings.remove_model')}
            disabled={disabled}
            onClick={onRemove}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              delete
            </span>
          </Button>
        </div>
      </div>

      <div>
        <div className="d-flex align-items-center mb-1">
          <Label for={providerOptionsId} className="form-label small mb-0">
            {t('ai_settings.provider_options_label')}
          </Label>
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto small d-inline-flex align-items-center"
          >
            {t('ai_settings.provider_options_doc_link')}
            <span
              className="material-symbols-outlined fs-6 ms-1"
              aria-hidden="true"
            >
              open_in_new
            </span>
          </a>
        </div>
        {/* Suppress Bootstrap's `.is-invalid` background icon: on a textarea it
            sits at the top-right and gets clipped by the scrollbar once the
            content overflows. The red border + the message below convey the
            invalid state without it. */}
        <Input
          id={providerOptionsId}
          type="textarea"
          rows={6}
          className="font-monospace"
          placeholder={placeholder}
          disabled={disabled}
          invalid={isInvalid}
          style={{ backgroundImage: 'none' }}
          {...registerToInputProps(
            register(`allowedModels.${index}.providerOptionsText`, {
              validate: (v) =>
                isValidProviderOptionsJson(v) ||
                t('ai_settings.provider_options_invalid_json'),
            }),
          )}
        />
        {isInvalid && (
          <div className="invalid-feedback d-block">
            {t('ai_settings.provider_options_invalid_json')}
            {status.kind === 'syntax-error' && (
              <span className="ms-1">
                {t('ai_settings.provider_options_error_at_line', {
                  line: status.line,
                })}
              </span>
            )}
          </div>
        )}
      </div>
    </FormGroup>
  );
};
