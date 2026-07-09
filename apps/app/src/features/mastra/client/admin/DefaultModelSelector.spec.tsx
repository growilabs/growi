// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import type {
  AiSettingsFormValues,
  AllowedModelFormValue,
} from './ai-settings-form-values';
import { DefaultModelSelector } from './DefaultModelSelector';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

// A multi-provider allow-list: openai owns two models (gpt-5 is the default),
// anthropic owns one, google owns none. It proves grouping, single-default, and
// the trigger label across providers (3.1).
const multiProviderModels: AllowedModelFormValue[] = [
  {
    provider: 'openai',
    modelId: 'gpt-5',
    providerOptionsText: '',
    isDefault: true,
  },
  {
    provider: 'openai',
    modelId: 'gpt-5-mini',
    providerOptionsText: '',
    isDefault: false,
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    providerOptionsText: '',
    isDefault: false,
  },
];

/**
 * Read-only probe rendered alongside the component: it mirrors the whole
 * `allowedModels` array's `isDefault` flags into the DOM so a test can assert the
 * single-default invariant across ALL rows (not just the one that was clicked).
 */
const DefaultFlagsProbe = (): JSX.Element => {
  const models =
    useWatch<AiSettingsFormValues, 'allowedModels'>({
      name: 'allowedModels',
    }) ?? [];
  return (
    <ul data-testid="default-flags">
      {models.map((m) => (
        <li
          // The (provider, modelId) pair is unique within the allow-list, so it
          // is a stable key/testid for reading a specific row's default flag.
          key={`${m.provider}-${m.modelId}`}
          data-testid={`flag-${m.provider}-${m.modelId}`}
          data-default={String(m.isDefault === true)}
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
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: { allowedModels },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  allowedModels,
}: {
  allowedModels: AllowedModelFormValue[];
}) =>
  render(
    <FormHarness allowedModels={allowedModels}>
      <DefaultModelSelector />
      <DefaultFlagsProbe />
    </FormHarness>,
  );

const getToggle = (): HTMLElement => screen.getByTestId('default-model-toggle');

const getFlag = (provider: string, modelId: string): string | null =>
  screen
    .getByTestId(`flag-${provider}-${modelId}`)
    .getAttribute('data-default');

const getAllFlags = (): (string | null)[] =>
  within(screen.getByTestId('default-flags'))
    .getAllByRole('listitem')
    .map((el) => el.getAttribute('data-default'));

describe('DefaultModelSelector', () => {
  it('lists every model grouped by its provider, in provider then allow-list order, omitting providers that own no model (3.1)', async () => {
    // Arrange
    const user = userEvent.setup();
    renderComponent({ allowedModels: multiProviderModels });

    // Act: open the dropdown.
    await user.click(getToggle());

    // Assert: the menu is a flat sequence of [provider header, its models...] per
    // provider. openai and anthropic each head their own model ids; google (no
    // models) and azure-openai (no models) contribute no group. This single
    // ordered read proves grouping, per-group membership, and the omission.
    const menu = screen.getByRole('menu');
    await waitFor(() => {
      const entries = within(menu)
        .getAllByTestId(/^default-model-(group|item)-/)
        .map((el) => el.textContent);
      expect(entries).toEqual([
        'openai',
        'gpt-5',
        'gpt-5-mini',
        'anthropic',
        'claude-sonnet-5',
      ]);
    });
    expect(
      screen.queryByTestId('default-model-group-google'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('default-model-group-azure-openai'),
    ).not.toBeInTheDocument();
  });

  it('shows the current default as "provider · modelId" in the trigger', async () => {
    // Arrange / Act
    renderComponent({ allowedModels: multiProviderModels });

    // Assert: the closed trigger names the default across providers so the same
    // modelId under different providers is still distinguishable (4.2-style).
    // `waitFor` also flushes react-popper's post-mount effects inside act(...).
    await waitFor(() => {
      expect(getToggle()).toHaveTextContent('openai · gpt-5');
    });
  });

  it('makes the picked model the single global default, clearing every other row including a same-provider sibling (3.1)', async () => {
    // Arrange
    const user = userEvent.setup();
    renderComponent({ allowedModels: multiProviderModels });

    // Act: choose a model in a DIFFERENT provider group (anthropic).
    await user.click(getToggle());
    await user.click(screen.getByTestId('default-model-item-2'));

    // Assert: exactly the picked row is default; the previously-default row and
    // the same-provider sibling are both cleared — exactly one default overall.
    await waitFor(() => {
      expect(getFlag('anthropic', 'claude-sonnet-5')).toBe('true');
    });
    expect(getFlag('openai', 'gpt-5')).toBe('false');
    expect(getFlag('openai', 'gpt-5-mini')).toBe('false');
    expect(getAllFlags().filter((v) => v === 'true')).toHaveLength(1);

    // The trigger follows the new default.
    expect(getToggle()).toHaveTextContent('anthropic · claude-sonnet-5');
  });

  it('shows a neutral placeholder in the trigger when the allow-list is empty', async () => {
    // Arrange / Act
    renderComponent({ allowedModels: [] });

    // Assert: no default to name, so a placeholder is shown instead of a blank.
    // `waitFor` also flushes react-popper's post-mount effects inside act(...).
    await waitFor(() => {
      expect(getToggle()).toHaveTextContent(
        'ai_settings.default_model_placeholder',
      );
    });
  });
});
