import type { JSX } from 'react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  FormGroup,
  Label,
} from 'reactstrap';

import { getProviderLabel } from '../../interfaces/ai-provider';
import {
  formatModelLabel,
  groupModelsByProvider,
} from '../../utils/model-display';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { setDefaultAllowedModelAt } from './ai-settings-form-values';

/**
 * The global default-model selector (R3.1): a cross-provider dropdown over the
 * whole `allowedModels` set. Reads/writes the shared react-hook-form context
 * owned by `AiSettings` (no form data via props).
 *
 * Options are grouped by owning provider — group headers name the provider, and
 * only providers that own at least one allowed model contribute a group (mock:
 * `groups = P.filter(p => p.models.length > 0)`). Group order follows the fixed
 * provider slot order (`AI_PROVIDERS`); within a group, models keep their
 * allow-list order. The closed trigger names the current default as
 * "provider · modelId" so the same modelId under different providers stays
 * distinguishable; with no default (empty list) it shows a neutral placeholder.
 *
 * Selecting a model rewrites the whole list via the shared `setDefaultAllowedModelAt`
 * helper so exactly one row is the default and every other row is cleared — the
 * identical single-default rewrite used by the per-row "★" control in
 * `AllowedModelsField`, keeping the invariant consistent across both call sites.
 */
export const DefaultModelSelector = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const { control, setValue, getValues } =
    useFormContext<AiSettingsFormValues>();

  // Subscribe to the flat cross-provider list; re-renders when a model is
  // added/removed or the default flips (from here or from a per-row control).
  const models =
    useWatch<AiSettingsFormValues, 'allowedModels'>({
      control,
      name: 'allowedModels',
    }) ?? [];

  // Group by owning provider in fixed-slot order, keeping allow-list order within
  // each group; drop providers that own no model. Each entry retains its original
  // flat index so a pick maps back to the single global `useFieldArray` position.
  const groups = useMemo(
    () =>
      groupModelsByProvider(
        models.map((model, index) => ({ model, index })),
        (e) => e.model.provider,
      ),
    [models],
  );

  const defaultModel = models.find((m) => m.isDefault === true);
  const triggerLabel =
    defaultModel != null
      ? formatModelLabel(defaultModel.provider, defaultModel.modelId)
      : t('ai_settings.default_model_placeholder');

  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((open) => !open), []);

  // Read the list at click time (not from the render-time closure) so a pick
  // always rewrites the latest values, mirroring AllowedModelsField's approach.
  const selectDefault = useCallback(
    (targetIndex: number): void => {
      const current = getValues('allowedModels');
      setValue(
        'allowedModels',
        setDefaultAllowedModelAt(current, targetIndex),
        {
          shouldDirty: true,
        },
      );
    },
    [getValues, setValue],
  );

  const hasModels = groups.length > 0;

  return (
    <FormGroup className="mb-4">
      <Label className="form-label fw-bold mb-1">
        {t('ai_settings.default_model_label')}
      </Label>
      <p className="form-text text-muted mt-0 mb-2">
        {t('ai_settings.default_model_help')}
      </p>
      <Dropdown isOpen={isOpen} toggle={toggle}>
        {/* `outline-secondary` (not `light`): a solid light button keeps a white
            background under the dark admin theme and reads as out of place. The
            outline variant is theme-adaptive — transparent background + a neutral
            border that follows `data-bs-theme`. */}
        <DropdownToggle
          caret
          outline
          color="secondary"
          data-testid="default-model-toggle"
        >
          {triggerLabel}
        </DropdownToggle>
        <DropdownMenu>
          {hasModels ? (
            groups.map((group) => (
              <Fragment key={group.provider}>
                <DropdownItem
                  header
                  data-testid={`default-model-group-${group.provider}`}
                >
                  {getProviderLabel(group.provider)}
                </DropdownItem>
                {group.entries.map((entry) => (
                  <DropdownItem
                    key={entry.index}
                    active={entry.model.isDefault === true}
                    className="font-monospace py-2"
                    data-testid={`default-model-item-${entry.index}`}
                    onClick={() => selectDefault(entry.index)}
                  >
                    {entry.model.modelId}
                  </DropdownItem>
                ))}
              </Fragment>
            ))
          ) : (
            <DropdownItem disabled data-testid="default-model-empty">
              {t('ai_settings.default_model_no_models')}
            </DropdownItem>
          )}
        </DropdownMenu>
      </Dropdown>
    </FormGroup>
  );
};
