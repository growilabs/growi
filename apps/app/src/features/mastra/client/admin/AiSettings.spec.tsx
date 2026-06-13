// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';

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
  useAiSettings: () => ({
    data: mockData,
    error: undefined,
    isLoading: mockData == null,
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
  azureOpenaiResourceName: undefined,
  azureOpenaiBaseUrl: undefined,
  azureOpenaiApiVersion: undefined,
  azureOpenaiUseEntraId: false,
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
const submitForm = (): void => {
  fireEvent.click(getSaveButton());
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
        azureOpenaiUseEntraId: false,
      });

      // Act
      render(<AiSettings />);
      submitForm();

      // Assert: booleans are always sent; string fields are sent as-is.
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const body = save.mock.calls[0][0];
      expect(body).toMatchObject({
        aiEnabled: true,
        provider: 'openai',
        model: 'gpt-4o',
        azureOpenaiUseEntraId: false,
      });
    });

    it('omits apiKey when the user left the field blank', async () => {
      // Arrange
      setData({ isApiKeySet: true });

      // Act
      render(<AiSettings />);
      submitForm();

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
      render(<AiSettings />);
      fireEvent.change(screen.getByLabelText('ai_settings.api_key_label'), {
        target: { value: 'sk-new-key' },
      });
      submitForm();

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
      submitForm();

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
      render(<AiSettings />);
      fireEvent.change(screen.getByLabelText('ai_settings.model_label'), {
        target: { value: 'gpt-4o-mini' },
      });
      submitForm();

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
      submitForm();

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
      render(<AiSettings />);
      const modelInput = screen.getByLabelText('ai_settings.model_label');
      fireEvent.change(modelInput, { target: { value: 'edited-model' } });
      submitForm();

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
      expect(screen.getByLabelText('ai_settings.model_label')).toBeDisabled();
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
