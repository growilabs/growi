// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// biome-ignore lint/style/noRestrictedImports: Type-only import from axios
import type { AxiosResponse } from 'axios';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import type {
  ChangeProposalSettingsUpdate,
  ChangeProposalSettingsView,
} from '../../interfaces';

// Render i18n keys verbatim so assertions target keys, not translated copy.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn(),
  apiv3Put: vi.fn(),
}));

vi.mock('~/states/global', () => ({
  useGrowiCloudUri: () => undefined,
  useGrowiAppIdForGrowiCloud: () => undefined,
}));

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { ChangeProposalSettings } from './ChangeProposalSettings';

const SETTINGS_ENDPOINT = '/change-proposal-settings';

const baseSettings: ChangeProposalSettingsView = {
  isEnabled: true,
  enabledOperationTypes: ['edit', 'move'],
  autoApplyPolicy: 'own-pages',
  maxOperationsPerProposal: 50,
  maxProposalsPerUserPerDay: null,
  perPageNotificationsEnabled: false,
  useOnlyEnvVars: false,
};

type SettingsResponse = { settings: ChangeProposalSettingsView };

const response = (
  settings: ChangeProposalSettingsView,
): AxiosResponse<SettingsResponse> =>
  mock<AxiosResponse<SettingsResponse>>({ data: { settings } });

const serveSettings = (settings: ChangeProposalSettingsView): void => {
  vi.mocked(apiv3Get).mockResolvedValue(response(settings));
};

const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderLoaded = async (): Promise<void> => {
  render(<ChangeProposalSettings />, { wrapper: Wrapper });
  await screen.findByRole('button', {
    name: 'change_proposal_settings.save',
  });
};

const field = (labelKey: string): HTMLInputElement => {
  const element = screen.getByLabelText(`change_proposal_settings.${labelKey}`);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${labelKey} is not an input`);
  }
  return element;
};

const policySelect = (): HTMLSelectElement => {
  const element = screen.getByLabelText(
    'change_proposal_settings.auto_apply_policy',
  );
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('auto_apply_policy is not a select');
  }
  return element;
};

const clickSave = async (): Promise<void> => {
  await userEvent.click(
    screen.getByRole('button', { name: 'change_proposal_settings.save' }),
  );
};

describe('ChangeProposalSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveSettings(baseSettings);
  });

  it('shows the loaded settings', async () => {
    await renderLoaded();

    expect(apiv3Get).toHaveBeenCalledWith(SETTINGS_ENDPOINT);
    expect(field('is_enabled').checked).toBe(true);
    expect(field('operation_type_edit').checked).toBe(true);
    expect(field('operation_type_create').checked).toBe(false);
    expect(field('operation_type_move').checked).toBe(true);
    expect(policySelect().value).toBe('own-pages');
    expect(field('max_operations_per_proposal').value).toBe('50');
    expect(field('per_page_notifications_enabled').checked).toBe(false);
    expect(
      screen.getByText(
        'change_proposal_settings.per_page_notifications_enabled_desc',
      ),
    ).toBeInTheDocument();
  });

  it('shows "no limit" for an empty limit', async () => {
    await renderLoaded();

    const perDay = field('max_proposals_per_user_per_day');
    expect(perDay.value).toBe('');
    expect(perDay.placeholder).toBe(
      'change_proposal_settings.max_proposals_per_user_per_day_unlimited',
    );
  });

  it('saves only the changed values and reports success', async () => {
    const saved: ChangeProposalSettingsView = {
      ...baseSettings,
      maxProposalsPerUserPerDay: 5,
      perPageNotificationsEnabled: true,
    };
    vi.mocked(apiv3Put).mockResolvedValue(response(saved));
    await renderLoaded();

    await userEvent.click(field('per_page_notifications_enabled'));
    await userEvent.type(field('max_proposals_per_user_per_day'), '5');
    serveSettings(saved);
    await clickSave();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const expected: ChangeProposalSettingsUpdate = {
      maxProposalsPerUserPerDay: 5,
      perPageNotificationsEnabled: true,
    };
    expect(apiv3Put).toHaveBeenCalledTimes(1);
    expect(apiv3Put).toHaveBeenCalledWith(SETTINGS_ENDPOINT, expected);
  });

  it('does not call the update API when nothing changed', async () => {
    await renderLoaded();

    await clickSave();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(apiv3Put).not.toHaveBeenCalled();
  });

  it('sends null when a limit is cleared, and the policy and operation types as chosen', async () => {
    vi.mocked(apiv3Put).mockResolvedValue(response(baseSettings));
    await renderLoaded();

    await userEvent.clear(field('max_operations_per_proposal'));
    await userEvent.selectOptions(policySelect(), 'all');
    await userEvent.click(field('operation_type_edit'));
    await userEvent.click(field('operation_type_move'));
    await clickSave();

    await waitFor(() => expect(apiv3Put).toHaveBeenCalledTimes(1));
    const expected: ChangeProposalSettingsUpdate = {
      enabledOperationTypes: [],
      autoApplyPolicy: 'all',
      maxOperationsPerProposal: null,
    };
    expect(apiv3Put).toHaveBeenCalledWith(SETTINGS_ENDPOINT, expected);
  });

  it('does not save a limit that is not a whole number of at least 1', async () => {
    await renderLoaded();

    await userEvent.clear(field('max_operations_per_proposal'));
    await userEvent.type(field('max_operations_per_proposal'), '0');
    await clickSave();

    expect(
      await screen.findByText('change_proposal_settings.limit_invalid'),
    ).toBeInTheDocument();
    expect(apiv3Put).not.toHaveBeenCalled();
  });

  it('shows the error and keeps the input when the update is refused', async () => {
    const refusal = new Error(
      'The change proposal settings are fixed by environment variables',
    );
    vi.mocked(apiv3Put).mockRejectedValue([refusal]);
    await renderLoaded();

    await userEvent.click(field('per_page_notifications_enabled'));
    await clickSave();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith([refusal]));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(field('per_page_notifications_enabled').checked).toBe(true);
  });

  it('shows every value as not editable when the settings are fixed by environment variables', async () => {
    serveSettings({ ...baseSettings, useOnlyEnvVars: true });
    await renderLoaded();

    expect(
      screen.getByText('change_proposal_settings.env_only_mode_notice'),
    ).toBeInTheDocument();
    for (const input of screen.getAllByRole('checkbox')) {
      expect(input).toBeDisabled();
    }
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
    for (const input of screen.getAllByRole('switch')) {
      expect(input).toBeDisabled();
    }
    expect(policySelect()).toBeDisabled();
    expect(field('max_operations_per_proposal')).toBeDisabled();
    expect(field('max_proposals_per_user_per_day')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'change_proposal_settings.save' }),
    ).toBeDisabled();
  });

  it('does not show the env-fixed notice when the settings are editable', async () => {
    await renderLoaded();

    expect(
      screen.queryByText('change_proposal_settings.env_only_mode_notice'),
    ).not.toBeInTheDocument();
  });
});
