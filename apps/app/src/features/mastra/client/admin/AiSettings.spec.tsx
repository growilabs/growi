// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import type { UseAiSettings } from './use-ai-settings';

// Render i18n keys verbatim; assertions target the observable contract (the
// save call/body, which toast fires, alert presence, disabled state) rather
// than translated copy, since the translation entries are added by a later
// task (5.3).
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('~/client/util/toastr', () => ({
  toastSuccess: (...args: unknown[]) => toastSuccess(...args),
  toastError: (...args: unknown[]) => toastError(...args),
}));

const save = vi.fn<(body: AiSettingsUpdateRequest) => Promise<void>>();
const mutate = vi.fn();
let mockData: AiSettingsResponse | undefined;

vi.mock('./use-ai-settings', () => ({
  // Annotated as UseAiSettings so the mock cannot silently drift from the real
  // hook contract (a missing/renamed field is a compile error). Kept as a plain
  // object literal — NOT mock<T>() — because this factory runs on every render,
  // and allocating a fresh vitest-mock-extended proxy (each holding several
  // vi.fn()s tracked by the global mock registry) per render leaks memory and
  // degrades the whole component suite (heap growth + clearMocks slowdown).
  useAiSettings: (): UseAiSettings => ({
    data: mockData,
    error: undefined,
    isLoading: mockData == null,
    isValidating: false,
    mutate,
    save,
  }),
}));

import { AiSettings } from './AiSettings';

const baseSettings: AiSettingsResponse = {
  aiEnabled: true,
  provider: 'openai',
  model: 'gpt-4o',
  providerOptions: undefined,
  azureOpenaiSettings: {},
  isApiKeySet: true,
  useOnlyEnvVars: false,
  isConfigured: true,
};

const setData = (overrides: Partial<AiSettingsResponse> = {}): void => {
  mockData = { ...baseSettings, ...overrides };
};

// The single save button is identified by its (verbatim) label key.
const getSaveButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'ai_settings.save' });

// Submitting the form kicks off react-hook-form's async handler (validation +
// the awaited save). Wait until `save` is observed to ensure it has settled.
const submitForm = async (): Promise<void> => {
  await userEvent.setup().click(getSaveButton());
};

describe('AiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue(undefined);
    setData();
  });

  describe('save', () => {
    it('builds the update request from the form and persists it via save', async () => {
      // Arrange
      setData({
        provider: 'openai',
        model: 'gpt-4o',
      });

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert: aiEnabled is always sent; the azure object is forwarded as-is
      // (seeded to empty strings / false from the unset response).
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const body = save.mock.calls[0][0];
      expect(body).toMatchObject({
        aiEnabled: true,
        provider: 'openai',
        model: 'gpt-4o',
        azureOpenaiSettings: {
          resourceName: '',
          baseURL: '',
          apiVersion: '',
          useEntraId: false,
        },
      });
    });

    it('omits apiKey when the user left the field blank', async () => {
      // Arrange
      setData({ isApiKeySet: true });

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert: a blank apiKey keeps the existing stored key (it is omitted).
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0]).not.toHaveProperty('apiKey');
    });

    it('includes apiKey when the user typed a value', async () => {
      // Arrange
      setData();

      // Act
      const user = userEvent.setup();
      render(<AiSettings />);
      await user.type(
        screen.getByLabelText('ai_settings.api_key_label'),
        'sk-new-key',
      );
      await submitForm();

      // Assert
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0]).toMatchObject({ apiKey: 'sk-new-key' });
    });

    it('sends provider as undefined when none is selected', async () => {
      // Arrange: no provider selected (the '' sentinel)
      setData({ provider: undefined });

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert: the '' sentinel is converted to undefined for the DTO.
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0].provider).toBeUndefined();
    });

    it('reflects edited fields in the persisted request body', async () => {
      // Arrange
      setData({ provider: 'openai', model: 'gpt-4o' });

      // Act
      const user = userEvent.setup();
      render(<AiSettings />);
      const modelInput = screen.getByLabelText('ai_settings.model_label');
      await user.clear(modelInput);
      await user.type(modelInput, 'gpt-4o-mini');
      await submitForm();

      // Assert
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini' });
    });

    it('shows a success toast after a successful save', async () => {
      // Arrange
      setData();
      save.mockResolvedValue(undefined);

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert
      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledTimes(1);
      });
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe('save failure (R6.3)', () => {
    it('shows an error toast and retains the in-progress input', async () => {
      // Arrange
      setData({ model: 'gpt-4o' });
      save.mockRejectedValue(new Error('update failed'));

      // Act
      const user = userEvent.setup();
      render(<AiSettings />);
      const modelInput = screen.getByLabelText('ai_settings.model_label');
      await user.clear(modelInput);
      await user.type(modelInput, 'edited-model');
      await submitForm();

      // Assert: failure surfaces a toast...
      await waitFor(() => {
        expect(toastError).toHaveBeenCalledTimes(1);
      });
      expect(toastSuccess).not.toHaveBeenCalled();
      // ...and the user's edit is NOT reset back to the server value (the
      // failure path does not revalidate, so no `reset` is triggered).
      expect(screen.getByLabelText('ai_settings.model_label')).toHaveValue(
        'edited-model',
      );
    });
  });

  describe('env-only mode (R4.2)', () => {
    it('renders the notice and disables every input and the save button', () => {
      // Arrange
      setData({ useOnlyEnvVars: true, provider: 'azure-openai' });

      // Act
      render(<AiSettings />);

      // Assert: the env-only notice is shown...
      expect(
        screen.getByText('ai_settings.env_only_mode_notice'),
      ).toBeInTheDocument();
      // ...the toggle/inputs are disabled (not focusable)...
      expect(
        screen.getByLabelText('ai_settings.ai_enabled_label'),
      ).toBeDisabled();
      expect(screen.getByRole('combobox')).toBeDisabled();
      // provider is azure-openai here, so the model field is labelled as the
      // Azure deployment name.
      expect(
        screen.getByLabelText('ai_settings.azure_model_deployment_label'),
      ).toBeDisabled();
      // ...and saving is not possible.
      expect(getSaveButton()).toBeDisabled();
    });
  });

  describe('unconfigured warning (R7.6)', () => {
    it('shows the warning when AI is enabled but not configured', () => {
      // Arrange
      setData({ aiEnabled: true, isConfigured: false });

      // Act
      render(<AiSettings />);

      // Assert
      expect(
        screen.getByText('ai_settings.unconfigured_warning'),
      ).toBeInTheDocument();
    });

    it('hides the warning when AI is enabled and configured', () => {
      // Arrange
      setData({ aiEnabled: true, isConfigured: true });

      // Act
      render(<AiSettings />);

      // Assert
      expect(
        screen.queryByText('ai_settings.unconfigured_warning'),
      ).not.toBeInTheDocument();
    });

    it('hides the warning when AI is disabled (even if not configured)', () => {
      // Arrange
      setData({ aiEnabled: false, isConfigured: false });

      // Act
      render(<AiSettings />);

      // Assert
      expect(
        screen.queryByText('ai_settings.unconfigured_warning'),
      ).not.toBeInTheDocument();
    });
  });

  describe('Azure section (R3.2)', () => {
    it('renders the Azure section when the provider is azure-openai', () => {
      // Arrange
      setData({ provider: 'azure-openai' });

      // Act
      render(<AiSettings />);

      // Assert
      expect(
        screen.getByLabelText('ai_settings.azure_resource_name_label'),
      ).toBeInTheDocument();
    });

    it('does not render the Azure section for a non-azure provider', () => {
      // Arrange
      setData({ provider: 'openai' });

      // Act
      render(<AiSettings />);

      // Assert
      expect(
        screen.queryByLabelText('ai_settings.azure_resource_name_label'),
      ).not.toBeInTheDocument();
    });
  });
});
