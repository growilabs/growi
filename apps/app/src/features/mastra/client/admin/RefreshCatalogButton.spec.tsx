// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

// Render i18n keys verbatim; assertions target the observable contract (confirm
// gate, the POST, the invalidation, the success/failure toast) rather than copy.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

// The refresh POSTs via apiv3Post and reports via toasts; both are mocked so the
// suite stays network-free and can assert the calls.
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Post: vi.fn() }));
vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { RefreshCatalogButton } from './RefreshCatalogButton';

const mockedApiv3Post = vi.mocked(apiv3Post);
const mockedToastSuccess = vi.mocked(toastSuccess);
const mockedToastError = vi.mocked(toastError);

const getRefreshButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'ai_settings.refresh_model_catalog' });
const getConfirmButton = (): HTMLElement =>
  screen.getByRole('button', {
    name: 'ai_settings.refresh_model_catalog_confirm',
  });

describe('RefreshCatalogButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a confirmation on click and does NOT communicate until confirmed', async () => {
    // Arrange
    const user = userEvent.setup();
    const invalidateAllProviders = vi.fn().mockResolvedValue(undefined);

    // Act
    render(
      <RefreshCatalogButton invalidateAllProviders={invalidateAllProviders} />,
    );
    await user.click(getRefreshButton());

    // Assert: the click reveals the confirmation (the refresh triggers OUTBOUND
    // communication to models.dev) and fires no request yet.
    expect(
      screen.getByText('ai_settings.refresh_model_catalog_confirmation'),
    ).toBeInTheDocument();
    expect(mockedApiv3Post).not.toHaveBeenCalled();
  });

  it('POSTs the refresh, invalidates every provider, and toasts success once confirmed', async () => {
    // Arrange
    const user = userEvent.setup();
    const invalidateAllProviders = vi.fn().mockResolvedValue(undefined);
    mockedApiv3Post.mockResolvedValue(
      mock<Awaited<ReturnType<typeof apiv3Post>>>(),
    );

    // Act
    render(
      <RefreshCatalogButton invalidateAllProviders={invalidateAllProviders} />,
    );
    await user.click(getRefreshButton());
    await user.click(getConfirmButton());

    // Assert
    await waitFor(() => {
      expect(mockedApiv3Post).toHaveBeenCalledExactlyOnceWith(
        '/ai-settings/refresh-model-catalog',
      );
    });
    expect(invalidateAllProviders).toHaveBeenCalledTimes(1);
    expect(mockedToastSuccess).toHaveBeenCalledWith(
      'ai_settings.refresh_model_catalog_success',
    );
    expect(mockedToastError).not.toHaveBeenCalled();
  });

  it('does NOT communicate when the admin cancels the confirmation', async () => {
    // Arrange
    const user = userEvent.setup();
    const invalidateAllProviders = vi.fn().mockResolvedValue(undefined);

    // Act
    render(
      <RefreshCatalogButton invalidateAllProviders={invalidateAllProviders} />,
    );
    await user.click(getRefreshButton());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Assert
    expect(mockedApiv3Post).not.toHaveBeenCalled();
    expect(invalidateAllProviders).not.toHaveBeenCalled();
    expect(mockedToastSuccess).not.toHaveBeenCalled();
    expect(mockedToastError).not.toHaveBeenCalled();
    expect(getRefreshButton()).toBeEnabled();
  });

  it('toasts the localized failure and does not invalidate when the refresh fails', async () => {
    // Arrange
    const user = userEvent.setup();
    const invalidateAllProviders = vi.fn().mockResolvedValue(undefined);
    mockedApiv3Post.mockRejectedValue(new Error('refresh failed'));

    // Act
    render(
      <RefreshCatalogButton invalidateAllProviders={invalidateAllProviders} />,
    );
    await user.click(getRefreshButton());
    await user.click(getConfirmButton());

    // Assert: the last-good catalog stays in effect — surface the failure, do not
    // invalidate the caches, and never claim success.
    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith(
        'ai_settings.refresh_model_catalog_failed',
      );
    });
    expect(invalidateAllProviders).not.toHaveBeenCalled();
    expect(mockedToastSuccess).not.toHaveBeenCalled();
    expect(getRefreshButton()).toBeEnabled();
  });

  it('is enabled on mount — the catalog is a server-side cache, not gated by AI settings', () => {
    // Act
    render(
      <RefreshCatalogButton
        invalidateAllProviders={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // Assert
    expect(getRefreshButton()).toBeEnabled();
  });
});
