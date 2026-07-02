// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import type { SWRResponse } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

vi.mock('./use-selectable-models', () => ({
  useSWRxSelectableModels: vi.fn(),
}));

import type { SelectableModelsResponse } from '../../interfaces/selectable-models-response';
import { AllowedModelsField } from './AllowedModelsField';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { useSWRxSelectableModels } from './use-selectable-models';

const mockedUseSelectableModels = vi.mocked(useSWRxSelectableModels);

// Build a minimal SWRResponse for the hook mock. Only `data`/`error` are read by
// the component; the rest of the SWRResponse surface is filled with inert stubs so
// the returned value is a real SWRResponse (no type assertion needed).
const swrResponse = (partial: {
  data?: SelectableModelsResponse;
  error?: Error;
}): SWRResponse<SelectableModelsResponse, Error> => ({
  data: partial.data,
  error: partial.error,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
});

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

// Removal is immediate (no confirmation dialog): the change only persists on
// save, so the trash icon removes the card from the list directly.
const removeAt = async (
  user: ReturnType<typeof userEvent.setup>,
  index: number,
): Promise<void> => {
  const trashButtons = screen.getAllByRole('button', {
    name: 'ai_settings.remove_model',
  });
  await user.click(trashButtons[index]);
};

describe('AllowedModelsField', () => {
  // Default the hook to a free-text-inducing state (fetch failure) so the modelId
  // control stays a text input for the provider-agnostic behavior suites below
  // (add/remove, default radio, providerOptions, env-only). The select-mode suites
  // override this per test. This keeps `getModelInputs()` (HTMLInputElement filter)
  // matching the model control in every pre-existing test.
  beforeEach(() => {
    mockedUseSelectableModels.mockReturnValue(
      swrResponse({ error: new Error('default: force free-text') }),
    );
  });

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

    it('removes a card when its trash icon is clicked', async () => {
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

      // Act: remove the second card (no confirmation dialog — persists on save).
      await removeAt(user, 1);

      // Assert
      const inputs = getModelInputs();
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe('gpt-4o');
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

      // Act: remove the default (first) card.
      await removeAt(user, 0);

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

  describe('modelId input: select vs free-text', () => {
    it('renders a dropdown of the catalog models for a catalog provider (1.4)', () => {
      // Arrange: openai has a catalog of selectable models.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o', 'gpt-4.1'] } }),
      );

      // Act
      renderComponent({
        defaultValues: {
          provider: 'openai',
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
          ],
        },
      });

      // Assert: the model control is a <select> (not a free-text input) whose
      // options are exactly the placeholder + the catalog ids — free typing of an
      // out-of-list value is impossible (select-only).
      const modelControl = screen.getByLabelText('ai_settings.model_label');
      expect(modelControl.tagName).toBe('SELECT');
      const optionLabels = within(modelControl)
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(optionLabels).toEqual([
        'ai_settings.model_placeholder',
        'gpt-4o',
        'gpt-4.1',
      ]);
    });

    it('renders a free-text input when the catalog provider returns no models, e.g. Azure (3.1)', () => {
      // Arrange: azure-openai is catalog-less → resolved but empty.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: [] } }),
      );

      // Act
      renderComponent({
        defaultValues: {
          provider: 'azure-openai',
          allowedModels: [
            {
              modelId: 'my-deployment',
              providerOptionsText: '',
              isDefault: true,
            },
          ],
        },
      });

      // Assert: free input remains (a text input, not a select) so a deployment
      // name can be typed. Azure uses its own label key.
      const modelControl = screen.getByLabelText(
        'ai_settings.azure_model_deployment_label',
      );
      expect(modelControl).toBeInstanceOf(HTMLInputElement);
      expect((modelControl as HTMLInputElement).type).toBe('text');
    });

    it('falls back to a free-text input when the model list cannot be fetched, without blocking editing (3.2)', async () => {
      // Arrange: the fetch failed (error surfaced by the hook).
      const user = userEvent.setup();
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ error: new Error('boom') }),
      );

      // Act
      renderComponent({
        defaultValues: {
          provider: 'openai',
          allowedModels: [
            { modelId: '', providerOptionsText: '', isDefault: true },
          ],
        },
      });

      // Assert: a text input is rendered and remains editable (save is not blocked
      // by the fetch failure — the admin can still type a model id).
      const modelControl = screen.getByLabelText('ai_settings.model_label');
      expect(modelControl).toBeInstanceOf(HTMLInputElement);
      await user.type(modelControl, 'gpt-4o');
      expect((modelControl as HTMLInputElement).value).toBe('gpt-4o');
    });

    it('keeps a saved modelId that is not in the current catalog as the selected value (1.5)', () => {
      // Arrange: the saved value predates / is absent from the current catalog.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o'] } }),
      );

      // Act
      renderComponent({
        defaultValues: {
          provider: 'openai',
          allowedModels: [
            {
              modelId: 'legacy-custom-id',
              providerOptionsText: '',
              isDefault: true,
            },
          ],
        },
      });

      // Assert: the <select> retains the out-of-list value as a selected option —
      // it is neither reset to empty nor silently changed.
      const modelControl = screen.getByLabelText('ai_settings.model_label');
      expect(modelControl.tagName).toBe('SELECT');
      expect((modelControl as HTMLSelectElement).value).toBe(
        'legacy-custom-id',
      );
      expect(
        within(modelControl).getByRole('option', { name: 'legacy-custom-id' }),
      ).toBeInTheDocument();
    });

    it('shows the saved model id (not the placeholder) after the catalog resolves on reload', async () => {
      // Repro of the reload bug: on page (re)load the catalog fetch is initially
      // in flight (data undefined), then resolves to a list that INCLUDES the
      // saved model id. The <select> must end up displaying the saved id, not the
      // empty "Select a model" placeholder.
      mockedUseSelectableModels.mockReturnValue(swrResponse({})); // loading

      const { rerender } = renderComponent({
        defaultValues: {
          provider: 'openai',
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
          ],
        },
      });

      // The catalog resolves; gpt-4o is a valid, in-catalog model.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o', 'gpt-4.1'] } }),
      );
      rerender(
        <FormHarness
          defaultValues={{
            provider: 'openai',
            allowedModels: [
              { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
            ],
          }}
        >
          <AllowedModelsField disabled={false} />
        </FormHarness>,
      );

      const modelControl = screen.getByLabelText('ai_settings.model_label');
      await waitFor(() => {
        expect((modelControl as HTMLSelectElement).value).toBe('gpt-4o');
      });
    });

    it('disables the dropdown in env-only mode so it cannot be edited (7.3)', () => {
      // Arrange: select mode + env-only (disabled).
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o', 'gpt-4.1'] } }),
      );

      // Act
      renderComponent({
        disabled: true,
        defaultValues: {
          provider: 'openai',
          allowedModels: [
            { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
          ],
        },
      });

      // Assert: the dropdown is disabled (removed from the tab order, non-editable).
      const modelControl = screen.getByLabelText('ai_settings.model_label');
      expect(modelControl.tagName).toBe('SELECT');
      expect(modelControl).toBeDisabled();
    });
  });
});
