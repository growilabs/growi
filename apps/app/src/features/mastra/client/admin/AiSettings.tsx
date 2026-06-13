import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Alert, Button } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';

import type { AiProvider } from '../../interfaces/ai-provider';
import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import { AiEnabledToggle } from './AiEnabledToggle';
import { AzureOpenaiSettings } from './AzureOpenaiSettings';
import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';
import { ProviderCommonSettings } from './ProviderCommonSettings';
import { useAiSettings } from './use-ai-settings';

/**
 * The editable working copy held in local form state.
 *
 * `apiKey` is write-only and is NOT seeded from the server (the GET never
 * returns the stored key, R5.2); it starts blank and is only sent when the
 * admin types a new value. String fields default to '' so the controlled
 * inputs are never `undefined`.
 */
interface AiSettingsForm {
  aiEnabled: boolean;
  provider?: AiProvider;
  apiKey: string;
  model: string;
  providerOptions: string;
  azureOpenaiResourceName: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiApiVersion: string;
  azureOpenaiUseEntraId: boolean;
}

const buildFormState = (data: AiSettingsResponse): AiSettingsForm => ({
  aiEnabled: data.aiEnabled,
  provider: data.provider,
  apiKey: '',
  model: data.model ?? '',
  providerOptions: data.providerOptions ?? '',
  azureOpenaiResourceName: data.azureOpenaiResourceName ?? '',
  azureOpenaiBaseUrl: data.azureOpenaiBaseUrl ?? '',
  azureOpenaiApiVersion: data.azureOpenaiApiVersion ?? '',
  azureOpenaiUseEntraId: data.azureOpenaiUseEntraId,
});

/**
 * Map the local form state to the PUT request body.
 *
 * Booleans (`aiEnabled` / `azureOpenaiUseEntraId`) are always included. String
 * fields are sent as-is (including ''), which the server normalizes to remove
 * the DB value and fall back to the env default (R4.4). `apiKey` is the only
 * exception: it is included only when the admin typed a value, so a blank field
 * keeps the existing stored key (R5.x).
 */
const buildUpdateRequest = (form: AiSettingsForm): AiSettingsUpdateRequest => {
  const body: AiSettingsUpdateRequest = {
    aiEnabled: form.aiEnabled,
    provider: form.provider,
    model: form.model,
    providerOptions: form.providerOptions,
    azureOpenaiResourceName: form.azureOpenaiResourceName,
    azureOpenaiBaseUrl: form.azureOpenaiBaseUrl,
    azureOpenaiApiVersion: form.azureOpenaiApiVersion,
    azureOpenaiUseEntraId: form.azureOpenaiUseEntraId,
  };
  if (form.apiKey !== '') {
    body.apiKey = form.apiKey;
  }
  return body;
};

/**
 * Container for the AI settings admin screen.
 *
 * Integrates the section components (`AiEnabledToggle`, `ProviderCommonSettings`,
 * `AzureOpenaiSettings`, `EnvOnlyModeNotice`) over a single local form state
 * seeded from `useAiSettings`. The whole form (toggle included) is saved with
 * one button via a single PUT (R2.3): success surfaces a toast and revalidates,
 * failure surfaces a toast while keeping the in-progress input intact (R6.3).
 *
 * Editability is driven by `useOnlyEnvVars` — when on, every input and the save
 * button are disabled and the env-only notice explains why (R4.2). When AI is
 * enabled but not configured, a warning alert is shown (R7.6).
 */
export const AiSettings = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const { data, save } = useAiSettings();

  const [form, setForm] = useState<AiSettingsForm | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  // Seed the working copy from the server value. Re-seed on revalidation so the
  // form reflects the persisted state after a successful save; the failure path
  // keeps the user's edits because it does not revalidate (R6.3).
  useEffect(() => {
    if (data != null) {
      setForm(buildFormState(data));
    }
  }, [data]);

  const updateForm = useCallback((patch: Partial<AiSettingsForm>) => {
    setForm((prev) => (prev == null ? prev : { ...prev, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    if (form == null) {
      return;
    }
    setIsSaving(true);
    try {
      await save(buildUpdateRequest(form));
      toastSuccess(t('ai_settings.save_success'));
    } catch (err) {
      // Keep the local form state intact so the admin does not lose input (R6.3).
      // `err` is the propagated axios/ErrorV3 failure; toastError extracts the
      // message and never surfaces the apiKey (R5.3).
      toastError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [form, save, t]);

  // Render nothing until the initial settings have loaded.
  if (data == null || form == null) {
    return null;
  }

  const { useOnlyEnvVars } = data;
  const showUnconfiguredWarning = data.aiEnabled && !data.isConfigured;

  return (
    <div data-testid="ai-settings">
      <EnvOnlyModeNotice useOnlyEnvVars={useOnlyEnvVars} />

      {showUnconfiguredWarning && (
        <Alert color="warning" className="mb-3">
          {t('ai_settings.unconfigured_warning')}
        </Alert>
      )}

      <AiEnabledToggle
        aiEnabled={form.aiEnabled}
        onChange={(next) => updateForm({ aiEnabled: next })}
        disabled={useOnlyEnvVars}
      />

      <ProviderCommonSettings
        provider={form.provider}
        apiKey={form.apiKey}
        model={form.model}
        providerOptions={form.providerOptions}
        isApiKeySet={data.isApiKeySet}
        disabled={useOnlyEnvVars}
        onChangeProvider={(next) => updateForm({ provider: next })}
        onChangeApiKey={(next) => updateForm({ apiKey: next })}
        onChangeModel={(next) => updateForm({ model: next })}
        onChangeProviderOptions={(next) =>
          updateForm({ providerOptions: next })
        }
      />

      <AzureOpenaiSettings
        provider={form.provider}
        resourceName={form.azureOpenaiResourceName}
        baseUrl={form.azureOpenaiBaseUrl}
        apiVersion={form.azureOpenaiApiVersion}
        useEntraId={form.azureOpenaiUseEntraId}
        disabled={useOnlyEnvVars}
        onChangeResourceName={(next) =>
          updateForm({ azureOpenaiResourceName: next })
        }
        onChangeBaseUrl={(next) => updateForm({ azureOpenaiBaseUrl: next })}
        onChangeApiVersion={(next) =>
          updateForm({ azureOpenaiApiVersion: next })
        }
        onChangeUseEntraId={(next) =>
          updateForm({ azureOpenaiUseEntraId: next })
        }
      />

      <Button
        color="primary"
        disabled={useOnlyEnvVars || isSaving}
        onClick={handleSave}
      >
        {t('ai_settings.save')}
      </Button>
    </div>
  );
};
