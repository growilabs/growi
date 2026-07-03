import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { FormProvider, type SubmitHandler, useForm } from 'react-hook-form';
import { Alert, Button } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';

import type { AiProvider } from '../../interfaces/ai-provider';
import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import { AiEnabledToggle } from './AiEnabledToggle';
import { AllowedModelsField } from './AllowedModelsField';
import {
  type AiSettingsFormValues,
  buildUpdateRequest,
  toFormValues,
} from './ai-settings-form-values';
import { DefaultModelSelector } from './DefaultModelSelector';
import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';
import { ProviderPanel } from './ProviderPanel';
import { ProviderTabs } from './ProviderTabs';
import { useAiSettings } from './use-ai-settings';

/**
 * Container for the multi-provider AI settings admin screen.
 *
 * Owns a single react-hook-form (`useForm`) seeded from `useAiSettings` and
 * shared with the section components via `FormProvider`. The layout follows the
 * mock composition (R1.1): AI-enabled toggle → global DefaultModelSelector →
 * fixed provider tabs → the active provider's ProviderPanel (with its
 * provider-scoped AllowedModelsField) → a single Update button. Only the active
 * provider's panel is mounted; switching tabs swaps which one.
 *
 * The whole form is persisted with one PUT: success surfaces a toast and
 * revalidates (which re-seeds the form, clearing the write-only apiKey), failure
 * surfaces a toast while keeping the in-progress input intact (the failure path
 * does not revalidate — R6.3).
 *
 * Under env-only mode (`useOnlyEnvVars`) the *connection* settings are locked —
 * the enable toggle and each panel's credential inputs disable themselves — while
 * the model settings (default selector + allowed models) stay editable (R5.3);
 * `buildUpdateRequest` is told the mode so it sends only `allowedModels` then. The
 * Update button therefore stays enabled under env-only (it still persists model
 * edits) and is gated only by `isSubmitting`.
 */
export const AiSettings = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const { data, save } = useAiSettings();

  // The currently shown provider panel; starts at the first fixed slot (R1.1).
  const [activeProvider, setActiveProvider] = useState<AiProvider>(
    AI_PROVIDERS[0],
  );

  // `onChange` validation preserves the synchronous UX: the providerOptions JSON
  // error surfaces as the admin types, without requiring a submit attempt first.
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: data != null ? toFormValues(data) : undefined,
  });
  const {
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = methods;

  // Re-seed the form from the server value on (re)load and after a successful
  // save (which revalidates via SWR). This reflects the persisted state and
  // clears the write-only apiKey. The failure path keeps the user's edits
  // because it does not revalidate (R6.3).
  useEffect(() => {
    if (data != null) {
      reset(toFormValues(data));
    }
  }, [data, reset]);

  const onSubmit: SubmitHandler<AiSettingsFormValues> = async (values) => {
    // `useOnlyEnvVars` is a real boolean here (data is non-null past the guard
    // below, which runs before this handler can fire).
    const useOnlyEnvVars = data?.useOnlyEnvVars ?? false;
    try {
      // Pass the mode so env-only sends only allowedModels (R5.3): a request
      // carrying providers/aiEnabled is rejected 400 under env-only.
      await save(buildUpdateRequest(values, useOnlyEnvVars));
      toastSuccess(t('ai_settings.save_success'));
    } catch (err) {
      // Keep the form values intact so the admin does not lose input (R6.3).
      // `err` is the propagated axios/ErrorV3 failure; toastError extracts the
      // message and never surfaces the apiKey (R1.9).
      toastError(err as Error);
    }
  };

  // Render nothing until the initial settings have loaded.
  if (data == null) {
    return null;
  }

  const { useOnlyEnvVars } = data;
  const showUnconfiguredWarning = data.aiEnabled && !data.isConfigured;

  // Per-provider "has a stored key" flags for the tab status dots. The form's
  // apiKey field is write-only and cannot reveal this (R1.8/R1.9), so it comes
  // from the GET response. AI_PROVIDERS stays the single source of truth; the
  // `as` narrows the widened fromEntries result to the fixed-slot Record
  // (sound because every provider is mapped — the sibling idiom in
  // ai-settings-form-values.ts).
  const apiKeySetMap = Object.fromEntries(
    AI_PROVIDERS.map((p) => [p, data.providers[p].isApiKeySet]),
  ) as Record<AiProvider, boolean>;

  return (
    <FormProvider {...methods}>
      <form data-testid="ai-settings" onSubmit={handleSubmit(onSubmit)}>
        <EnvOnlyModeNotice useOnlyEnvVars={useOnlyEnvVars} />

        {showUnconfiguredWarning && (
          <Alert color="warning" className="mb-3">
            {t('ai_settings.unconfigured_warning')}
          </Alert>
        )}

        {/* Connection setting: locked under env-only (R5.2). */}
        <AiEnabledToggle disabled={useOnlyEnvVars} />

        {/* Model setting: stays editable even under env-only (R5.3). */}
        <DefaultModelSelector />

        <ProviderTabs
          activeProvider={activeProvider}
          onSelectProvider={setActiveProvider}
          apiKeySet={apiKeySetMap}
        />

        <ProviderPanel
          provider={activeProvider}
          isApiKeySet={data.providers[activeProvider].isApiKeySet}
          useOnlyEnvVars={useOnlyEnvVars}
        >
          {/* Model editing stays active even under env-only (R5.3), so the
              field is never disabled by this container; the panel leaves the
              models slot untouched. */}
          <AllowedModelsField provider={activeProvider} disabled={false} />
        </ProviderPanel>

        {/* Not disabled under env-only: model edits are still persistable there
            (R5.3). Connection inputs disable themselves individually. */}
        <Button type="submit" color="primary" disabled={isSubmitting}>
          {t('ai_settings.save')}
        </Button>
      </form>
    </FormProvider>
  );
};
