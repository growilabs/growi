// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AI_PROVIDERS } from '../../interfaces/ai-provider';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { ProviderCommonSettingsProps } from './ProviderCommonSettings';
import { ProviderCommonSettings } from './ProviderCommonSettings';

const renderComponent = (
  overrides: Partial<ProviderCommonSettingsProps> = {},
) => {
  const props: ProviderCommonSettingsProps = {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    providerOptions: '',
    isApiKeySet: false,
    disabled: false,
    onChangeProvider: vi.fn(),
    onChangeApiKey: vi.fn(),
    onChangeModel: vi.fn(),
    onChangeProviderOptions: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ProviderCommonSettings {...props} />) };
};

describe('ProviderCommonSettings', () => {
  describe('provider select', () => {
    it('offers only the AI_PROVIDERS values as options', () => {
      // Act
      renderComponent();

      // Assert: every supported provider is an option, and nothing else is.
      const options = screen
        .getAllByRole('option')
        .map((opt) => (opt as HTMLOptionElement).value)
        .filter((v) => v !== '');
      expect(options).toEqual([...AI_PROVIDERS]);
    });

    it('calls onChangeProvider when a provider is selected', () => {
      // Arrange
      const onChangeProvider = vi.fn();
      renderComponent({ onChangeProvider });

      // Act
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: 'anthropic' },
      });

      // Assert
      expect(onChangeProvider).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('apiKey input', () => {
    it('is a password-masked input', () => {
      // Act
      renderComponent();

      // Assert
      const apiKeyInput = screen.getByLabelText('ai_settings.api_key_label');
      expect(apiKeyInput).toHaveAttribute('type', 'password');
    });
  });

  describe('providerOptions JSON validation', () => {
    it('shows an inline validation message for invalid, non-empty JSON', () => {
      // Arrange
      renderComponent({ providerOptions: '{ invalid json' });

      // Assert: an inline error is surfaced for malformed JSON.
      expect(
        screen.getByText('ai_settings.provider_options_invalid_json'),
      ).toBeInTheDocument();
    });

    it('does not show a validation message for valid JSON', () => {
      // Arrange
      renderComponent({ providerOptions: '{"temperature":0.7}' });

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });

    it('does not show a validation message when empty', () => {
      // Arrange
      renderComponent({ providerOptions: '' });

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });
  });

  describe('env-only mode', () => {
    it('disables the provider select and makes text inputs read-only', () => {
      // Act
      renderComponent({ disabled: true });

      // Assert
      expect(screen.getByRole('combobox')).toBeDisabled();
      expect(
        screen.getByLabelText('ai_settings.api_key_label'),
      ).toHaveAttribute('readonly');
      expect(screen.getByLabelText('ai_settings.model_label')).toHaveAttribute(
        'readonly',
      );
    });
  });

  describe('provider options help', () => {
    it('links to the AI SDK provider-options documentation', () => {
      // Act
      renderComponent();

      // Assert
      const link = screen.getByRole('link', {
        name: 'https://ai-sdk.dev/docs/foundations/provider-options',
      });
      expect(link).toHaveAttribute(
        'href',
        'https://ai-sdk.dev/docs/foundations/provider-options',
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});
