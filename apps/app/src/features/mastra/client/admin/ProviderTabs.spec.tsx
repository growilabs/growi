// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

// Render i18n keys verbatim; assertions target the observable DOM contract
// (tab roles/selection, the status-dot's data-configured affordance).
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { AiProvider } from '../../interfaces/ai-provider';
import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import type {
  AiSettingsFormValues,
  ProviderFormValue,
} from './ai-settings-form-values';
import { ProviderTabs } from './ProviderTabs';

const emptyProvider = (): ProviderFormValue => ({
  enabled: false,
  apiKey: '',
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
});

const buildFormValues = (
  azureOverrides?: Partial<ProviderFormValue['azureOpenaiSettings']>,
): AiSettingsFormValues => ({
  aiEnabled: true,
  providers: {
    openai: emptyProvider(),
    anthropic: emptyProvider(),
    google: emptyProvider(),
    'azure-openai': {
      ...emptyProvider(),
      azureOpenaiSettings: {
        ...emptyProvider().azureOpenaiSettings,
        ...azureOverrides,
      },
    },
  },
  allowedModels: [],
});

const allUnset: Record<AiProvider, boolean> = {
  openai: false,
  anthropic: false,
  google: false,
  'azure-openai': false,
};

const FormHarness = ({
  formValues,
  children,
}: {
  formValues: AiSettingsFormValues;
  children: ReactNode;
}): JSX.Element => {
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: formValues,
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  activeProvider = 'openai',
  onSelectProvider = vi.fn(),
  apiKeySet = allUnset,
  formValues = buildFormValues(),
}: {
  activeProvider?: AiProvider;
  onSelectProvider?: (provider: AiProvider) => void;
  apiKeySet?: Record<AiProvider, boolean>;
  formValues?: AiSettingsFormValues;
} = {}) =>
  render(
    <FormHarness formValues={formValues}>
      <ProviderTabs
        activeProvider={activeProvider}
        onSelectProvider={onSelectProvider}
        apiKeySet={apiKeySet}
      />
    </FormHarness>,
  );

const dotConfigured = (provider: AiProvider): string | null =>
  screen
    .getByTestId(`provider-tab-dot-${provider}`)
    .getAttribute('data-configured');

describe('ProviderTabs', () => {
  it('renders one tab for every fixed provider slot (1.1)', () => {
    // Act
    renderComponent();

    // Assert: exactly the four supported providers, each present as a tab.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(AI_PROVIDERS.length);
    for (const provider of AI_PROVIDERS) {
      expect(
        screen.getByTestId(`provider-tab-${provider}`),
      ).toBeInTheDocument();
    }
  });

  it('lights the status dot for a configured provider and dims it for an unconfigured one', () => {
    // Arrange: openai has a stored key (configured); anthropic does not.
    renderComponent({
      apiKeySet: { ...allUnset, openai: true },
    });

    // Assert: the accessible affordance distinguishes on vs off deterministically.
    expect(dotConfigured('openai')).toBe('true');
    expect(dotConfigured('anthropic')).toBe('false');
  });

  it('treats azure-openai as configured only with both a credential and an endpoint', () => {
    // Arrange: Entra ID (credential) is on but no resourceName/baseURL endpoint.
    const { unmount } = renderComponent({
      apiKeySet: allUnset,
      formValues: buildFormValues({ useEntraId: true }),
    });
    // Assert: missing endpoint -> not configured.
    expect(dotConfigured('azure-openai')).toBe('false');
    unmount();

    // Arrange: add an endpoint alongside the credential.
    renderComponent({
      apiKeySet: allUnset,
      formValues: buildFormValues({
        useEntraId: true,
        resourceName: 'my-resource',
      }),
    });
    // Assert: credential + endpoint -> configured.
    expect(dotConfigured('azure-openai')).toBe('true');
  });

  it('marks the active tab as selected', () => {
    // Act
    renderComponent({ activeProvider: 'google' });

    // Assert: only the active tab is aria-selected.
    expect(screen.getByTestId('provider-tab-google')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('provider-tab-openai')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onSelectProvider with the clicked provider', async () => {
    // Arrange
    const user = userEvent.setup();
    const onSelectProvider = vi.fn();
    renderComponent({ activeProvider: 'openai', onSelectProvider });

    // Act
    await user.click(screen.getByTestId('provider-tab-anthropic'));

    // Assert
    expect(onSelectProvider).toHaveBeenCalledTimes(1);
    expect(onSelectProvider).toHaveBeenCalledWith('anthropic');
  });
});
