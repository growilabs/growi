import type { JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button, FormGroup } from 'reactstrap';

import { ConfirmModal } from '~/client/components/Admin/App/ConfirmModal';

import type { AiProvider } from '../../interfaces/ai-provider';
import { AllowedModelRow } from './AllowedModelRow';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { setDefaultAllowedModelAt } from './ai-settings-form-values';
import { buildInitialProviderOptionsText } from './provider-options-namespace';
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
}

/**
 * The provider-scoped allowed-models editor, registered against the shared
 * react-hook-form context owned by `AiSettings`. One instance is mounted per
 * active provider panel (task 6.5 renders `<AllowedModelsField provider={p} />`).
 * Each row is an `AllowedModelRow`. (The global "refresh model catalog" action is
 * NOT here — it lives once at the top of `AiSettings`, since one refresh replaces
 * the snapshot for every provider at once.)
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
  const { provider } = props;
  const { t } = useTranslation('admin');
  const { control, setValue, getValues } =
    useFormContext<AiSettingsFormValues>();

  const { fields, append, remove } = useFieldArray<
    AiSettingsFormValues,
    'allowedModels'
  >({ control, name: 'allowedModels' });

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

  // Non-empty model ids under THIS provider (from live values), derived in ONE
  // pass over a per-id count map — both scoped to the provider so the same id under
  // a different provider is neither excluded nor flagged (R2.3):
  //   - registeredModelIds: every id present (drives the registered-excluded
  //     catalog options); the count map's distinct keys ARE this set.
  //   - duplicateModelIds: ids on 2+ rows, surfaced as a row error (R2.4). The
  //     server is the final authority (R4.1); this is the inline client signal.
  const { registeredModelIds, duplicateModelIds } = useMemo(() => {
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
    return {
      registeredModelIds: new Set(counts.keys()),
      duplicateModelIds: duplicates,
    };
  }, [watchedModels, provider]);

  // Fetch the selectable models for THIS provider once at the field level and
  // share the result with every row.
  const { data, error } = useSWRxSelectableModels(provider);

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
  const selectableModels = data?.models ?? [];
  const isResolved = data != null;
  // A request is in flight only until data or error arrives; the modelId control
  // is disabled during that window. `provider` is always a real provider here (a
  // required prop), so the hook always issues a request.
  const isLoadingModels = !isResolved && error == null;
  // `selectableModels` is [] until the catalog resolves (data?.models ?? []),
  // so a non-empty list already implies "resolved" — no separate isResolved guard.
  const useSelect = selectableModels.length > 0;

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

  // Deleting a filled row discards its saved values (possibly hand-written
  // providerOptions JSON), so it asks for confirmation first. A still-blank row
  // (no modelId) carries nothing worth protecting and is removed immediately —
  // discarding an accidentally-added row shouldn't pay the modal friction.
  const [pendingRemoval, setPendingRemoval] = useState<{
    originalIndex: number;
    /** Named by the official display name; falls back to the raw model id. */
    modelName: string;
  } | null>(null);

  const requestRemoveRow = useCallback(
    (originalIndex: number): void => {
      const row = getValues('allowedModels')[originalIndex];
      const modelId = row?.modelId ?? '';
      if (modelId.trim() === '') {
        removeRow(originalIndex);
        return;
      }
      // Confirm with the human-readable name; `displayName` is optional
      // (out-of-catalog or legacy rows), so fall back to the id.
      const displayName = row?.displayName ?? '';
      setPendingRemoval({
        originalIndex,
        modelName: displayName.trim() !== '' ? displayName : modelId,
      });
    },
    [getValues, removeRow],
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
      {/* Tab-panel subsection heading — fs-5 (1.25rem), one step below the
          "Providers" section (fs-4) and matching the sibling "Azure OpenAI
          settings" subsection. */}
      <h3 className="fs-5 fw-bold mt-4 mb-1">
        {t('ai_settings.models_section_title')}
      </h3>
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
          useSelect={useSelect}
          selectableModels={selectableModels}
          registeredModelIds={registeredModelIds}
          duplicateModelIds={duplicateModelIds}
          isLoadingModels={isLoadingModels}
          docUrl={PROVIDER_OPTIONS_DOC_URL}
          placeholder={buildInitialProviderOptionsText(provider)}
          onSelectDefault={() => selectDefault(originalIndex)}
          onRemove={() => requestRemoveRow(originalIndex)}
        />
      ))}

      <Button
        type="button"
        color="secondary"
        outline
        className="w-100 d-flex align-items-center justify-content-center"
        style={{ borderStyle: 'dashed' }}
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

      <ConfirmModal
        isModalOpen={pendingRemoval != null}
        // text-warning (not the default text-danger): the removal is only
        // staged on the form and takes effect on save, so nothing destructive
        // has happened yet — the same severity rationale as the
        // catalog-refresh modal.
        headerClassName="text-warning"
        warningMessage={t('ai_settings.remove_model_confirmation', {
          modelName: pendingRemoval?.modelName ?? '',
        })}
        supplymentaryMessage={null}
        confirmButtonTitle={t('ai_settings.remove_model_confirm')}
        onConfirm={() => {
          if (pendingRemoval != null) {
            removeRow(pendingRemoval.originalIndex);
          }
          setPendingRemoval(null);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </FormGroup>
  );
};
