// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiProvider } from '../../interfaces/ai-provider';

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
import type {
  AiSettingsFormValues,
  AllowedModelFormValue,
} from './ai-settings-form-values';
import { useSWRxSelectableModels } from './use-selectable-models';

const mockedUseSelectableModels = vi.mocked(useSWRxSelectableModels);

// Build a minimal hook result for the mock. Only `data`/`error` are read by the
// component; the rest of the SWRResponse surface (including the now-global
// `invalidateAllProviders` util) is filled with inert stubs so the returned value
// is a real hook result (no type assertion needed).
const swrResponse = (partial: {
  data?: SelectableModelsResponse;
  error?: Error;
}): ReturnType<typeof useSWRxSelectableModels> => ({
  data: partial.data,
  error: partial.error,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  invalidateAllProviders: vi.fn(),
});

// A multi-provider fixture whose FILTERED (display) index differs from the
// GLOBAL (original) index for the openai rows: anthropic sits at global index 0
// and is the default, openai owns global indexes 1 and 2, azure owns global
// index 3. A filtered-index bug (operating on the display position rather than
// the original position) would therefore hit the WRONG global row — every
// cross-provider isolation test below relies on this offset to expose it.
const multiProviderModels: AllowedModelFormValue[] = [
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    providerOptionsText: '',
    isDefault: true,
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    providerOptionsText: '',
    isDefault: false,
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    providerOptionsText: '',
    isDefault: false,
  },
  {
    provider: 'azure-openai',
    modelId: 'my-deployment',
    providerOptionsText: '',
    isDefault: false,
  },
];

/**
 * Read-only probe rendered alongside the component: it mirrors the WHOLE flat
 * `allowedModels` array (all providers) into the DOM so a test can assert the
 * global form state after an operation — including rows the panel does not even
 * render. This is how the cross-provider isolation tests observe that an op in
 * the openai panel left the anthropic/azure rows intact.
 */
const AllowedModelsProbe = (): JSX.Element => {
  const models =
    useWatch<AiSettingsFormValues, 'allowedModels'>({
      name: 'allowedModels',
    }) ?? [];
  return (
    <ul data-testid="probe">
      {models.map((m, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: passive mirror; rows may transiently share (provider, modelId) (the duplicate test), so the index is the only collision-free key. Identity is read from data-* attrs, never the key.
          key={index}
          data-testid="probe-row"
          data-provider={m.provider}
          data-modelid={m.modelId}
          data-default={String(m.isDefault === true)}
          data-provideroptions={m.providerOptionsText}
        />
      ))}
    </ul>
  );
};

const FormHarness = ({
  allowedModels,
  children,
}: {
  allowedModels: AllowedModelFormValue[];
  children: ReactNode;
}): JSX.Element => {
  // `onChange` mode so the providerOptions JSON error surfaces as the field
  // changes (matching production behavior).
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: { allowedModels },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  provider = 'openai',
  allowedModels = [
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      providerOptionsText: '',
      isDefault: true,
    },
  ],
}: {
  provider?: AiProvider;
  allowedModels?: AllowedModelFormValue[];
} = {}) =>
  render(
    <FormHarness allowedModels={allowedModels}>
      <AllowedModelsField provider={provider} />
      <AllowedModelsProbe />
    </FormHarness>,
  );

// Each rendered card exposes its model-id text input via the model label (Azure
// uses its own label); counting them is the observable proxy for "how many cards
// are rendered".
const getModelInputs = (): HTMLInputElement[] =>
  screen
    .getAllByLabelText('ai_settings.model_label')
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);

const getModelSelects = (): HTMLSelectElement[] =>
  screen
    .getAllByLabelText('ai_settings.model_label')
    .filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);

// The set-as-default control is an inline button on EVERY displayed row (kept
// mounted for layout stability); on the default row it is disabled and the
// badge conveys the state. Indexes therefore follow the display row order.
const getSetDefaultButtons = (): HTMLButtonElement[] =>
  screen
    .queryAllByRole('button', { name: 'ai_settings.set_as_default' })
    .filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement);

const getProviderOptionsTextareas = (): HTMLTextAreaElement[] =>
  screen
    .getAllByLabelText('ai_settings.provider_options_label')
    .filter(
      (el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement,
    );

const getRenderedRows = (): HTMLElement[] =>
  screen.queryAllByTestId('allowed-model-row');

// Removing a FILLED row opens a confirmation modal first (the change only
// persists on save, but a filled row may carry hand-written providerOptions
// JSON); a still-blank row is removed immediately. This helper confirms the
// modal when it appears, so callers express "remove row N" either way.
const removeAt = async (
  user: ReturnType<typeof userEvent.setup>,
  index: number,
): Promise<void> => {
  const trashButtons = screen.getAllByRole('button', {
    name: 'ai_settings.remove_model',
  });
  await user.click(trashButtons[index]);
  const confirmButton = screen.queryByRole('button', {
    name: 'ai_settings.remove_model_confirm',
  });
  if (confirmButton != null) {
    await user.click(confirmButton);
  }
};

// Probe readers over the GLOBAL array (all providers).
const getProbeRows = (): HTMLElement[] => screen.queryAllByTestId('probe-row');
const findProbeRow = (
  provider: string,
  modelId: string,
): HTMLElement | undefined =>
  getProbeRows().find(
    (el) =>
      el.getAttribute('data-provider') === provider &&
      el.getAttribute('data-modelid') === modelId,
  );
const isRowDefault = (provider: string, modelId: string): boolean =>
  findProbeRow(provider, modelId)?.getAttribute('data-default') === 'true';
const countGlobalDefaults = (): number =>
  getProbeRows().filter((el) => el.getAttribute('data-default') === 'true')
    .length;

describe('AllowedModelsField', () => {
  // Default the hook to a free-text-inducing state (fetch failure) so the modelId
  // control stays a text input for the provider-agnostic behavior suites below.
  // The select-mode suites override this per test.
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseSelectableModels.mockReturnValue(
      swrResponse({ error: new Error('default: force free-text') }),
    );
  });

  describe('provider-scoped display (2.2)', () => {
    it('renders ONLY the rows owned by the panel provider, not other providers', () => {
      // Act: an openai panel over a multi-provider list.
      renderComponent({
        provider: 'openai',
        allowedModels: multiProviderModels,
      });

      // Assert: exactly the two openai rows are rendered; the anthropic and azure
      // rows exist in the global form (the probe sees all four) but are NOT shown
      // in this panel.
      expect(getRenderedRows()).toHaveLength(2);
      expect(getModelInputs().map((i) => i.value)).toEqual([
        'gpt-4o',
        'gpt-4o-mini',
      ]);
      expect(getProbeRows()).toHaveLength(4);
      expect(screen.queryByDisplayValue('claude-sonnet-5')).toBeNull();
      expect(screen.queryByDisplayValue('my-deployment')).toBeNull();
    });

    it('renders ONLY the anthropic row for an anthropic panel', () => {
      // Act
      renderComponent({
        provider: 'anthropic',
        allowedModels: multiProviderModels,
      });

      // Assert: one row, the anthropic one.
      expect(getRenderedRows()).toHaveLength(1);
      expect(getModelInputs().map((i) => i.value)).toEqual(['claude-sonnet-5']);
    });
  });

  describe('cross-provider isolation via original-index mapping (load-bearing)', () => {
    it('removing an openai row leaves every anthropic/azure row untouched', async () => {
      // Arrange: gpt-4o is NOT the default (anthropic is), so this is a pure
      // isolation check with no default reassignment.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: multiProviderModels,
      });

      // Act: remove the FIRST displayed openai row (display index 0 → global
      // index 1). A filtered-index bug would remove global index 0 (anthropic).
      await removeAt(user, 0);

      // Assert: gpt-4o is gone; the sibling openai row and BOTH other-provider
      // rows survive with their values (and the anthropic default) intact.
      expect(findProbeRow('openai', 'gpt-4o')).toBeUndefined();
      expect(findProbeRow('openai', 'gpt-4o-mini')).toBeDefined();
      expect(findProbeRow('anthropic', 'claude-sonnet-5')).toBeDefined();
      expect(findProbeRow('azure-openai', 'my-deployment')).toBeDefined();
      expect(isRowDefault('anthropic', 'claude-sonnet-5')).toBe(true);
    });

    it('editing an openai row modelId does not overwrite any other-provider row', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: multiProviderModels,
      });

      // Act: edit the FIRST displayed openai row (display index 0 → global index
      // 1). A filtered-index register path would write to global index 0
      // (anthropic) instead.
      const firstOpenaiInput = getModelInputs()[0];
      await user.clear(firstOpenaiInput);
      await user.type(firstOpenaiInput, 'gpt-4o-edited');

      // Assert: the openai row took the edit; the anthropic/azure rows still read
      // their original ids (they were not the register target).
      expect(findProbeRow('openai', 'gpt-4o-edited')).toBeDefined();
      expect(findProbeRow('openai', 'gpt-4o')).toBeUndefined();
      expect(findProbeRow('anthropic', 'claude-sonnet-5')).toBeDefined();
      expect(findProbeRow('anthropic', 'gpt-4o-edited')).toBeUndefined();
      expect(findProbeRow('azure-openai', 'my-deployment')).toBeDefined();
    });

    it('starring an openai row makes exactly that row the single global default, clearing all others across providers', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: multiProviderModels,
      });

      // Act: promote the SECOND displayed openai row (display index 1 → global
      // index 2 = gpt-4o-mini). Neither openai row is the default, so both offer
      // the set-as-default action. A filtered-index bug would set the default at
      // global index 1 (gpt-4o) instead.
      await user.click(getSetDefaultButtons()[1]);

      // Assert: gpt-4o-mini is the only default; the previous default (anthropic),
      // the sibling openai row, and azure are all cleared — exactly one default.
      expect(isRowDefault('openai', 'gpt-4o-mini')).toBe(true);
      expect(isRowDefault('openai', 'gpt-4o')).toBe(false);
      expect(isRowDefault('anthropic', 'claude-sonnet-5')).toBe(false);
      expect(isRowDefault('azure-openai', 'my-deployment')).toBe(false);
      expect(countGlobalDefaults()).toBe(1);
    });
  });

  describe('add (2.2)', () => {
    it('appends a row owning the panel provider, seeded with that provider namespace', async () => {
      // Arrange: an openai panel with one existing openai row.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });
      expect(getRenderedRows()).toHaveLength(1);

      // Act
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert: a second openai row appears, owning `provider: 'openai'` and
      // pre-seeded with the openai providerOptions namespace.
      expect(getRenderedRows()).toHaveLength(2);
      const newRow = findProbeRow('openai', '');
      expect(newRow).toBeDefined();
      expect(
        JSON.parse(newRow?.getAttribute('data-provideroptions') ?? '{}'),
      ).toEqual({ openai: {} });
    });

    it('adds an anthropic-owned row seeded with the anthropic namespace for an anthropic panel', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({ provider: 'anthropic', allowedModels: [] });

      // Act
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert: the seeded namespace follows the PANEL provider, not a hard-coded
      // openai example.
      const textareas = getProviderOptionsTextareas();
      expect(JSON.parse(textareas[0].value)).toEqual({ anthropic: {} });
      expect(findProbeRow('anthropic', '')).toBeDefined();
    });

    it('marks the first model added to an EMPTY global list as the default (3.1/3.3)', async () => {
      // Arrange: no models at all.
      const user = userEvent.setup();
      renderComponent({ provider: 'openai', allowedModels: [] });

      // Act
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert: the sole row is the default so the single-default invariant holds
      // from the first add.
      expect(countGlobalDefaults()).toBe(1);
      expect(isRowDefault('openai', '')).toBe(true);
    });

    it('does NOT auto-default a row added while the global list is already non-empty', async () => {
      // Arrange: another provider already owns the default.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'anthropic',
            modelId: 'claude-sonnet-5',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Act: add an openai row.
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      // Assert: the existing anthropic default is preserved; the new row is not
      // the default (still exactly one default globally).
      expect(isRowDefault('anthropic', 'claude-sonnet-5')).toBe(true);
      expect(isRowDefault('openai', '')).toBe(false);
      expect(countGlobalDefaults()).toBe(1);
    });
  });

  describe('default selection via shared helper (3.1)', () => {
    it('disables the set-as-default action on the default card only and moves the single default when picked', async () => {
      // Arrange: two openai rows, first is default.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });
      // Both rows keep the action mounted; only the default row's is disabled.
      expect(isRowDefault('openai', 'gpt-4o')).toBe(true);
      expect(getSetDefaultButtons()).toHaveLength(2);
      expect(getSetDefaultButtons()[0]).toBeDisabled();
      expect(getSetDefaultButtons()[1]).toBeEnabled();

      // Act: promote the non-default row via its inline action.
      await user.click(getSetDefaultButtons()[1]);

      // Assert: exactly one default, now the second row — and the disabled
      // state swapped rows (re-query: the switch rewrites the whole array and
      // re-renders, staling prior references).
      expect(isRowDefault('openai', 'gpt-4o-mini')).toBe(true);
      expect(isRowDefault('openai', 'gpt-4o')).toBe(false);
      expect(countGlobalDefaults()).toBe(1);
      expect(getSetDefaultButtons()[0]).toBeEnabled();
      expect(getSetDefaultButtons()[1]).toBeDisabled();
    });

    it('marks only the default card with the "default" badge', () => {
      // Arrange / Act
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });

      // Assert
      expect(screen.getAllByText('ai_settings.default_badge')).toHaveLength(1);
    });
  });

  describe('default-row delete reassignment (3.1/3.3)', () => {
    it('reassigns the default to the first remaining GLOBAL row (even another provider) when the default row is deleted', async () => {
      // Arrange: anthropic sits at global index 0 (NOT default); the openai row
      // is the default. Deleting it must move the default to global index 0 —
      // which belongs to a DIFFERENT provider (the default is global).
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'anthropic',
            modelId: 'claude-sonnet-5',
            providerOptionsText: '',
            isDefault: false,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Act: delete the sole (default) openai row from this panel.
      await removeAt(user, 0);

      // Assert: the openai row is gone; the anthropic row (global index 0) is now
      // the default — still exactly one default overall.
      expect(findProbeRow('openai', 'gpt-4o')).toBeUndefined();
      expect(isRowDefault('anthropic', 'claude-sonnet-5')).toBe(true);
      expect(countGlobalDefaults()).toBe(1);
    });

    it('leaves NO default when the last remaining row is deleted', async () => {
      // Arrange: a single (default) openai row.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Act: delete it — the global list becomes empty.
      await removeAt(user, 0);

      // Assert: no rows, no default (empty list is a valid state — 3.3).
      expect(getRenderedRows()).toHaveLength(0);
      expect(getProbeRows()).toHaveLength(0);
      expect(countGlobalDefaults()).toBe(0);
    });

    it('does NOT reassign the default when a non-default row is deleted', async () => {
      // Arrange: two openai rows, the SECOND is the default.
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: false,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Act: remove the first (non-default) row.
      await removeAt(user, 0);

      // Assert: the default stays on gpt-4o-mini (not shifted to the new first row).
      expect(isRowDefault('openai', 'gpt-4o-mini')).toBe(true);
      expect(countGlobalDefaults()).toBe(1);
    });
  });

  describe('remove confirmation', () => {
    it('asks for confirmation before removing a filled row, and keeps the row when cancelled', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Act: click the trash icon, then CANCEL in the confirmation modal.
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.remove_model' }),
      );
      expect(
        screen.getByRole('button', {
          name: 'ai_settings.remove_model_confirm',
        }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      // Assert: nothing was removed.
      expect(findProbeRow('openai', 'gpt-4o')).toBeDefined();
      expect(getRenderedRows()).toHaveLength(1);
    });

    it('removes a still-blank row immediately, without a confirmation modal', async () => {
      // Arrange: add a fresh (blank) row.
      const user = userEvent.setup();
      renderComponent({ provider: 'openai', allowedModels: [] });
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );
      expect(getRenderedRows()).toHaveLength(1);

      // Act: delete it via the trash icon alone.
      await user.click(
        screen.getByRole('button', { name: 'ai_settings.remove_model' }),
      );

      // Assert: the row is gone and no confirmation was shown.
      expect(getRenderedRows()).toHaveLength(0);
      expect(
        screen.queryByRole('button', {
          name: 'ai_settings.remove_model_confirm',
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('same-provider duplicate error (2.4)', () => {
    it('shows a row error when two rows of the SAME provider share a modelId', () => {
      // Arrange / Act: two openai rows both "gpt-4o".
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });

      // Assert: the duplicate error is surfaced (one per offending row).
      expect(
        screen.getAllByText('ai_settings.model_duplicate_error'),
      ).toHaveLength(2);
    });

    it('does NOT flag the same modelId under DIFFERENT providers (2.3)', () => {
      // Arrange / Act: openai and anthropic both own "gpt-4o" — allowed to
      // co-exist. The openai panel shows only the openai row, which is unique
      // within its provider.
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'anthropic',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });

      // Assert: no duplicate error.
      expect(
        screen.queryByText('ai_settings.model_duplicate_error'),
      ).toBeNull();
    });

    it('surfaces the duplicate error live as a second row is typed into a colliding id', async () => {
      // Arrange: two openai rows; the second is empty (no collision yet).
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: '',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });
      expect(
        screen.queryByText('ai_settings.model_duplicate_error'),
      ).toBeNull();

      // Act: type the same id into the second row.
      await user.type(getModelInputs()[1], 'gpt-4o');

      // Assert: the collision is now flagged.
      await waitFor(() => {
        expect(
          screen.getAllByText('ai_settings.model_duplicate_error').length,
        ).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('providerOptions JSON validation (2.8)', () => {
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

    it('shows no error when the providerOptions are empty', () => {
      // Arrange / Act
      renderComponent();

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).toBeNull();
    });
  });

  describe('provider-driven label (2.7)', () => {
    it('labels the model field "Model" for a non-Azure provider', () => {
      // Act
      renderComponent({ provider: 'openai' });

      // Assert
      expect(
        screen.getByLabelText('ai_settings.model_label'),
      ).toBeInTheDocument();
    });

    it('labels the model field "Deployment name" for Azure OpenAI', () => {
      // Act
      renderComponent({
        provider: 'azure-openai',
        allowedModels: [
          {
            provider: 'azure-openai',
            modelId: 'my-deployment',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Assert
      expect(
        screen.getByLabelText('ai_settings.azure_model_deployment_label'),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText('ai_settings.model_label'),
      ).not.toBeInTheDocument();
    });
  });

  describe('modelId input: catalog select vs free-text (2.6/2.7)', () => {
    it('renders a catalog dropdown for a catalog provider, excluding already-registered ids from OTHER rows', () => {
      // Arrange: openai has a catalog; the first row already registered gpt-4o.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({
          data: { modelIds: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini'] },
        }),
      );

      // Act: a SECOND, empty openai row.
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: '',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });

      // Assert: both controls are <select>s. The empty row's options exclude the
      // gpt-4o already registered by the first row (registered-excluded), leaving
      // the placeholder + the still-available ids.
      const selects = getModelSelects();
      expect(selects).toHaveLength(2);
      const emptyRowOptions = within(selects[1])
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(emptyRowOptions).toEqual([
        'ai_settings.model_placeholder',
        'gpt-4.1',
        'gpt-4o-mini',
      ]);
    });

    it('renders a free-text input for a catalog-less provider (Azure)', () => {
      // Arrange: azure-openai resolves to an empty catalog.
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: [] } }),
      );

      // Act
      renderComponent({
        provider: 'azure-openai',
        allowedModels: [
          {
            provider: 'azure-openai',
            modelId: 'my-deployment',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Assert: free-text input (a deployment name can be typed).
      const modelControl = screen.getByLabelText(
        'ai_settings.azure_model_deployment_label',
      );
      expect(modelControl).toBeInstanceOf(HTMLInputElement);
      expect((modelControl as HTMLInputElement).type).toBe('text');
    });

    it('falls back to a free-text input when the catalog fetch fails, without blocking editing (2.6)', async () => {
      // Arrange
      const user = userEvent.setup();
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ error: new Error('boom') }),
      );

      // Act
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: '',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Assert
      const modelControl = screen.getByLabelText('ai_settings.model_label');
      expect(modelControl).toBeInstanceOf(HTMLInputElement);
      await user.type(modelControl, 'gpt-4o');
      expect((modelControl as HTMLInputElement).value).toBe('gpt-4o');
    });

    it('keeps a saved modelId absent from the current catalog as its own selected option (2.6)', () => {
      // Arrange
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o'] } }),
      );

      // Act
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'legacy-custom-id',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // Assert
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
      // Repro of the reload bug: fetch in flight → resolves to a list including
      // the saved id. The <select> must display the saved id afterwards.
      mockedUseSelectableModels.mockReturnValue(swrResponse({})); // loading

      const { rerender } = renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      mockedUseSelectableModels.mockReturnValue(
        swrResponse({ data: { modelIds: ['gpt-4o', 'gpt-4.1'] } }),
      );
      rerender(
        <FormHarness
          allowedModels={[
            {
              provider: 'openai',
              modelId: 'gpt-4o',
              providerOptionsText: '',
              isDefault: true,
            },
          ]}
        >
          <AllowedModelsField provider="openai" />
          <AllowedModelsProbe />
        </FormHarness>,
      );

      const modelControl = screen.getByLabelText('ai_settings.model_label');
      await waitFor(() => {
        expect((modelControl as HTMLSelectElement).value).toBe('gpt-4o');
      });
    });

    it('disables the control while the catalog is loading so an out-of-catalog id cannot be typed (2.6)', () => {
      // A request is in flight: neither data nor error has arrived.
      mockedUseSelectableModels.mockReturnValue(swrResponse({}));

      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });

      // The modelId control is disabled purely because the catalog is loading.
      expect(screen.getByLabelText('ai_settings.model_label')).toBeDisabled();
    });
  });

  describe('add / remove / default in select mode', () => {
    beforeEach(() => {
      mockedUseSelectableModels.mockReturnValue(
        swrResponse({
          data: { modelIds: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini'] },
        }),
      );
    });

    it('appends a select card on the empty placeholder when add is clicked', async () => {
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      });
      expect(getModelSelects()).toHaveLength(1);

      await user.click(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      );

      const selects = getModelSelects();
      expect(selects).toHaveLength(2);
      expect(selects[1].value).toBe('');
    });

    it('keeps the remaining card value after the first card is removed (re-indexing)', async () => {
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4.1',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });
      expect(getModelSelects().map((s) => s.value)).toEqual([
        'gpt-4o',
        'gpt-4.1',
      ]);

      await removeAt(user, 0);

      const remaining = getModelSelects();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].value).toBe('gpt-4.1');
      expect(isRowDefault('openai', 'gpt-4.1')).toBe(true);
    });

    it('preserves both select values when the default is switched via the set-as-default action', async () => {
      const user = userEvent.setup();
      renderComponent({
        provider: 'openai',
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '',
            isDefault: true,
          },
          {
            provider: 'openai',
            modelId: 'gpt-4.1',
            providerOptionsText: '',
            isDefault: false,
          },
        ],
      });
      // Buttons follow display order: [1] is the non-default gpt-4.1 row.
      await user.click(getSetDefaultButtons()[1]);

      expect(isRowDefault('openai', 'gpt-4.1')).toBe(true);
      expect(isRowDefault('openai', 'gpt-4o')).toBe(false);
      // The single-default switch flips only isDefault; the model <select> values
      // are preserved (the shared helper keeps modelId/providerOptions).
      expect(getModelSelects().map((s) => s.value)).toEqual([
        'gpt-4o',
        'gpt-4.1',
      ]);
    });
  });
});
