import type { JSX } from 'react';
import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'next-i18next';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Badge, Button, FormGroup, Input, Label } from 'reactstrap';

import { providerHasCatalog } from '../../interfaces/catalog-providers';
import { isValidProviderOptionsJson } from '../../utils/provider-options-validation';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { getProviderOptionsJsonStatus } from './provider-options-json-status';
import { buildInitialProviderOptionsText } from './provider-options-namespace';
import { registerToInputProps } from './register-to-input-props';
import { useSWRxSelectableModels } from './use-selectable-models';

// Vercel AI SDK docs describing the provider-namespaced `providerOptions` shape.
const PROVIDER_OPTIONS_DOC_URL =
  'https://ai-sdk.dev/docs/foundations/provider-options';

export interface AllowedModelsFieldProps {
  /**
   * Disable every input/control when env-only mode is active (7.3). `disabled`
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
 * Removing a card is a low-emphasis trash icon and takes effect immediately (no
 * confirmation dialog); removing the default card re-assigns the default to the
 * first remaining card so the single-default invariant holds (1.3/1.5). The
 * "+ add model" button appends a card pre-seeded with the current provider's empty
 * namespace.
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

  // Fetch the selectable models for the current provider once at the field level
  // and share the result with every row. The hook returns `null` key while the
  // provider is unset, so no request is issued then (5.2).
  const { data, error } = useSWRxSelectableModels(provider);

  // Mode derivation (design "AllowedModelsField（UI 変更）"):
  // - `select` when the catalog resolved to a non-empty list (1.4).
  // - `freetext` when the provider is unset (5.2), the fetch failed (3.2), or the
  //   catalog resolved but is empty — e.g. azure-openai (3.1). In all three the
  //   admin can still type a model id, so save is never blocked (3.2).
  const selectableModelIds = data?.modelIds ?? [];
  const isResolved = data != null;
  // A request is in flight only while a provider is selected and nothing has
  // resolved or errored yet; the modelId control is disabled during that window.
  const isLoadingModels = provider !== '' && !isResolved && error == null;
  // While loading, predict the control type from the declared catalog-provider
  // set so a configured catalog provider renders the <select> immediately on open
  // — avoids a text→select flash. Once resolved, the actual list decides (a
  // catalog provider that returns an empty list still falls back to free-text).
  const useSelect = isLoadingModels
    ? providerHasCatalog(provider)
    : isResolved && selectableModelIds.length > 0;

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
          useSelect={useSelect}
          selectableModelIds={selectableModelIds}
          isLoadingModels={isLoadingModels}
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
  /**
   * Render the modelId control as a select-only dropdown (`true`) when the current
   * provider has a non-empty catalog, or as free-text input (`false`) otherwise
   * (catalog-less provider, unset provider, or fetch failure).
   */
  readonly useSelect: boolean;
  /** The catalog model ids offered as dropdown options (empty in free-text mode). */
  readonly selectableModelIds: readonly string[];
  /** The catalog fetch is in flight; the modelId control is disabled meanwhile. */
  readonly isLoadingModels: boolean;
  readonly docUrl: string;
  readonly placeholder: string;
  readonly onSelectDefault: () => void;
  readonly onRemove: () => void;
}

/**
 * One allowed-model card: model id (monospace) + "default" badge/radio + remove
 * trash icon + providerOptions JSON with a live valid/invalid indicator, a format
 * button, and a docs link. Extracted so each card owns its own field ids and
 * watches only its own fields (isDefault + providerOptions value).
 */
const AllowedModelRow = (props: AllowedModelRowProps): JSX.Element => {
  const {
    index,
    labelKey,
    radioGroupName,
    disabled,
    useSelect,
    selectableModelIds,
    isLoadingModels,
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

  // Watch only this card's own fields (isDefault + providerOptions text + modelId)
  // so editing a row or toggling the default re-renders just the affected rows —
  // the parent subscribes to none, keeping re-renders row-local.
  const isDefault =
    useWatch({ control, name: `allowedModels.${index}.isDefault` }) === true;
  const providerOptionsText =
    useWatch({ control, name: `allowedModels.${index}.providerOptionsText` }) ??
    '';
  // The current modelId drives the out-of-list preservation option (1.5): a saved
  // value absent from the catalog is kept as its own selectable <option>.
  const currentModelId =
    useWatch({ control, name: `allowedModels.${index}.modelId` }) ?? '';
  const hasOutOfListValue =
    currentModelId !== '' && !selectableModelIds.includes(currentModelId);
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
          {/* The form binding (`register(...modelId)`) and value format are
              identical in both modes (1.3); only the control type differs — a
              select-only dropdown when the provider has a catalog (1.4), otherwise
              the free-text input (catalog-less provider / unset / fetch failure —
              3.1/3.2/5.2). The control is disabled in env-only mode and while the
              catalog is still loading. */}
          <Input
            id={modelInputId}
            type={useSelect ? 'select' : 'text'}
            className="font-monospace flex-grow-1"
            disabled={disabled || isLoadingModels}
            {...registerToInputProps(
              register(`allowedModels.${index}.modelId`),
            )}
          >
            {/* Options only exist in select mode. Free-text mode must pass
                `undefined` (NOT `false`): a text <input> is a void element, and
                React rejects any non-null child — reactstrap only strips a
                *truthy* child, so `false` would crash. Both modes share the same
                id/class/disabled/register binding above (1.3) so the binding
                cannot drift between them — only the control type differs (1.4 vs
                3.1/3.2/5.2). */}
            {useSelect ? (
              <>
                <option value="">{t('ai_settings.model_placeholder')}</option>
                {selectableModelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                {/* Preserve a saved value that is not in the current catalog as
                    its own selected option so it is neither reset nor silently
                    changed (1.5). */}
                {hasOutOfListValue && (
                  <option value={currentModelId}>{currentModelId}</option>
                )}
              </>
            ) : undefined}
          </Input>
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
