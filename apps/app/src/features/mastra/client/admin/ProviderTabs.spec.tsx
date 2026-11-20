// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

// Render i18n keys verbatim; assertions target the observable DOM contract
// (tab roles/selection, the status-dot's data-availability affordance).
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
  overrides?: Partial<Record<AiProvider, Partial<ProviderFormValue>>>,
): AiSettingsFormValues => {
  const base: Record<AiProvider, ProviderFormValue> = {
    openai: emptyProvider(),
    anthropic: emptyProvider(),
    google: emptyProvider(),
    'azure-openai': emptyProvider(),
  };
  const providers: Record<AiProvider, ProviderFormValue> = {
    openai: { ...base.openai, ...overrides?.openai },
    anthropic: { ...base.anthropic, ...overrides?.anthropic },
    google: { ...base.google, ...overrides?.google },
    'azure-openai': { ...base['azure-openai'], ...overrides?.['azure-openai'] },
  };
  return { aiEnabled: true, providers, allowedModels: [] };
};

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

const dotAvailability = (provider: AiProvider): string | null =>
  screen
    .getByTestId(`provider-tab-dot-${provider}`)
    .getAttribute('data-availability');

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

  describe('status dot availability', () => {
    it('is "available" when the provider is enabled and has a stored key', () => {
      // Arrange
      renderComponent({
        apiKeySet: { ...allUnset, openai: true },
        formValues: buildFormValues({ openai: { enabled: true } }),
      });

      // Assert
      expect(dotAvailability('openai')).toBe('available');
    });

    it('counts a freshly typed (unsaved) key as configured', () => {
      // Arrange: no stored key, but a key typed into the form.
      renderComponent({
        apiKeySet: allUnset,
        formValues: buildFormValues({
          openai: { enabled: true, apiKey: 'sk-typed' },
        }),
      });

      // Assert
      expect(dotAvailability('openai')).toBe('available');
    });

    it('is "disabled" when the provider toggle is off, even with a stored key', () => {
      // Arrange: openai has a stored key but is not enabled.
      renderComponent({
        apiKeySet: { ...allUnset, openai: true },
        formValues: buildFormValues({ openai: { enabled: false } }),
      });

      // Assert: the dot now factors in the enable toggle.
      expect(dotAvailability('openai')).toBe('disabled');
    });

    it('is "misconfigured" when enabled but the API key is missing', () => {
      // Arrange
      renderComponent({
        apiKeySet: allUnset,
        formValues: buildFormValues({ anthropic: { enabled: true } }),
      });

      // Assert
      expect(dotAvailability('anthropic')).toBe('misconfigured');
    });

    it('marks azure-openai "misconfigured" when enabled with an endpoint but no key and no Entra ID', () => {
      // Arrange: resourceName present, but no credential.
      renderComponent({
        apiKeySet: allUnset,
        formValues: buildFormValues({
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-resource',
              baseURL: '',
              apiVersion: '',
              useEntraId: false,
            },
          },
        }),
      });

      // Assert
      expect(dotAvailability('azure-openai')).toBe('misconfigured');
    });

    it('marks azure-openai "available" when enabled with an endpoint and Entra ID (key waived)', () => {
      // Arrange
      renderComponent({
        apiKeySet: allUnset,
        formValues: buildFormValues({
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-resource',
              baseURL: '',
              apiVersion: '',
              useEntraId: true,
            },
          },
        }),
      });

      // Assert
      expect(dotAvailability('azure-openai')).toBe('available');
    });
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
