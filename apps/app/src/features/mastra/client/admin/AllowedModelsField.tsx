import type { JSX } from 'react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Badge, Button, FormGroup, Input, Label } from 'reactstrap';

import { ConfirmModal } from '~/client/components/Admin/App/ConfirmModal';
import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import type { AiProvider } from '../../interfaces/ai-provider';
import type { RefreshModelCatalogResponse } from '../../interfaces/refresh-model-catalog-response';
import { isValidProviderOptionsJson } from '../../utils/provider-options-validation';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { setDefaultAllowedModelAt } from './ai-settings-form-values';
import { getProviderOptionsJsonStatus } from './provider-options-json-status';
import { buildInitialProviderOptionsText } from './provider-options-namespace';
import { registerToInputProps } from './register-to-input-props';
import { useSWRxSelectableModels } from './use-selectable-models';

// Vercel AI SDK docs describing the provider-namespaced `providerOptions` shape.
const PROVIDER_OPTIONS_DOC_URL =
  'https://ai-sdk.dev/docs/foundations/provider-options';

export interface AllowedModelsFieldProps {
  /**
   * The provider slot this field edits (R2.2). It scopes EVERY behavior of the
   * field: which rows are displayed, the catalog fetched, the seeded
   * providerOptions namespace, the model/deployment label, and the same-provider
   * duplicate check. The owning provider of a row is fixed at add time and never
   * changes — this prop is the single source for it.
   */
  readonly provider: AiProvider;
  /**
   * Disable every input/control when env-only mode is active (R5.2). `disabled`
   * (not `readOnly`) so the locked fields are removed from the tab order and
   * cannot receive focus. Model editing itself is NOT locked by env-only (R5.3);
   * this prop is driven by the caller for reasons independent of env-only.
   */
  readonly disabled: boolean;
}

/**
 * The provider-scoped allowed-models editor, registered against the shared
 * react-hook-form context owned by `AiSettings`. One instance is mounted per
 * active provider panel (task 6.5 renders `<AllowedModelsField provider={p} />`).
 *
 * ## index integrity (the load-bearing correctness rule)
 * A SINGLE `useFieldArray` spans the whole flat `allowedModels` array so the
 * GLOBAL single-default invariant (R3.1) is validated across providers. The
 * per-provider view is DISPLAY-ONLY: rows are `fields` filtered to
 * `field.provider === provider`, each paired with its ORIGINAL index in the full
 * array. Every array/field operation (remove, the register paths, the ★ default,
 * the duplicate check) is keyed on that `originalIndex`, NEVER the filtered
 * display index — otherwise an op in this panel would corrupt another provider's
 * row (a cross-provider bug). The owning `provider` is set once at add time and
 * never mutated, so `field.provider` from the field snapshot is a reliable filter
 * key.
 *
 * ## default invariant under form edits (R3.1/R3.3, via the shared helper)
 * - Adding the first model to an EMPTY global list auto-marks it default.
 * - Deleting the default row reassigns the default to the first remaining GLOBAL
 *   row (which may belong to another provider — the default is global); if none
 *   remain, there is no default (an empty list is a valid state).
 * Both the ★ pick and the delete-reassign route through `setDefaultAllowedModelAt`
 * — the same rewrite used by `DefaultModelSelector` — so the invariant is written
 * identically from every call site.
 */
export const AllowedModelsField = (
  props: AllowedModelsFieldProps,
): JSX.Element => {
  const { provider, disabled } = props;
  const { t } = useTranslation('admin');
  const { control, setValue, getValues } =
    useFormContext<AiSettingsFormValues>();

  const { fields, append, remove } = useFieldArray<
    AiSettingsFormValues,
    'allowedModels'
  >({ control, name: 'allowedModels' });

  // The radios share one group name so only one is checkable at the DOM level;
  // useId() guarantees uniqueness if multiple instances ever co-exist. (Used as a
  // `name` attribute — safe; never passed to a reactstrap `target` prop.)
  const radioGroupName = useId();

  // Subscribe to the whole flat list. This is deliberately a field-level watch
  // (not row-local): the same-provider duplicate check and the registered-id
  // exclusion are inherently cross-row, so the field must observe every row's
  // live value. Only one provider panel is mounted at a time, so the extra
  // re-renders are scoped to the active panel.
  const watchedModels =
    useWatch<AiSettingsFormValues, 'allowedModels'>({
      control,
      name: 'allowedModels',
    }) ?? [];

  // Display-only mapping: keep each visible row's ORIGINAL position in the flat
  // array so every operation targets the correct global index.
  const displayedRows = useMemo(
    () =>
      fields
        .map((field, originalIndex) => ({ field, originalIndex }))
        .filter(({ field }) => field.provider === provider),
    [fields, provider],
  );

  // Non-empty model ids already registered under THIS provider (from live
  // values). Drives the registered-excluded catalog options and the duplicate
  // detection below — both scoped to the provider so the same id under a
  // different provider is neither excluded nor flagged (R2.3).
  const registeredModelIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const model of watchedModels) {
      if (model.provider === provider && model.modelId !== '') {
        ids.add(model.modelId);
      }
    }
    return ids;
  }, [watchedModels, provider]);

  // Model ids that appear on 2+ rows of THIS provider — surfaced as a row error
  // (R2.4). The server is the final authority (R4.1); this is the inline client
  // signal.
  const duplicateModelIds = useMemo<Set<string>>(() => {
    const counts = new Map<string, number>();
    for (const model of watchedModels) {
      if (model.provider === provider && model.modelId !== '') {
        counts.set(model.modelId, (counts.get(model.modelId) ?? 0) + 1);
      }
    }
    const duplicates = new Set<string>();
    for (const [id, count] of counts) {
      if (count > 1) {
        duplicates.add(id);
      }
    }
    return duplicates;
  }, [watchedModels, provider]);

  // Fetch the selectable models for THIS provider once at the field level and
  // share the result with every row.
  const { data, error, invalidateAllProviders } =
    useSWRxSelectableModels(provider);

  // Manual catalog refresh: ask the server to re-ingest models.dev and persist
  // the snapshot, then invalidate every cached provider list — the snapshot is
  // replaced for ALL providers server-side, so a mutate bound to the current
  // provider only would leave other visited providers' immutable caches
  // pre-refresh until a page reload. Preserved unchanged through the
  // provider-scoping (it is picker-owned functionality). Intentionally NOT
  // disabled in env-only mode: the catalog is a server-side cache of public
  // model metadata, not an AI setting, and env-only deployments (e.g.
  // GROWI.cloud) are a primary audience of this action.
  const [isRefreshingCatalog, setRefreshingCatalog] = useState(false);
  const refreshCatalog = useCallback(async (): Promise<void> => {
    setRefreshingCatalog(true);
    try {
      await apiv3Post<RefreshModelCatalogResponse>(
        '/ai-settings/refresh-model-catalog',
      );
      await invalidateAllProviders();
      toastSuccess(t('ai_settings.refresh_model_catalog_success'));
    } catch {
      // The server answers a generic 500 on failure (the last-good catalog
      // stays in effect) — surface the localized failure message instead.
      toastError(t('ai_settings.refresh_model_catalog_failed'));
    } finally {
      setRefreshingCatalog(false);
    }
  }, [invalidateAllProviders, t]);

  // The refresh triggers server-side OUTBOUND communication (models.dev), so
  // the button opens a confirmation first — the request runs only after the
  // admin explicitly confirms.
  const [isRefreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const openRefreshConfirm = useCallback((): void => {
    setRefreshConfirmOpen(true);
  }, []);
  const cancelRefreshConfirm = useCallback((): void => {
    setRefreshConfirmOpen(false);
  }, []);
  const confirmRefreshCatalog = useCallback(async (): Promise<void> => {
    setRefreshConfirmOpen(false);
    await refreshCatalog();
  }, [refreshCatalog]);

  // Mode derivation:
  // - `select` only when the catalog resolved to a non-empty list (R2.6).
  // - `freetext` when the fetch failed or the catalog resolved but is empty —
  //   e.g. azure-openai (R2.7). Either way the admin can still type a model id,
  //   so save is never blocked.
  //
  // NOTE: the <select> is rendered ONLY after the catalog resolves — never during
  // the loading window. react-hook-form applies the saved value to an
  // uncontrolled <select> once, when the element mounts; if the matching <option>
  // does not yet exist (loading, empty list), the value is lost and the field
  // shows the placeholder even after options arrive later. Mounting the select
  // only when its options already exist keeps the saved value displayed on reload.
  const selectableModelIds = data?.modelIds ?? [];
  const isResolved = data != null;
  // A request is in flight only until data or error arrives; the modelId control
  // is disabled during that window. `provider` is always a real provider here (a
  // required prop), so the hook always issues a request.
  const isLoadingModels = !isResolved && error == null;
  // `selectableModelIds` is [] until the catalog resolves (data?.modelIds ?? []),
  // so a non-empty list already implies "resolved" — no separate isResolved guard.
  const useSelect = selectableModelIds.length > 0;

  // Azure OpenAI stores the *deployment name* in `modelId`, so the label changes
  // by provider (data-driven on the prop, no provider-specific branch elsewhere).
  const isAzure = provider === 'azure-openai';
  const modelLabelKey = isAzure
    ? 'ai_settings.azure_model_deployment_label'
    : 'ai_settings.model_label';
  // The add button likewise follows the provider so Azure reads "+ Add deployment".
  const addLabelKey = isAzure
    ? 'ai_settings.azure_add_deployment'
    : 'ai_settings.add_model';

  // Single global default (R3.1): route the rewrite through the shared helper so
  // exactly one row is default and the model/providerOptions values are
  // preserved. Keyed on the row's ORIGINAL index in the flat array.
  const selectDefault = useCallback(
    (originalIndex: number): void => {
      setValue(
        'allowedModels',
        setDefaultAllowedModelAt(getValues('allowedModels'), originalIndex),
        { shouldDirty: true },
      );
    },
    [getValues, setValue],
  );

  // Remove a row by its ORIGINAL index; when it was the default, reassign the
  // default to the first remaining GLOBAL row (index 0 of the whole array — it
  // may belong to another provider, which is correct since the default is
  // global). If none remain, leave no default (R3.1/R3.3).
  const removeRow = useCallback(
    (originalIndex: number): void => {
      const models = getValues('allowedModels');
      const removedWasDefault = models[originalIndex]?.isDefault === true;
      remove(originalIndex);
      if (removedWasDefault) {
        const remaining = getValues('allowedModels');
        if (remaining.length > 0) {
          setValue('allowedModels', setDefaultAllowedModelAt(remaining, 0), {
            shouldDirty: true,
          });
        }
      }
    },
    [getValues, remove, setValue],
  );

  // Append a new row OWNED by this provider (R2.2), seeded with the provider's
  // empty providerOptions namespace. The first model added to an EMPTY global
  // list is the default so the single-default invariant holds from the start
  // (R3.1/R3.3); a row added while other rows exist keeps the current default.
  const addRow = useCallback((): void => {
    append({
      provider,
      modelId: '',
      providerOptionsText: buildInitialProviderOptionsText(provider),
      isDefault: getValues('allowedModels').length === 0,
    });
  }, [append, getValues, provider]);

  return (
    <FormGroup className="mb-3">
      <div className="d-flex align-items-center mt-4 mb-1">
        <h3 className="h5 fw-bold m-0">
          {t('ai_settings.models_section_title')}
        </h3>
        <Button
          type="button"
          color="link"
          size="sm"
          className="ms-auto p-0 d-inline-flex align-items-center"
          disabled={isRefreshingCatalog}
          onClick={openRefreshConfirm}
        >
          <span
            className="material-symbols-outlined fs-6 me-1"
            aria-hidden="true"
          >
            refresh
          </span>
          {t('ai_settings.refresh_model_catalog')}
        </Button>
      </div>
      <ConfirmModal
        isModalOpen={isRefreshConfirmOpen}
        warningMessage={t('ai_settings.refresh_model_catalog_confirmation')}
        supplymentaryMessage={null}
        confirmButtonTitle={t('ai_settings.refresh_model_catalog_confirm')}
        onConfirm={confirmRefreshCatalog}
        onCancel={cancelRefreshConfirm}
      />
      <p className="form-text text-muted mt-0 mb-3">
        {t('ai_settings.models_section_desc')}
      </p>

      {displayedRows.map(({ field, originalIndex }) => (
        <AllowedModelRow
          key={field.id}
          originalIndex={originalIndex}
          // isDefault is sourced from the field-level whole-array watch (not a
          // row-local nested watch): the ★ pick and the delete-reassign rewrite
          // the WHOLE `allowedModels` array via setValue, and a nested
          // `useWatch('allowedModels.N.isDefault')` does not reliably re-fire on
          // an array-root replacement, whereas the whole-array watch does.
          isDefault={watchedModels[originalIndex]?.isDefault === true}
          labelKey={modelLabelKey}
          radioGroupName={radioGroupName}
          disabled={disabled}
          useSelect={useSelect}
          selectableModelIds={selectableModelIds}
          registeredModelIds={registeredModelIds}
          duplicateModelIds={duplicateModelIds}
          isLoadingModels={isLoadingModels}
          docUrl={PROVIDER_OPTIONS_DOC_URL}
          placeholder={buildInitialProviderOptionsText(provider)}
          onSelectDefault={() => selectDefault(originalIndex)}
          onRemove={() => removeRow(originalIndex)}
        />
      ))}

      <Button
        type="button"
        color="secondary"
        outline
        className="w-100 d-flex align-items-center justify-content-center"
        style={{ borderStyle: 'dashed' }}
        disabled={disabled}
        onClick={addRow}
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
  /** Position of this row in the flat `allowedModels` array (NOT the display index). */
  readonly originalIndex: number;
  /**
   * Whether this row is the global default. Provided by the parent from its
   * whole-array watch (not a row-local nested watch) so it reflects the array-root
   * `setValue` used by the ★ pick and the delete-reassign.
   */
  readonly isDefault: boolean;
  readonly labelKey: string;
  readonly radioGroupName: string;
  readonly disabled: boolean;
  /**
   * Render the modelId control as a select-only dropdown (`true`) when the
   * provider has a non-empty catalog, or as free-text input (`false`) otherwise.
   */
  readonly useSelect: boolean;
  /** The catalog model ids offered as dropdown options (empty in free-text mode). */
  readonly selectableModelIds: readonly string[];
  /** Non-empty model ids already registered under this provider (any row). */
  readonly registeredModelIds: ReadonlySet<string>;
  /** Model ids duplicated within this provider — drives the row-level error. */
  readonly duplicateModelIds: ReadonlySet<string>;
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
 * link, and a docs link. Extracted so each card owns its own field ids and
 * watches only its own fields (isDefault + modelId + providerOptions value). All
 * register/watch paths are keyed on `originalIndex` (the flat-array position).
 */
const AllowedModelRow = (props: AllowedModelRowProps): JSX.Element => {
  const {
    originalIndex,
    isDefault,
    labelKey,
    radioGroupName,
    disabled,
    useSelect,
    selectableModelIds,
    registeredModelIds,
    duplicateModelIds,
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

  // Watch only this card's own value fields (modelId + providerOptions) so
  // editing a row re-renders just that row. `isDefault` comes from the parent
  // (see AllowedModelRowProps) — it is set by an array-root rewrite.
  const providerOptionsText =
    useWatch({
      control,
      name: `allowedModels.${originalIndex}.providerOptionsText`,
    }) ?? '';
  const currentModelId =
    useWatch({ control, name: `allowedModels.${originalIndex}.modelId` }) ?? '';

  // Registered-excluded options (R2.6): offer catalog ids NOT already registered
  // by another row of this provider, but always keep this row's OWN current value
  // selectable (so switching this row's model is possible and its saved value is
  // never dropped).
  const availableModelIds = selectableModelIds.filter(
    (id) => id === currentModelId || !registeredModelIds.has(id),
  );
  // A saved value absent from the current catalog is preserved as its own option
  // so it is neither reset nor silently changed.
  const hasOutOfListValue =
    currentModelId !== '' && !selectableModelIds.includes(currentModelId);

  // Same-provider duplicate (R2.4): flagged when this row's non-empty id collides
  // with another row of the same provider.
  const isDuplicate =
    currentModelId !== '' && duplicateModelIds.has(currentModelId);

  const status = useMemo(
    () => getProviderOptionsJsonStatus(providerOptionsText),
    [providerOptionsText],
  );
  const isInvalidJson =
    status.kind === 'syntax-error' || status.kind === 'shape-error';

  return (
    <FormGroup
      tag="fieldset"
      className="rounded p-3 mb-2 border"
      data-testid="allowed-model-row"
    >
      {/* The label/badge sit on their own line; the input, default radio, and
          remove icon share one center-aligned row below. */}
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
              identical in both modes; only the control type differs — a
              select-only dropdown when the provider has a catalog (R2.6),
              otherwise the free-text input (catalog-less provider / fetch failure
              — R2.7). Disabled in env-only mode and while the catalog is loading. */}
          <Input
            id={modelInputId}
            type={useSelect ? 'select' : 'text'}
            className="font-monospace flex-grow-1"
            disabled={disabled || isLoadingModels}
            invalid={isDuplicate}
            {...registerToInputProps(
              register(`allowedModels.${originalIndex}.modelId`),
            )}
          >
            {/* Options only exist in select mode. Free-text mode must pass
                `undefined` (NOT `false`): a text <input> is a void element, and
                React rejects any non-null child — reactstrap only strips a
                *truthy* child, so `false` would crash. */}
            {useSelect ? (
              <>
                <option value="">{t('ai_settings.model_placeholder')}</option>
                {availableModelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
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
        {isDuplicate && (
          <div className="invalid-feedback d-block">
            {t('ai_settings.model_duplicate_error')}
          </div>
        )}
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
          invalid={isInvalidJson}
          style={{ backgroundImage: 'none' }}
          {...registerToInputProps(
            register(`allowedModels.${originalIndex}.providerOptionsText`, {
              validate: (v) =>
                isValidProviderOptionsJson(v) ||
                t('ai_settings.provider_options_invalid_json'),
            }),
          )}
        />
        {isInvalidJson && (
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
