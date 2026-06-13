import type { JSX } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'next-i18next';
import { FormProvider, type SubmitHandler, useForm } from 'react-hook-form';
import { Alert, Button } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';

import { AiEnabledToggle } from './AiEnabledToggle';
import { AzureOpenaiSettings } from './AzureOpenaiSettings';
import {
  type AiSettingsFormValues,
  buildUpdateRequest,
  toFormValues,
} from './ai-settings-form-values';
import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';
import { ProviderCommonSettings } from './ProviderCommonSettings';
import { useAiSettings } from './use-ai-settings';

/**
 * Container for the AI settings admin screen.
 *
 * Owns a single react-hook-form (`useForm`) seeded from `useAiSettings` and
 * shared with the section components (`AiEnabledToggle`, `ProviderCommonSettings`,
 * `AzureOpenaiSettings`) via `FormProvider`. The whole form (toggle included) is
 * saved with one button via a single PUT (R2.3): success surfaces a toast and
 * revalidates (which re-seeds the form, clearing the write-only apiKey), failure
 * surfaces a toast while keeping the in-progress input intact (R6.3, the failure
 * path does not revalidate).
 *
 * Editability is driven by `useOnlyEnvVars` — when on, every input and the save
 * button are disabled and the env-only notice explains why (R4.2). When AI is
 * enabled but not configured, a warning alert is shown (R7.6).
 */
export const AiSettings = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const { data, save } = useAiSettings();

  // `onChange` validation preserves the previous synchronous UX: the
  // providerOptions JSON error surfaces as the admin types, without requiring a
  // submit attempt first (6.2).
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
    try {
      await save(buildUpdateRequest(values));
      toastSuccess(t('ai_settings.save_success'));
    } catch (err) {
      // Keep the form values intact so the admin does not lose input (R6.3).
      // `err` is the propagated axios/ErrorV3 failure; toastError extracts the
      // message and never surfaces the apiKey (R5.3).
      toastError(err as Error);
    }
  };

  // Render nothing until the initial settings have loaded.
  if (data == null) {
    return null;
  }

  const { useOnlyEnvVars } = data;
  const showUnconfiguredWarning = data.aiEnabled && !data.isConfigured;

  return (
    <FormProvider {...methods}>
      <form data-testid="ai-settings" onSubmit={handleSubmit(onSubmit)}>
        <EnvOnlyModeNotice useOnlyEnvVars={useOnlyEnvVars} />

        {showUnconfiguredWarning && (
          <Alert color="warning" className="mb-3">
            {t('ai_settings.unconfigured_warning')}
          </Alert>
        )}

        <AiEnabledToggle disabled={useOnlyEnvVars} />

        <ProviderCommonSettings
          isApiKeySet={data.isApiKeySet}
          disabled={useOnlyEnvVars}
        />

        <AzureOpenaiSettings disabled={useOnlyEnvVars} />

        <Button
          type="submit"
          color="primary"
          disabled={useOnlyEnvVars || isSubmitting}
        >
          {t('ai_settings.save')}
        </Button>
      </form>
    </FormProvider>
  );
};
