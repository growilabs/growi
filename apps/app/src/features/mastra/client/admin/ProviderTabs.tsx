import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import { Nav, NavItem, NavLink } from 'reactstrap';

import type { AiProvider } from '../../interfaces/ai-provider';
import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import { evaluateProviderAvailability } from '../../interfaces/provider-availability-rule';
import type { AiSettingsFormValues } from './ai-settings-form-values';

export interface ProviderTabsProps {
  /** The provider whose panel is currently shown. */
  readonly activeProvider: AiProvider;
  /** Called with the clicked provider to switch the active panel. */
  readonly onSelectProvider: (provider: AiProvider) => void;
  /**
   * Whether each provider already has a stored API key, from the GET response.
   * The form's `apiKey` field is write-only and cannot reveal this (R1.8/R1.9),
   * so the saved-key status must be passed in.
   */
  readonly apiKeySet: Record<AiProvider, boolean>;
}

/**
 * The fixed provider tab bar (R1.1): always exactly the four supported providers,
 * never a dynamic add/remove. Each tab shows the provider name (rendered as the
 * raw provider key, matching the DefaultModelSelector/AllowedModelsField
 * convention) and a status dot that reflects the provider's *availability*.
 *
 * Availability is computed from live form values through the SAME pure rule the
 * server uses (`evaluateProviderAvailability`), so the dot reacts to unsaved edits
 * and cannot drift from the server's judgement. `hasApiKey` here is the saved-key
 * flag (`apiKeySet[provider]`, which reflects the merged DB??env view) OR a
 * non-empty typed key in the form. The dot has three states:
 *   - available (enabled ∧ configured) -> green (bg-success)
 *   - disabled (provider toggle off)   -> gray (bg-secondary)
 *   - misconfigured (enabled but a required credential/endpoint is missing)
 *                                       -> amber (bg-warning)
 *
 * The state is exposed via `data-availability` (and a title) so it is
 * deterministically assertable, not encoded in a CSS class alone.
 */
export const ProviderTabs = (props: ProviderTabsProps): JSX.Element => {
  const { activeProvider, onSelectProvider, apiKeySet } = props;
  const { t } = useTranslation('admin');
  const { control } = useFormContext<AiSettingsFormValues>();

  // Watch every provider slot so each dot reflects live edits to the enable
  // toggle, the typed API key, and (azure) the endpoint / Entra ID toggle.
  const providers = useWatch<AiSettingsFormValues, 'providers'>({
    control,
    name: 'providers',
  });

  return (
    <Nav tabs role="tablist">
      {AI_PROVIDERS.map((provider) => {
        const active = provider === activeProvider;
        const providerFormValue = providers?.[provider];
        const availability = evaluateProviderAvailability({
          provider,
          enabled: providerFormValue?.enabled === true,
          hasApiKey:
            apiKeySet[provider] === true ||
            (providerFormValue?.apiKey ?? '').trim() !== '',
          azureOpenaiSettings: providerFormValue?.azureOpenaiSettings,
        });

        const dot = availability.available
          ? {
              state: 'available' as const,
              className: 'bg-success',
              title: t('ai_settings.provider_status_available'),
            }
          : availability.reason === 'disabled'
            ? {
                state: 'disabled' as const,
                className: 'bg-secondary',
                title: t('ai_settings.provider_status_disabled'),
              }
            : {
                state: 'misconfigured' as const,
                className: 'bg-warning',
                title: t('ai_settings.provider_status_misconfigured'),
              };

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
                data-availability={dot.state}
                title={dot.title}
                className={`d-inline-block rounded-circle ${dot.className}`}
                style={{ width: '7px', height: '7px' }}
              />
            </NavLink>
          </NavItem>
        );
      })}
    </Nav>
  );
};
