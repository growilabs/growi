import type { JSX } from 'react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import { Badge, Button, FormGroup, Input, Label } from 'reactstrap';

import {
  getProviderOptionsJsonStatus,
  isValidProviderOptionsJson,
} from '../../utils/provider-options-validation';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

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
export const AllowedModelRow = (props: AllowedModelRowProps): JSX.Element => {
  const {
    originalIndex,
    isDefault,
    labelKey,
    radioGroupName,
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
            disabled={isLoadingModels}
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
