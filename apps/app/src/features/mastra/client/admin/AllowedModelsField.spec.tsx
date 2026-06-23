// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import { AllowedModelsField } from './AllowedModelsField';
import type { AiSettingsFormValues } from './ai-settings-form-values';

const defaultFormValues: AiSettingsFormValues = {
  aiEnabled: true,
  provider: 'openai',
  apiKey: '',
  allowedModels: [
    { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
  ],
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
};

const FormHarness = ({
  defaultValues,
  children,
}: {
  defaultValues?: Partial<AiSettingsFormValues>;
  children: ReactNode;
}): JSX.Element => {
  // Mirror the container's `onChange` validation mode so the providerOptions
  // JSON error surfaces as the field changes (matching production behavior).
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: { ...defaultFormValues, ...defaultValues },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  disabled = false,
  defaultValues,
}: {
  disabled?: boolean;
  defaultValues?: Partial<AiSettingsFormValues>;
} = {}) =>
  render(
    <FormHarness defaultValues={defaultValues}>
      <AllowedModelsField disabled={disabled} />
    </FormHarness>,
  );

// Each row exposes its model-id text input via the model label; counting them
// is the observable proxy for "how many rows are rendered".
const getModelInputs = (): HTMLInputElement[] =>
  screen
    .getAllByLabelText('ai_settings.model_label')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

// The "default" radios (one per row). Narrow via a type guard — not an `as`
// cast — so reading `.checked` stays type-safe (same pattern as getModelInputs).
const getDefaultRadios = (): HTMLInputElement[] =>
  screen
    .getAllByRole('radio')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

describe('AllowedModelsField', () => {
  describe('add / remove rows', () => {
    it('adds a new row when the add button is clicked', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
          ],
        },
      });
      expect(getModelInputs()).toHaveLength(1);

      // Act
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert
      expect(getModelInputs()).toHaveLength(2);
    });

    it('removes a row when its remove button is clicked', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
            { model: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
          ],
        },
      });
      expect(getModelInputs()).toHaveLength(2);

      // Act: remove the second row.
      const removeButtons = screen.getAllByRole('button', {
        name: 'ai_settings.remove_model',
      });
      await user.click(removeButtons[1]);

      // Assert
      const inputs = getModelInputs();
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe('gpt-4o');
    });
  });

  describe('default radio (single-select)', () => {
    it('checks exactly one row by default and unchecks the previous when another is selected', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
            { model: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
          ],
        },
      });

      const radios = getDefaultRadios();
      expect(radios[0].checked).toBe(true);
      expect(radios[1].checked).toBe(false);

      // Act: choose row B as the default.
      await user.click(radios[1]);

      // Assert: selecting B unsets A — exactly one default at all times.
      expect(radios[0].checked).toBe(false);
      expect(radios[1].checked).toBe(true);
    });

    it('re-assigns the default to the first remaining row when the default row is removed', async () => {
      // Arrange: the default is the first row.
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
            { model: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
          ],
        },
      });

      // Act: remove the default (first) row.
      const removeButtons = screen.getAllByRole('button', {
        name: 'ai_settings.remove_model',
      });
      await user.click(removeButtons[0]);

      // Assert: the now-first (formerly second) row becomes the default.
      const radios = getDefaultRadios();
      expect(radios).toHaveLength(1);
      expect(radios[0].checked).toBe(true);
      expect(getModelInputs()[0].value).toBe('gpt-4o-mini');
    });
  });

  describe('providerOptions JSON validation', () => {
    it('shows an inline error for invalid, non-empty JSON', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act: the leading `{` is escaped as `{{` for userEvent's keyboard syntax.
      await user.type(textarea, '{{ invalid json');

      // Assert
      expect(
        await screen.findByText('ai_settings.provider_options_invalid_json'),
      ).toBeInTheDocument();
    });

    it('does not show an error for a valid provider-namespaced object', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act: types `{"openai":{"temperature":0.7}}`.
      await user.type(textarea, '{{"openai":{{"temperature":0.7}}');

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });

    it('does not show an error when the providerOptions are empty', () => {
      // Arrange
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
          ],
        },
      });

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });
  });

  describe('env-only mode', () => {
    it('disables every input so the locked fields cannot be focused', () => {
      // Act
      renderComponent({ disabled: true });

      // Assert: model input, default radio, providerOptions textarea, and the
      // add/remove buttons are all disabled (removed from the tab order).
      expect(getModelInputs()[0]).toBeDisabled();
      expect(screen.getByRole('radio')).toBeDisabled();
      expect(
        screen.getByLabelText('ai_settings.provider_options_label'),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'ai_settings.remove_model' }),
      ).toBeDisabled();
    });
  });

  describe('provider-driven label', () => {
    it('labels the model field "Model" for non-Azure providers', () => {
      // Act
      renderComponent({ defaultValues: { provider: 'openai' } });

      // Assert
      expect(
        screen.getByLabelText('ai_settings.model_label'),
      ).toBeInTheDocument();
    });

    it('labels the model field "Deployment name" for Azure OpenAI', () => {
      // Act
      renderComponent({ defaultValues: { provider: 'azure-openai' } });

      // Assert
      expect(
        screen.getByLabelText('ai_settings.azure_model_deployment_label'),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText('ai_settings.model_label'),
      ).not.toBeInTheDocument();
    });
  });

  describe('row composition', () => {
    it('renders each row with its own model input and default radio', () => {
      // Arrange / Act
      renderComponent({
        defaultValues: {
          allowedModels: [
            { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
            { model: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
          ],
        },
      });

      // Assert: each rendered group exposes one model input and one radio.
      const groups = screen.getAllByRole('group');
      const modelRows = groups.filter(
        (g) => within(g).queryByRole('radio') != null,
      );
      expect(modelRows).toHaveLength(2);
    });
  });
});
