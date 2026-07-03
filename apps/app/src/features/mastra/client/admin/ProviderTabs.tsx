import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import { Nav, NavItem, NavLink } from 'reactstrap';

import type { AiProvider } from '../../interfaces/ai-provider';
import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import type { AiSettingsFormValues } from './ai-settings-form-values';

export interface ProviderTabsProps {
  /** The provider whose panel is currently shown. */
  readonly activeProvider: AiProvider;
  /** Called with the clicked provider to switch the active panel. */
  readonly onSelectProvider: (provider: AiProvider) => void;
  /**
   * Whether each provider already has a stored API key, from the GET response.
   * The form's `apiKey` field is write-only and cannot reveal this (R1.8/R1.9),
   * so the status must be passed in.
   */
  readonly apiKeySet: Record<AiProvider, boolean>;
}

/**
 * The fixed provider tab bar (R1.1): always exactly the four supported providers,
 * never a dynamic add/remove. Each tab shows the provider name (rendered as the
 * raw provider key, matching the DefaultModelSelector/AllowedModelsField
 * convention) and a status dot that hints whether the provider is *configured*.
 *
 * "Configured" is a UI hint only — the authoritative availability check lives
 * server-side in `provider-availability`. The rule here is intentionally minimal:
 *   - azure-openai: has a credential (`apiKeySet['azure-openai']` OR Entra ID) AND
 *     an endpoint (resourceName or baseURL) — mirrors the per-provider "configured"
 *     predicate the server uses for Azure.
 *   - every other provider: `apiKeySet[provider]`.
 * It deliberately does NOT factor in the enabled toggle: the dot reflects
 * connection readiness, not whether the admin has switched the provider on.
 *
 * The dot's on/off state is exposed via `data-configured` (and a title) so it is
 * deterministically assertable, not encoded in a CSS class alone.
 */
export const ProviderTabs = (props: ProviderTabsProps): JSX.Element => {
  const { activeProvider, onSelectProvider, apiKeySet } = props;
  const { t } = useTranslation('admin');
  const { control } = useFormContext<AiSettingsFormValues>();

  // Watch the azure connection settings so the azure dot reflects live edits to
  // the endpoint / Entra ID toggle (the endpoint is not derivable from apiKeySet).
  const azureSettings = useWatch<
    AiSettingsFormValues,
    'providers.azure-openai.azureOpenaiSettings'
  >({ control, name: 'providers.azure-openai.azureOpenaiSettings' });

  const isConfigured = (provider: AiProvider): boolean => {
    if (provider === 'azure-openai') {
      const hasEndpoint =
        (azureSettings?.resourceName ?? '').trim() !== '' ||
        (azureSettings?.baseURL ?? '').trim() !== '';
      const hasCredential =
        apiKeySet['azure-openai'] === true ||
        (azureSettings?.useEntraId ?? false);
      return hasEndpoint && hasCredential;
    }
    return apiKeySet[provider] === true;
  };

  return (
    <Nav tabs role="tablist">
      {AI_PROVIDERS.map((provider) => {
        const active = provider === activeProvider;
        const configured = isConfigured(provider);
        return (
          <NavItem key={provider}>
            <NavLink
              type="button"
              role="tab"
              aria-selected={active}
              active={active}
              className="d-flex align-items-center gap-2"
              data-testid={`provider-tab-${provider}`}
              onClick={() => onSelectProvider(provider)}
            >
              <span>{provider}</span>
              <span
                aria-hidden="true"
                data-testid={`provider-tab-dot-${provider}`}
                data-configured={String(configured)}
                title={
                  configured
                    ? t('ai_settings.provider_configured')
                    : t('ai_settings.provider_not_configured')
                }
                className={`d-inline-block rounded-circle ${
                  configured ? 'bg-success' : 'bg-secondary'
                }`}
                style={{ width: '7px', height: '7px' }}
              />
            </NavLink>
          </NavItem>
        );
      })}
    </Nav>
  );
};
