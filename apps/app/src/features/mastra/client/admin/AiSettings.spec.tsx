// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import type { UseAiSettings } from './use-ai-settings';

// Render i18n keys verbatim; assertions target the observable contract (which
// tabs render, which panel is mounted, the save body, the button's disabled
// state, alert presence) rather than translated copy.
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
  // and allocating a fresh vitest-mock-extended proxy per render leaks memory
  // and degrades the whole component suite.
  useAiSettings: (): UseAiSettings => ({
    data: mockData,
    error: undefined,
    isLoading: mockData == null,
    isValidating: false,
    mutate,
    save,
  }),
}));

// The active ProviderPanel mounts the real AllowedModelsField, which fetches the
// provider's selectable models via this hook. Mock it so the suite stays
// network-free; a resolved empty catalog puts the model input into free-text
// mode (not the loading-disabled window), so the seeded row's value is visible.
vi.mock('./use-selectable-models', () => ({
  useSWRxSelectableModels: vi.fn(),
}));

import { useSWRxSelectableModels } from './use-selectable-models';

const mockedUseSelectableModels = vi.mocked(useSWRxSelectableModels);

// A minimal, resolved (empty-catalog) hook result. No type assertion: the object
// structurally matches the real hook return, so it type-checks as-is.
const emptyCatalogResult = (): ReturnType<typeof useSWRxSelectableModels> => ({
  data: { modelIds: [] },
  error: undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  invalidateAllProviders: vi.fn(),
});

import { AiSettings } from './AiSettings';

// A seeded multi-provider response: openai enabled + configured, the rest off,
// and one cross-provider allowed model owned by openai (the global default).
const baseSettings: AiSettingsResponse = {
  aiEnabled: true,
  providers: {
    openai: { enabled: true, isApiKeySet: true },
    anthropic: { enabled: false, isApiKeySet: false },
    google: { enabled: false, isApiKeySet: false },
    'azure-openai': {
      enabled: false,
      isApiKeySet: false,
      azureOpenaiSettings: {},
    },
  },
  allowedModels: [{ provider: 'openai', modelId: 'gpt-4o', isDefault: true }],
  useOnlyEnvVars: false,
  isConfigured: true,
};

const setData = (overrides: Partial<AiSettingsResponse> = {}): void => {
  mockData = { ...baseSettings, ...overrides };
};

const getSaveButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'ai_settings.save' });

const submitForm = async (): Promise<void> => {
  await userEvent.setup().click(getSaveButton());
};

describe('AiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue(undefined);
    mockedUseSelectableModels.mockReturnValue(emptyCatalogResult());
    setData();
  });

  describe('provider tabs (R1.1)', () => {
    it('always renders all four provider tabs regardless of configured state', () => {
      // Arrange: only openai is configured; the other three are unconfigured.
      setData();

      // Act
      render(<AiSettings />);

      // Assert: every fixed provider slot is present as a tab (R1.1) — the
      // unconfigured providers are shown too, never omitted.
      expect(screen.getAllByRole('tab')).toHaveLength(AI_PROVIDERS.length);
      for (const provider of AI_PROVIDERS) {
        expect(
          screen.getByTestId(`provider-tab-${provider}`),
        ).toBeInTheDocument();
      }
    });
  });

  describe('active provider panel', () => {
    it('mounts only the active provider panel and switches it on tab click', async () => {
      // Arrange
      const user = userEvent.setup();

      // Act
      render(<AiSettings />);

      // Assert: the initial active panel is the first provider (openai) — its
      // allowed-model row (gpt-4o) is shown, and no azure connection fields are
      // present (that panel is not mounted).
      expect(screen.getByTestId('provider-tab-openai')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument();
      expect(
        screen.queryByLabelText('ai_settings.azure_resource_name_label'),
      ).not.toBeInTheDocument();

      // Act: switch to the azure-openai tab.
      await user.click(screen.getByTestId('provider-tab-azure-openai'));

      // Assert: the azure panel is now mounted (its connection fields appear)
      // and the openai panel is unmounted (only the active provider's panel and
      // its AllowedModelsField are mounted).
      expect(screen.getByTestId('provider-tab-azure-openai')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByLabelText('ai_settings.azure_resource_name_label'),
      ).toBeInTheDocument();
      expect(screen.queryByDisplayValue('gpt-4o')).not.toBeInTheDocument();
    });

    it('keeps each provider enable toggle independent across tab switches', async () => {
      // Locks the intended contract: each tab's enable switch reflects its OWN
      // provider's state, and saving persists per-provider enabled flags
      // independently. (The related browser-only symptom — an uncontrolled switch's
      // DOM `checked` leaking across a reused panel subtree — is not reproducible in
      // happy-dom, which re-syncs the input; the AiSettings `key={activeProvider}`
      // remount guards it in the browser.) Fixture: openai enabled, the rest off.
      const user = userEvent.setup();
      render(<AiSettings />);

      // openai tab: its enable switch reflects openai.enabled === true.
      expect(
        screen.getByLabelText('ai_settings.provider_enabled_label'),
      ).toBeChecked();

      // Switch to anthropic (enabled === false): its switch must show ITS OWN
      // state (off), not the openai switch's on state carried over by a reused node.
      await user.click(screen.getByTestId('provider-tab-anthropic'));
      const anthropicSwitch = screen.getByLabelText(
        'ai_settings.provider_enabled_label',
      );
      expect(anthropicSwitch).not.toBeChecked();

      // Enable anthropic, return to openai — openai stays on (independent state).
      await user.click(anthropicSwitch);
      await user.click(screen.getByTestId('provider-tab-openai'));
      expect(
        screen.getByLabelText('ai_settings.provider_enabled_label'),
      ).toBeChecked();

      // Persisted state is per-provider: openai + anthropic on, the rest off.
      await submitForm();
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const body = save.mock.calls[0][0];
      expect(body.providers?.openai.enabled).toBe(true);
      expect(body.providers?.anthropic.enabled).toBe(true);
      expect(body.providers?.google.enabled).toBe(false);
      expect(body.providers?.['azure-openai'].enabled).toBe(false);
    });

    it('remounts the panel subtree per provider (guards the uncontrolled-input leak)', async () => {
      // The panel's enable switch + apiKey input are UNCONTROLLED (react-hook-form
      // register). `key={activeProvider}` forces a remount on every tab switch so
      // each input re-initialises from its own provider's value; without it React
      // reuses the same DOM nodes and an input's DOM state (e.g. the switch's
      // `checked`) leaks from the previously-viewed provider. That leak is a
      // browser-only symptom (happy-dom re-syncs), so this asserts the STRUCTURAL
      // guarantee instead: the switch is a NEW element instance after a tab switch.
      // Deleting `key={activeProvider}` reuses the node → identity is stable → fails.
      const user = userEvent.setup();
      render(<AiSettings />);

      const switchOnOpenai = screen.getByLabelText(
        'ai_settings.provider_enabled_label',
      );
      await user.click(screen.getByTestId('provider-tab-anthropic'));
      const switchOnAnthropic = screen.getByLabelText(
        'ai_settings.provider_enabled_label',
      );

      expect(switchOnAnthropic).not.toBe(switchOnOpenai);
    });
  });

  describe('update request shape', () => {
    it('normal mode: sends aiEnabled + all four provider entries, omitting an unedited allow-list', async () => {
      // Arrange
      setData();

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const body = save.mock.calls[0][0];
      expect(body.aiEnabled).toBe(true);
      // An untouched allow-list is omitted (PUT "omit = leave unchanged"), so an
      // unrelated save is never blocked by its validity.
      expect(body).not.toHaveProperty('allowedModels');
      // All four fixed provider slots are still sent (the server validator requires
      // the complete set when `providers` is present).
      expect(Object.keys(body.providers ?? {}).sort()).toEqual(
        [...AI_PROVIDERS].sort(),
      );
      expect(body.providers?.openai.enabled).toBe(true);
    });

    it('normal mode: includes allowedModels once the list is edited (dirty wiring)', async () => {
      // Arrange
      setData();
      const user = userEvent.setup();

      // Act: edit the seeded openai row so the allow-list becomes dirty.
      render(<AiSettings />);
      const modelInput = screen.getByDisplayValue('gpt-4o');
      await user.clear(modelInput);
      await user.type(modelInput, 'gpt-4o-mini');
      await user.click(getSaveButton());

      // Assert: the edited list is now sent.
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0].allowedModels).toEqual([
        { provider: 'openai', modelId: 'gpt-4o-mini', isDefault: true },
      ]);
    });

    it('a provider-toggle save is not blocked by an env-seeded allow-list with no default (issue #4a)', async () => {
      // The allow-list has an entry but NO default — valid at runtime (first-entry
      // fallback) yet rejected by the exactly-one-default PUT rule. Toggling a
      // provider must still save: the untouched list is omitted, so the server
      // never validates it.
      setData({ allowedModels: [{ provider: 'openai', modelId: 'gpt-4o' }] });
      const user = userEvent.setup();

      render(<AiSettings />);
      await user.click(screen.getByTestId('provider-tab-anthropic'));
      await user.click(
        screen.getByLabelText('ai_settings.provider_enabled_label'),
      );
      await user.click(getSaveButton());

      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      const body = save.mock.calls[0][0];
      expect(body).not.toHaveProperty('allowedModels');
      expect(body.providers?.anthropic.enabled).toBe(true);
    });

    it('env-only mode: keeps the save button enabled and sends an empty body for an unedited save', async () => {
      // Arrange
      setData({ useOnlyEnvVars: true });

      // Act
      render(<AiSettings />);

      // Assert: env-only still allows persisting model edits, so the Update
      // button is NOT disabled (R5.3).
      expect(getSaveButton()).not.toBeDisabled();

      // Act
      await submitForm();

      // Assert: nothing was edited and connection settings are env-locked, so the
      // body is empty (no-op save) — not an unchanged allow-list that could 400.
      await waitFor(() => {
        expect(save).toHaveBeenCalledTimes(1);
      });
      expect(save.mock.calls[0][0]).toEqual({});
    });
  });

  describe('save feedback (R6.3)', () => {
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

    it('shows an error toast when the save fails', async () => {
      // Arrange
      setData();
      save.mockRejectedValue(new Error('update failed'));

      // Act
      render(<AiSettings />);
      await submitForm();

      // Assert
      await waitFor(() => {
        expect(toastError).toHaveBeenCalledTimes(1);
      });
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe('unconfigured warning', () => {
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

  describe('global catalog refresh (single location)', () => {
    const getRefreshButtons = (): HTMLElement[] =>
      screen.getAllByRole('button', {
        name: 'ai_settings.refresh_model_catalog',
      });

    it('renders the catalog-refresh action exactly once, before the Providers heading', () => {
      // The refresh is a GLOBAL action (one re-ingest replaces the models.dev
      // snapshot for every provider), so it must appear once — not per panel.
      setData();

      render(<AiSettings />);

      const refreshButtons = getRefreshButtons();
      expect(refreshButtons).toHaveLength(1);

      // Document order proves it is a top-level action, not inside the provider
      // panel: the panel is rendered AFTER the "Providers" heading, so the button
      // preceding that heading cannot be within a panel.
      const providersHeading = screen.getByText(
        'ai_settings.providers_section_title',
      );
      expect(
        refreshButtons[0].compareDocumentPosition(providersHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('stays a single instance across provider tab switches', async () => {
      // Switching the active panel must not add or drop the global action.
      const user = userEvent.setup();
      setData();

      render(<AiSettings />);
      expect(getRefreshButtons()).toHaveLength(1);

      await user.click(screen.getByTestId('provider-tab-azure-openai'));
      expect(getRefreshButtons()).toHaveLength(1);
    });
  });
});
