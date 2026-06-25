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
    { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
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

// Each card exposes its model-id text input via the model label; counting them
// is the observable proxy for "how many cards are rendered".
const getModelInputs = (): HTMLInputElement[] =>
  screen
    .getAllByLabelText('ai_settings.model_label')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

// The "set as default" radios (one per card). Narrow via a type guard — not an
// `as` cast — so reading `.checked` stays type-safe.
const getDefaultRadios = (): HTMLInputElement[] =>
  screen
    .getAllByRole('radio')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

const getProviderOptionsTextareas = (): HTMLTextAreaElement[] =>
  screen
    .getAllByLabelText('ai_settings.provider_options_label')
    .filter(
      (el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement,
    );

// Removal is confirmation-gated: click a card's trash icon, then confirm in the
// dialog. Scoped to the dialog so the confirm button is not confused with the
// trash icons (both carry the `remove_model` accessible name).
const confirmRemoveAt = async (
  user: ReturnType<typeof userEvent.setup>,
  index: number,
): Promise<void> => {
  const trashButtons = screen.getAllByRole('button', {
    name: 'ai_settings.remove_model',
  });
  await user.click(trashButtons[index]);
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'ai_settings.remove_model' }),
  );
};

describe('AllowedModelsField', () => {
  describe('add / remove cards', () => {
    it('adds a new card when the add button is clicked', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
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

    it('seeds a newly added card with the current provider namespace', async () => {
      // Arrange: provider is openai.
      const user = userEvent.setup();
      renderComponent({ defaultValues: { provider: 'anthropic' } });

      // Act
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert: the new card's providerOptions starts from the provider's empty
      // namespace (anthropic here), not a hard-coded openai example.
      const textareas = getProviderOptionsTextareas();
      expect(JSON.parse(textareas[1].value)).toEqual({ anthropic: {} });
    });

    it('removes a card only after the removal is confirmed', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });
      expect(getModelInputs()).toHaveLength(2);

      // Act: remove the second card via the confirmation dialog.
      await confirmRemoveAt(user, 1);

      // Assert
      const inputs = getModelInputs();
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe('gpt-4o');
    });

    it('keeps the card when the removal is cancelled', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });

      // Act: open the dialog for the second card, then cancel.
      const trashButtons = screen.getAllByRole('button', {
        name: 'ai_settings.remove_model',
      });
      await user.click(trashButtons[1]);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      // Assert: nothing was removed.
      expect(getModelInputs()).toHaveLength(2);
    });
  });

  describe('default selection (single-select)', () => {
    it('checks exactly one card by default and unchecks the previous when another is selected', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });

      const radios = getDefaultRadios();
      expect(radios[0].checked).toBe(true);
      expect(radios[1].checked).toBe(false);

      // Act: choose card B as the default.
      await user.click(radios[1]);

      // Assert: selecting B unsets A — exactly one default at all times.
      expect(radios[0].checked).toBe(false);
      expect(radios[1].checked).toBe(true);
    });

    it('marks only the default card with the "default" badge', () => {
      // Arrange / Act
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });

      // Assert: exactly one default badge across the two cards.
      expect(screen.getAllByText('ai_settings.default_badge')).toHaveLength(1);
    });

    it('re-assigns the default to the first remaining card when the default card is removed', async () => {
      // Arrange: the default is the first card.
      const user = userEvent.setup();
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });

      // Act: remove the default (first) card via the confirmation dialog.
      await confirmRemoveAt(user, 0);

      // Assert: the now-first (formerly second) card becomes the default.
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

    it('shows no error for a provider-namespaced object', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act: types `{"openai":{"temperature":0.7}}`.
      await user.type(textarea, '{{"openai":{{"temperature":0.7}}');

      // Assert: a valid value is accepted silently (no error indicator).
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });

    it('shows no error when the providerOptions are empty', () => {
      // Arrange
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
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

  describe('card composition', () => {
    it('renders each card with its own model input and default radio', () => {
      // Arrange / Act
      renderComponent({
        defaultValues: {
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            {
              modelId: 'gpt-4o-mini',
              providerOptionsText: '',
              isDefault: false,
            },
          ],
        },
      });

      // Assert: each rendered group exposes one model input and one radio.
      const groups = screen.getAllByRole('group');
      const modelCards = groups.filter(
        (g) => within(g).queryByRole('radio') != null,
      );
      expect(modelCards).toHaveLength(2);
    });
  });
});
